import { createHash } from "node:crypto";
import { getSafePlanErrorCode } from "../security/diagnostics";
import { PlanFailure, type PlanError, type SymbolChange } from "./types";

const PLAN_ERROR_FALLBACK: Readonly<PlanError> = Object.freeze({
  code: "PLAN_SOURCE_READ_FAILED",
  message: "Documentation impact planning failed.",
});

export function canonicalStringify(value: unknown): string {
  const canonical = canonicalize(value, new WeakSet<object>(), false);
  if (canonical === undefined) {
    throw new TypeError("Cannot canonicalize unsupported value.");
  }
  return serializeCanonical(canonical);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function toPlanError(error: unknown): PlanError {
  try {
    const planError = PlanFailure.read(error);
    if (
      planError === undefined ||
      getSafePlanErrorCode(planError) !== planError.code
    ) {
      return { ...PLAN_ERROR_FALLBACK };
    }
    return planError;
  } catch {
    return { ...PLAN_ERROR_FALLBACK };
  }
}

export function compareChangeKeys(a: SymbolChange, b: SymbolChange): number {
  return (
    compareStrings(a.path, b.path) ||
    compareStrings(a.kind, b.kind) ||
    compareStrings(a.qualifiedName ?? "", b.qualifiedName ?? "") ||
    compareStrings(a.category, b.category) ||
    compareStrings(a.id, b.id)
  );
}

function canonicalize(
  value: unknown,
  ancestors: WeakSet<object>,
  inArray: boolean,
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Cannot canonicalize non-finite number.");
    }
    return value;
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return inArray ? null : undefined;
  }
  if (typeof value === "bigint") {
    throw new TypeError("Cannot canonicalize bigint.");
  }

  if (ancestors.has(value)) {
    throw new TypeError("Cannot canonicalize cyclic value.");
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const canonical: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        canonical.push(canonicalize(value[index], ancestors, true));
      }
      return canonical;
    }

    const canonical: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const entry = canonicalize(
        (value as Record<string, unknown>)[key],
        ancestors,
        false,
      );
      if (entry !== undefined) canonical[key] = entry;
    }
    return canonical;
  } finally {
    ancestors.delete(value);
  }
}

function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function serializeCanonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const entries: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      entries.push(index in value ? serializeCanonical(value[index]) : "null");
    }
    return `[${entries.join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  const fields = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeCanonical(object[key])}`);
  return `{${fields.join(",")}}`;
}
