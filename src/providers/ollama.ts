import { lookup as defaultLookup } from "node:dns/promises";
import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions as HttpRequestOptions,
} from "node:http";
import type { LookupFunction } from "node:net";
import type { ApprovedProviderEndpoint } from "./endpoints";
import { approveCompatibleEndpoint } from "./endpoints";
import { withRetry } from "../core/retry";
import { GenerateOptions, LLMProvider } from "./types";

const DEFAULT_HOST = "http://localhost:11434";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 1024 * 1024;

type RequestImplementation = typeof httpRequest;

const SAFE_RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);

function safeErrorCode(error: unknown): string | undefined {
  try {
    if (typeof error !== "object" || error === null) return undefined;
    const direct = Reflect.get(error, "code");
    if (typeof direct === "string") return direct.toUpperCase();
    const cause = Reflect.get(error, "cause");
    if (typeof cause === "object" && cause !== null) {
      const nested = Reflect.get(cause, "code");
      if (typeof nested === "string") return nested.toUpperCase();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function safeStatus(response: IncomingMessage): number | undefined {
  return typeof response.statusCode === "number"
    ? response.statusCode
    : undefined;
}

function providerError(
  phase: "request" | "stream" | "discovery",
  status?: number,
  code?: string,
): Error {
  if (status !== undefined && status >= 100 && status <= 599) {
    return new Error(`Ollama provider ${phase} failed (HTTP ${status})`);
  }
  if (code === "ETIMEDOUT") {
    return new Error(`Ollama provider ${phase} timeout (ETIMEDOUT)`);
  }
  if (code !== undefined && SAFE_RETRYABLE_NETWORK_CODES.has(code)) {
    return new Error(`Ollama provider ${phase} failed (${code})`);
  }
  return new Error(`Ollama provider ${phase} failed`);
}

function safeRequestError(
  phase: "request" | "stream" | "discovery",
  error: unknown,
): Error {
  const code = safeErrorCode(error);
  return providerError(phase, undefined, code);
}

function safeBodyError(
  phase: "response" | "stream" | "discovery",
  error: unknown,
): Error {
  const code = safeErrorCode(error);
  if (code === "ETIMEDOUT") {
    return new Error(`Ollama provider ${phase} body timeout (ETIMEDOUT)`);
  }
  if (code !== undefined && SAFE_RETRYABLE_NETWORK_CODES.has(code)) {
    return new Error(`Ollama provider ${phase} body failed (${code})`);
  }
  return new Error(`Ollama provider ${phase} body failed`);
}

function endpointBase(endpoint: ApprovedProviderEndpoint): string {
  return endpoint.url.pathname.replace(/\/$/, "");
}

function endpointPath(
  endpoint: ApprovedProviderEndpoint,
  suffix: string,
): string {
  return `${endpointBase(endpoint)}${suffix}` || "/";
}

function cloneEndpoint(
  endpoint: ApprovedProviderEndpoint | undefined,
): ApprovedProviderEndpoint | undefined {
  if (endpoint === undefined) return undefined;
  return {
    url: new URL(endpoint.url.href),
    origin: endpoint.origin,
    local: endpoint.local,
    addresses: endpoint.addresses.map(({ address, family }) => ({
      address,
      family,
    })),
  };
}

/** Re-approves the exact configured host before every request attempt. */
async function approvedLoopbackEndpoint(
  host: string,
  endpoint: ApprovedProviderEndpoint | undefined,
  lookup: typeof import("node:dns/promises").lookup,
): Promise<ApprovedProviderEndpoint> {
  const rawUrl = endpoint?.url.toString() ?? host;
  const approved = await approveCompatibleEndpoint({
    rawUrl,
    allowLocalHttp: true,
    lookup,
  });
  if (!approved.local || approved.url.protocol !== "http:") {
    throw new Error("Ollama provider endpoint is not approved");
  }
  return approved;
}

function requestOptions(
  endpoint: ApprovedProviderEndpoint,
  path: string,
  method: "GET" | "POST",
  timeoutMs: number,
  body?: string,
): HttpRequestOptions {
  const address = endpoint.addresses[0];
  if (address === undefined) {
    throw new Error("Ollama provider endpoint is not approved");
  }
  const headers: Record<string, string> = {
    Host: endpoint.url.host,
    Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(body, "utf8"));
  }
  return {
    protocol: endpoint.url.protocol,
    hostname: endpoint.url.hostname.replace(/^\[/, "").replace(/\]$/, ""),
    port: endpoint.url.port === "" ? undefined : Number(endpoint.url.port),
    path,
    method,
    headers,
    timeout: timeoutMs,
    lookup: ((_hostname, _options, callback) =>
      callback(null, address.address, address.family)) as LookupFunction,
  };
}

function performRequest<T>(
  request: ClientRequest,
  body: string | undefined,
  responseHandler: (response: IncomingMessage) => Promise<T>,
  phase: "request" | "stream" | "discovery",
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.once("error", (error: unknown) =>
      fail(safeRequestError(phase, error)),
    );
    request.once("timeout", () => {
      fail(new Error(`Ollama provider ${phase} timeout (ETIMEDOUT)`));
      request.destroy();
    });
    request.once("response", (response: IncomingMessage) => {
      responseHandler(response)
        .then((value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        })
        .catch((error: unknown) =>
          fail(error instanceof Error ? error : providerError(phase)),
        );
    });

    try {
      if (body === undefined) request.end();
      else {
        request.write(body);
        request.end();
      }
    } catch (error: unknown) {
      fail(safeRequestError(phase, error));
    }
  });
}

function readBody(
  response: IncomingMessage,
  phase: "response" | "discovery",
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let total = 0;
    const chunks: Buffer[] = [];
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      response.destroy();
      reject(error);
    };

    response.setEncoding("utf8");
    response.on("data", (chunk: string | Buffer) => {
      if (settled) return;
      const value = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      total += Buffer.byteLength(value, "utf8");
      if (total > MAX_BODY_BYTES) {
        fail(new Error(`Ollama provider ${phase} body is too large`));
        return;
      }
      chunks.push(Buffer.from(value, "utf8"));
    });
    response.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    response.once("error", (error: unknown) =>
      fail(safeBodyError(phase, error)),
    );
  });
}

async function jsonPayload(
  response: IncomingMessage,
  phase: "response" | "discovery",
): Promise<unknown> {
  const body = await readBody(response, phase);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`Ollama provider ${phase} returned malformed JSON`);
  }
}

function responseText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Ollama provider returned no text");
  }
  let value: unknown;
  try {
    value = Reflect.get(payload, "response");
  } catch {
    throw new Error("Ollama provider returned no text");
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Ollama provider returned no text");
  }
  return value;
}

async function streamText(
  response: IncomingMessage,
  onToken: (token: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let total = 0;
    let buffer = "";
    let full = "";
    let doneSeen = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      response.destroy();
      reject(error);
    };
    const finish = (): void => {
      if (settled) return;
      if (!doneSeen) {
        fail(new Error("Ollama provider stream ended prematurely"));
        return;
      }
      if (full.trim() === "") {
        fail(new Error("Ollama provider returned no text"));
        return;
      }
      settled = true;
      resolve(full);
    };
    const processLine = (line: string): void => {
      if (line.trim() === "" || doneSeen) return;
      let payload: unknown;
      try {
        payload = JSON.parse(line) as unknown;
      } catch {
        throw new Error("Ollama provider stream returned malformed JSON");
      }
      if (typeof payload !== "object" || payload === null) {
        throw new Error("Ollama provider stream failed");
      }
      let token: unknown;
      let done: unknown;
      try {
        token = Reflect.get(payload, "response");
        done = Reflect.get(payload, "done");
      } catch {
        throw new Error("Ollama provider stream failed");
      }
      if (token !== undefined && typeof token !== "string") {
        throw new Error("Ollama provider stream failed");
      }
      if (typeof token === "string" && token.length > 0) {
        full += token;
        onToken(token);
      }
      if (done === true) doneSeen = true;
    };

    const processChunk = (chunk: string | Buffer): void => {
      if (settled) return;
      const value = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      total += Buffer.byteLength(value, "utf8");
      if (total > MAX_BODY_BYTES) {
        fail(new Error("Ollama provider stream body is too large"));
        return;
      }
      buffer += value;
      if (Buffer.byteLength(buffer, "utf8") > MAX_BODY_BYTES) {
        fail(new Error("Ollama provider stream body is too large"));
        return;
      }
      try {
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          processLine(line.replace(/\r$/, ""));
          if (doneSeen) break;
        }
        if (doneSeen) finish();
      } catch {
        fail(new Error("Ollama provider stream failed"));
      }
    };

    response.setEncoding("utf8");
    response.on("data", processChunk);
    response.once("end", () => {
      if (settled) return;
      try {
        buffer += "";
        if (!doneSeen && buffer.trim() !== "") processLine(buffer);
      } catch {
        fail(new Error("Ollama provider stream failed"));
        return;
      }
      finish();
    });
    response.once("error", (error: unknown) => {
      const code = safeErrorCode(error);
      if (code !== undefined && SAFE_RETRYABLE_NETWORK_CODES.has(code)) {
        fail(
          new Error(
            code === "ETIMEDOUT"
              ? "Ollama provider stream timeout (ETIMEDOUT)"
              : `Ollama provider stream failed (${code})`,
          ),
        );
        return;
      }
      fail(new Error("Ollama provider stream failed"));
    });
  });
}

/** Returns sorted, deduplicated installed Ollama model names for discovery. */
export async function listOllamaModels(
  host: string = DEFAULT_HOST,
  requestImpl: RequestImplementation = httpRequest,
  lookup: typeof import("node:dns/promises").lookup = defaultLookup,
): Promise<readonly string[]> {
  try {
    const endpoint = await approvedLoopbackEndpoint(host, undefined, lookup);
    const request = requestImpl(
      requestOptions(
        endpoint,
        endpointPath(endpoint, "/api/tags"),
        "GET",
        DEFAULT_TIMEOUT_MS,
      ),
    );
    const payload = await performRequest(
      request,
      undefined,
      async (response) => {
        const status = safeStatus(response);
        if (status === undefined || status < 200 || status >= 300) {
          response.resume();
          throw providerError("discovery", status);
        }
        return jsonPayload(response, "discovery");
      },
      "discovery",
    );
    if (typeof payload !== "object" || payload === null) return [];
    let models: unknown;
    try {
      models = Reflect.get(payload, "models");
    } catch {
      return [];
    }
    if (!Array.isArray(models)) return [];
    const names = models.flatMap((model: unknown) => {
      if (typeof model !== "object" || model === null) return [];
      try {
        const name = Reflect.get(model, "name");
        return typeof name === "string" && name.trim().length > 0
          ? [name.trim()]
          : [];
      } catch {
        return [];
      }
    });
    return Object.freeze([...new Set(names)].sort());
  } catch {
    return [];
  }
}

/** Local Ollama provider for explicitly selected installed models. */
export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  private readonly host: string;
  private readonly model: string;
  private readonly endpoint: ApprovedProviderEndpoint | undefined;
  private readonly lookup: typeof import("node:dns/promises").lookup;
  private readonly timeoutMs: number;
  private readonly requestImpl: RequestImplementation;

  constructor(
    host: string = DEFAULT_HOST,
    model?: string,
    endpoint?: ApprovedProviderEndpoint,
    lookup: typeof import("node:dns/promises").lookup = defaultLookup,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    requestImpl: RequestImplementation = httpRequest,
  ) {
    if (typeof model !== "string" || model.trim().length === 0) {
      throw new Error(
        "Ollama model is required. Set AIDOC_MODEL to an installed model.",
      );
    }
    this.host = host;
    this.model = model;
    this.endpoint = cloneEndpoint(endpoint);
    this.lookup = lookup;
    this.timeoutMs = timeoutMs;
    this.requestImpl = requestImpl;
  }

  private async approvedEndpoint(): Promise<ApprovedProviderEndpoint> {
    return approvedLoopbackEndpoint(this.host, this.endpoint, this.lookup);
  }

  private async request(
    prompt: string,
    options: GenerateOptions,
    stream: boolean,
    onToken?: (token: string) => void,
  ): Promise<string> {
    const endpoint = await this.approvedEndpoint();
    const body = JSON.stringify({
      model: this.model,
      prompt,
      ...(options.systemPrompt === undefined
        ? {}
        : { system: options.systemPrompt }),
      stream,
      options: {
        ...(options.temperature === undefined
          ? {}
          : { temperature: options.temperature }),
        ...(options.maxTokens === undefined
          ? { num_predict: DEFAULT_MAX_TOKENS }
          : { num_predict: options.maxTokens }),
      },
    });
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      throw new Error("Ollama provider request body is too large");
    }

    let request: ClientRequest;
    try {
      request = this.requestImpl(
        requestOptions(
          endpoint,
          endpointPath(endpoint, "/api/generate"),
          "POST",
          this.timeoutMs,
          body,
        ),
      );
    } catch (error: unknown) {
      throw safeRequestError(stream ? "stream" : "request", error);
    }
    return performRequest(
      request,
      body,
      async (response) => {
        const status = safeStatus(response);
        if (status === undefined || status < 200 || status >= 300) {
          response.resume();
          throw providerError(stream ? "stream" : "request", status);
        }
        if (stream) return streamText(response, onToken ?? (() => undefined));
        return responseText(await jsonPayload(response, "response"));
      },
      stream ? "stream" : "request",
    );
  }

  async generate(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<string> {
    return withRetry(() => this.request(prompt, options, false), {
      maxRetries: 3,
    });
  }

  async generateStream(
    prompt: string,
    options: GenerateOptions,
    onToken: (token: string) => void,
  ): Promise<string> {
    let emitted = false;
    const emit = (token: string): void => {
      emitted = true;
      onToken(token);
    };
    const run = async (): Promise<string> => {
      try {
        return await this.request(prompt, options, true, emit);
      } catch (error: unknown) {
        if (emitted) {
          return Promise.reject(
            new Error("Ollama provider stream failed after output"),
          );
        }
        throw error;
      }
    };
    return withRetry(run, { maxRetries: 3 });
  }
}
