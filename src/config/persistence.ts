import { RepositoryWriteScope } from "../security/repository-writer";
import type { AidocConfig } from "./schema";
import type { ResolvedProviderSelection } from "../providers/selection";
import { ProviderConfigurationError } from "../providers/errors";

const CONFIG_FILE = ".aidocrc.json";
const CONFIG_NOT_WRITABLE = "PROVIDER_CONFIG_NOT_WRITABLE";
const PERSISTED_SELECTION_KEYS = [
  "provider",
  "model",
  "providerBaseUrl",
  "allowLocalHttp",
  "qwenRegion",
  "qwenWorkspaceId",
] as const;

function parseExistingConfig(text: string | null): Record<string, unknown> {
  if (text === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(CONFIG_NOT_WRITABLE);
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(CONFIG_NOT_WRITABLE);
  }
  if (Object.prototype.hasOwnProperty.call(value, "apiKey")) {
    throw new Error(CONFIG_NOT_WRITABLE);
  }
  return value as Record<string, unknown>;
}

function persistedSelection(
  selection: ResolvedProviderSelection,
  qwen: { region: AidocConfig["qwenRegion"]; workspaceId?: string } | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    provider: selection.provider,
  };
  if (selection.model !== undefined) result.model = selection.model;

  if (
    selection.provider === "openai-compatible" &&
    selection.endpoint !== undefined
  ) {
    const endpointUrl = selection.endpoint.url;
    if (
      (endpointUrl.protocol !== "http:" && endpointUrl.protocol !== "https:") ||
      endpointUrl.username.length > 0 ||
      endpointUrl.password.length > 0 ||
      endpointUrl.search.length > 0 ||
      endpointUrl.hash.length > 0
    ) {
      throw new ProviderConfigurationError("PROVIDER_INVALID_ENDPOINT");
    }
    result.providerBaseUrl = endpointUrl.href;
    if (selection.endpoint.local && endpointUrl.protocol === "http:") {
      result.allowLocalHttp = true;
    }
  }
  const qwenMetadata = qwen ?? selection.qwen;
  if (selection.provider === "qwen" && qwenMetadata?.region !== undefined) {
    result.qwenRegion = qwenMetadata.region;
  }
  if (
    selection.provider === "qwen" &&
    qwenMetadata?.workspaceId !== undefined
  ) {
    result.qwenWorkspaceId = qwenMetadata.workspaceId;
  }
  return result;
}

/** Persists only non-secret provider choice metadata through the atomic writer. */
export async function rememberProviderSelection(
  cwd: string,
  selection: ResolvedProviderSelection,
  qwen?: { region: AidocConfig["qwenRegion"]; workspaceId?: string },
): Promise<void> {
  const scope = await RepositoryWriteScope.open(cwd);
  const target = await scope.prepare(CONFIG_FILE);
  const current = parseExistingConfig(target.existingText);
  const next = { ...current };
  for (const key of PERSISTED_SELECTION_KEYS) delete next[key];
  Object.assign(next, persistedSelection(selection, qwen));
  await target.replaceText(`${JSON.stringify(next, null, 2)}\n`);
}
