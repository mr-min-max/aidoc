import { lookup as defaultLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";
import type { ApprovedProviderEndpoint } from "./endpoints";
import { approveCompatibleEndpoint } from "./endpoints";
import { withRetry } from "../core/retry";
import { GenerateOptions, LLMProvider } from "./types";

export const MAX_PROVIDER_BODY_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface CompatibleTransportOptions {
  readonly name: string;
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint: ApprovedProviderEndpoint;
  readonly allowLocalHttp: boolean;
  readonly lookup?: typeof import("node:dns/promises").lookup;
  readonly requestImpl?: typeof import("node:https").request;
  readonly timeoutMs?: number;
}

type RequestImplementation = typeof import("node:https").request;

/** Represents a categorized provider-transport failure for safe boundary handling. */
export class ProviderTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ProviderTransportError";
  }
}

function safeStatus(response: IncomingMessage): number | undefined {
  return typeof response.statusCode === "number"
    ? response.statusCode
    : undefined;
}

function providerError(
  name: string,
  phase: "request" | "stream",
  status?: number,
  code?: string,
): Error {
  if (status !== undefined && status >= 100 && status <= 599) {
    return new Error(`${name} provider ${phase} failed (HTTP ${status})`);
  }
  if (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ABORT_ERR" ||
    code === "TIMEOUT"
  ) {
    return new Error(`${name} provider ${phase} failed (network timeout)`);
  }
  return new Error(`${name} provider ${phase} failed`);
}

function safeErrorCode(error: unknown): string | undefined {
  try {
    if (typeof error !== "object" || error === null) return undefined;
    const code = Reflect.get(error, "code");
    return typeof code === "string" ? code.toUpperCase() : undefined;
  } catch {
    return undefined;
  }
}

const SAFE_RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);

function safeRequestError(error: unknown): Error {
  const code = safeErrorCode(error);
  if (code === "ETIMEDOUT") {
    return new Error("provider request timeout (ETIMEDOUT)");
  }
  if (code !== undefined && SAFE_RETRYABLE_NETWORK_CODES.has(code)) {
    return new Error(`provider request failed (${code})`);
  }
  return new Error("provider request failed");
}

function safeBodyError(phase: "response" | "stream", error: unknown): Error {
  const code = safeErrorCode(error);
  if (code === "ETIMEDOUT") {
    return new Error(`provider ${phase} body timeout (ETIMEDOUT)`);
  }
  if (code !== undefined && SAFE_RETRYABLE_NETWORK_CODES.has(code)) {
    return new Error(`provider ${phase} body failed (${code})`);
  }
  return new Error(`provider ${phase} body failed`);
}

function endpointForRequest(endpoint: ApprovedProviderEndpoint): URL {
  const url = new URL(endpoint.url.href);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  return url;
}

function messagesFor(
  prompt: string,
  options: GenerateOptions,
): Array<{
  role: "system" | "user";
  content: string;
}> {
  return [
    ...(options.systemPrompt === undefined
      ? []
      : [{ role: "system" as const, content: options.systemPrompt }]),
    { role: "user", content: prompt },
  ];
}

function requestBody(
  model: string,
  prompt: string,
  options: GenerateOptions,
  stream: boolean,
): string {
  const body = {
    model,
    messages: messagesFor(prompt, options),
    ...(options.maxTokens === undefined
      ? {}
      : { max_tokens: options.maxTokens }),
    ...(options.temperature === undefined
      ? {}
      : { temperature: options.temperature }),
    stream,
    ...(options.responseFormat === "json"
      ? { response_format: { type: "json_object" as const } }
      : {}),
  };
  return JSON.stringify(body);
}

function responseText(payload: unknown, name: string): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(`${name} provider returned no text`);
  }
  let choices: unknown;
  try {
    choices = Reflect.get(payload, "choices");
  } catch {
    throw new Error(`${name} provider returned no text`);
  }
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error(`${name} provider returned no text`);
  }
  if (typeof choices[0] !== "object" || choices[0] === null) {
    throw new Error(`${name} provider returned no text`);
  }
  let message: unknown;
  try {
    message = Reflect.get(choices[0], "message");
  } catch {
    throw new Error(`${name} provider returned no text`);
  }
  if (typeof message !== "object" || message === null) {
    throw new Error(`${name} provider returned no text`);
  }
  let content: unknown;
  try {
    content = Reflect.get(message, "content");
  } catch {
    throw new Error(`${name} provider returned no text`);
  }
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error(`${name} provider returned no text`);
  }
  return content;
}

function safeJsonParse(body: string, name: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${name} provider returned malformed JSON`);
  }
}

function readBody(
  response: IncomingMessage,
  limit: number,
  phase: "response" | "stream",
): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    response.setEncoding("utf8");
    response.on("data", (chunk: string | Buffer) => {
      const value = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const bytes = Buffer.byteLength(value, "utf8");
      total += bytes;
      if (total > limit) {
        response.destroy();
        reject(new Error(`provider ${phase} body is too large`));
        return;
      }
      chunks.push(Buffer.from(value, "utf8"));
    });
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.on("error", (error: unknown) =>
      reject(safeBodyError(phase, error)),
    );
  });
}

function readSse(
  response: IncomingMessage,
  name: string,
  onToken: (token: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let total = 0;
    let buffer = "";
    let full = "";
    let sawDone = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      response.destroy();
      reject(error);
    };

    const finish = (): void => {
      if (settled) return;
      if (!sawDone) {
        fail(new Error(`${name} provider stream ended prematurely`));
        return;
      }
      if (full.trim() === "") {
        fail(new Error(`${name} provider returned no text`));
        return;
      }
      settled = true;
      resolve(full);
    };

    const processRecord = (record: string): void => {
      if (record.trim() === "" || sawDone) return;
      const dataLines: string[] = [];
      for (const line of record.split(/\r?\n/)) {
        if (line.startsWith("data:")) {
          const value = line.slice("data:".length);
          dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
          continue;
        }
        if (
          line.startsWith("event:") ||
          line.startsWith("id:") ||
          line.startsWith("retry:") ||
          line.startsWith(":")
        ) {
          continue;
        }
        throw new Error(`${name} provider stream failed`);
      }
      if (dataLines.length === 0) {
        throw new Error(`${name} provider stream failed`);
      }
      const data = dataLines.join("\n");
      if (data === "[DONE]") {
        sawDone = true;
        finish();
        return;
      }

      let payload: unknown;
      try {
        payload = safeJsonParse(data, name);
      } catch {
        throw new Error(`${name} provider stream failed`);
      }
      if (typeof payload !== "object" || payload === null) {
        throw new Error(`${name} provider stream failed`);
      }
      let choices: unknown;
      try {
        choices = Reflect.get(payload, "choices");
      } catch {
        throw new Error(`${name} provider stream failed`);
      }
      if (!Array.isArray(choices) || choices.length === 0) {
        throw new Error(`${name} provider stream failed`);
      }
      const choice = choices[0];
      if (typeof choice !== "object" || choice === null) {
        throw new Error(`${name} provider stream failed`);
      }
      let delta: unknown;
      try {
        delta = Reflect.get(choice, "delta");
      } catch {
        throw new Error(`${name} provider stream failed`);
      }
      if (typeof delta !== "object" || delta === null) {
        throw new Error(`${name} provider stream failed`);
      }
      let content: unknown;
      try {
        content = Reflect.get(delta, "content");
      } catch {
        throw new Error(`${name} provider stream failed`);
      }
      if (content !== undefined && typeof content !== "string") {
        throw new Error(`${name} provider stream failed`);
      }
      if (typeof content === "string" && content.length > 0) {
        full += content;
        onToken(content);
      }
    };

    const processChunk = (chunk: string | Buffer): void => {
      if (settled) return;
      const value = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      total += Buffer.byteLength(value, "utf8");
      if (total > MAX_PROVIDER_BODY_BYTES) {
        fail(new Error(`${name} provider stream body is too large`));
        return;
      }
      buffer += value;
      if (Buffer.byteLength(buffer, "utf8") > MAX_PROVIDER_BODY_BYTES) {
        fail(new Error(`${name} provider stream body is too large`));
        return;
      }
      try {
        for (;;) {
          const lfDelimiter = buffer.indexOf("\n\n");
          const crlfDelimiter = buffer.indexOf("\r\n\r\n");
          let delimiter = lfDelimiter;
          let delimiterLength = 2;
          if (
            crlfDelimiter !== -1 &&
            (delimiter === -1 || crlfDelimiter < delimiter)
          ) {
            delimiter = crlfDelimiter;
            delimiterLength = 4;
          }
          if (delimiter === -1) break;
          const record = buffer.slice(0, delimiter);
          buffer = buffer.slice(delimiter + delimiterLength);
          processRecord(record);
          if (settled) return;
        }
      } catch {
        fail(new Error(`${name} provider stream failed`));
      }
    };

    response.setEncoding("utf8");
    response.on("data", processChunk);
    response.once("end", () => {
      if (settled) return;
      try {
        if (buffer.trim() !== "") {
          processRecord(buffer);
          buffer = "";
        }
      } catch {
        fail(new Error(`${name} provider stream failed`));
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
              ? `${name} provider stream timeout (ETIMEDOUT)`
              : `${name} provider stream failed (${code})`,
          ),
        );
        return;
      }
      fail(new Error(`${name} provider stream failed`));
    });
  });
}

function requestOptions(
  url: URL,
  approved: ApprovedProviderEndpoint,
  apiKey: string,
  timeoutMs: number,
): import("node:https").RequestOptions {
  const address = approved.addresses[0];
  if (address === undefined) {
    throw new ProviderTransportError(
      "PROVIDER_ENDPOINT_NOT_APPROVED",
      "provider endpoint has no approved address",
    );
  }
  const options: import("node:https").RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname.replace(/^\[/, "").replace(/\]$/, ""),
    port: url.port === "" ? undefined : Number(url.port),
    path: url.pathname,
    method: "POST",
    headers: {
      Host: url.host,
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    servername: url.hostname.replace(/^\[/, "").replace(/\]$/, ""),
    timeout: timeoutMs,
    rejectUnauthorized: url.protocol === "https:",
    lookup: ((_hostname, _options, callback) =>
      callback(null, address.address, address.family)) as LookupFunction,
  };
  return options;
}

function performRequest(
  request: ClientRequest,
  body: string,
  responseHandler: (response: IncomingMessage) => Promise<string> | string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.once("error", (error: unknown) => fail(safeRequestError(error)));
    request.once("timeout", () => {
      fail(new Error("provider request timeout (ETIMEDOUT)"));
      request.destroy();
    });
    request.once("response", (response: IncomingMessage) => {
      let result: Promise<string> | string;
      try {
        result = responseHandler(response);
      } catch (error: unknown) {
        fail(
          error instanceof Error
            ? error
            : new Error("provider response failed"),
        );
        return;
      }
      Promise.resolve(result)
        .then((value) => {
          if (settled) return;
          settled = true;
          resolve(value as unknown as string);
        })
        .catch((error: unknown) =>
          fail(
            error instanceof Error
              ? error
              : new Error("provider response failed"),
          ),
        );
    });
    try {
      request.write(body);
      request.end();
    } catch (error: unknown) {
      fail(safeRequestError(error));
    }
  });
}

/** Secure OpenAI-compatible Chat Completions transport for selected origins. */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: ApprovedProviderEndpoint;
  private readonly allowLocalHttp: boolean;
  private readonly lookup: typeof import("node:dns/promises").lookup;
  private readonly requestImpl: RequestImplementation;
  private readonly timeoutMs: number;

  constructor(options: CompatibleTransportOptions) {
    if (
      options.name.length === 0 ||
      options.apiKey.length === 0 ||
      options.model.length === 0
    ) {
      throw new ProviderTransportError(
        "PROVIDER_CONFIGURATION_INVALID",
        "provider transport configuration is incomplete",
      );
    }
    this.name = options.name;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.endpoint = {
      url: new URL(options.endpoint.url.href),
      origin: options.endpoint.origin,
      local: options.endpoint.local,
      addresses: options.endpoint.addresses.map(({ address, family }) => ({
        address,
        family,
      })),
    };
    this.allowLocalHttp = options.allowLocalHttp;
    this.lookup = options.lookup ?? defaultLookup;
    this.requestImpl =
      options.requestImpl ??
      (this.endpoint.url.protocol === "http:" ? httpRequest : httpsRequest);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async execute(
    prompt: string,
    options: GenerateOptions,
    stream: boolean,
    onToken?: (token: string) => void,
  ): Promise<string> {
    const body = requestBody(this.model, prompt, options, stream);
    if (Buffer.byteLength(body, "utf8") > MAX_PROVIDER_BODY_BYTES) {
      throw new Error(`${this.name} provider request body is too large`);
    }

    const approved = await approveCompatibleEndpoint({
      rawUrl: this.endpoint.url.toString(),
      allowLocalHttp: this.allowLocalHttp,
      lookup: this.lookup,
    });
    if (approved.origin !== this.endpoint.origin) {
      throw new ProviderTransportError(
        "PROVIDER_ENDPOINT_CHANGED",
        "provider endpoint changed after approval",
      );
    }
    const url = endpointForRequest(approved);
    const optionsForRequest = requestOptions(
      url,
      approved,
      this.apiKey,
      this.timeoutMs,
    );
    let request: ClientRequest;
    try {
      request = this.requestImpl(optionsForRequest, () => undefined);
    } catch (error: unknown) {
      throw safeRequestError(error);
    }
    return performRequest(request, body, async (response) => {
      const status = safeStatus(response);
      if (status !== undefined && status >= 300 && status < 400) {
        response.resume();
        throw new ProviderTransportError(
          "PROVIDER_CROSS_ORIGIN_REDIRECT",
          "provider redirect rejected",
        );
      }
      if (status === undefined || status < 200 || status >= 300) {
        response.resume();
        throw providerError(this.name, stream ? "stream" : "request", status);
      }
      if (stream) {
        return readSse(response, this.name, onToken ?? (() => undefined));
      }
      const text = await readBody(
        response,
        MAX_PROVIDER_BODY_BYTES,
        "response",
      );
      return responseText(safeJsonParse(text, this.name), this.name);
    });
  }

  /** Sends one approved-compatible request and returns a non-empty text response. */
  async generate(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<string> {
    try {
      return await withRetry(() => this.execute(prompt, options, false), {
        maxRetries: 3,
      });
    } catch (error: unknown) {
      throw restoreTransportError(error);
    }
  }

  /** Streams one approved-compatible request and retries only before output is emitted. */
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
        return await this.execute(prompt, options, true, emit);
      } catch (error: unknown) {
        if (emitted) {
          return Promise.reject(
            new Error(`${this.name} provider stream failed after output`),
          );
        }
        throw error;
      }
    };
    try {
      return await withRetry(run, { maxRetries: 3 });
    } catch (error: unknown) {
      throw restoreTransportError(error);
    }
  }
}

function restoreTransportError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error("provider request failed");
  const match = /^(PROVIDER_[A-Z0-9_]+):/.exec(error.message);
  if (match === null) return error;
  return new ProviderTransportError(
    match[1],
    "provider transport rejected the request",
  );
}
