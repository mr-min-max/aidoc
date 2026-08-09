import {
  applySecretPolicy,
  RedactionSession,
  sanitizeDiagnostic,
} from "./scanner";
import { FindingSummary } from "./types";
import { PLAN_ERROR_CODES, type PlanErrorCode } from "../impact/types";

/** Stable, value-free diagnostic used when unknown errors cannot be inspected safely. */
export const UNKNOWN_ERROR_DIAGNOSTIC = "Unknown error.";
const TRUST_POLICY_REJECTION_CODES = new Set(["TRUST_SECRET_BLOCKED"]);

/** A diagnostic that is safe to log or return to a caller. */
export interface SafeErrorDiagnostic {
  message: string;
  findings: FindingSummary[];
}

/** The result of reading an error code without trusting arbitrary error objects. */
export interface SafeAllowlistedCodeInspection {
  code: string | undefined;
  hasUntrustedCode: boolean;
}

/**
 * Reads an unknown thrown value without coercion or instanceof checks, then redacts it.
 *
 * Any hostile property access or sanitizer failure returns one fixed value-free fallback.
 */
export function getSafeErrorDiagnostic(error: unknown): SafeErrorDiagnostic {
  try {
    const message = readSafeMessage(error);
    if (message === undefined) return unknownDiagnostic();

    const sanitized = sanitizeDiagnostic(message);
    if (typeof sanitized !== "string") return unknownDiagnostic();

    return {
      message: sanitized,
      findings: applySecretPolicy(message, "redact", new RedactionSession())
        .findings,
    };
  } catch {
    return unknownDiagnostic();
  }
}

/** Safely returns an allowlisted stable error code without inspecting other error state. */
export function getSafeAllowlistedErrorCode(
  error: unknown,
  allowedCodes: ReadonlySet<string>,
): string | undefined {
  return inspectSafeAllowlistedErrorCode(error, allowedCodes).code;
}

/** Safely returns a stable documentation-impact planning error code. */
export function getSafePlanErrorCode(
  error: unknown,
): PlanErrorCode | undefined {
  return getSafeAllowlistedErrorCode(error, PLAN_ERROR_CODES) as
    | PlanErrorCode
    | undefined;
}

/**
 * Distinguishes a missing code from an unallowlisted or hostile one.
 * Callers that expose errors across a protocol boundary can fail closed for
 * the latter without ever coercing the original thrown value.
 */
export function inspectSafeAllowlistedErrorCode(
  error: unknown,
  allowedCodes: ReadonlySet<string>,
): SafeAllowlistedCodeInspection {
  try {
    if (typeof error !== "object" || error === null) {
      return { code: undefined, hasUntrustedCode: false };
    }
    if (!Reflect.has(error, "code")) {
      return { code: undefined, hasUntrustedCode: false };
    }
    const code = Reflect.get(error, "code");
    return typeof code === "string" && allowedCodes.has(code)
      ? { code, hasUntrustedCode: false }
      : { code: undefined, hasUntrustedCode: true };
  } catch {
    return { code: undefined, hasUntrustedCode: true };
  }
}

/** Maps only safely extracted Trust Gate policy codes to CLI input-rejection status. */
export function getTrustErrorExitCode(error: unknown): 1 | 2 {
  return getSafeAllowlistedErrorCode(error, TRUST_POLICY_REJECTION_CODES) ===
    "TRUST_SECRET_BLOCKED"
    ? 2
    : 1;
}

function readSafeMessage(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (typeof error !== "object" || error === null) return undefined;

  // Force proxy prototype traps through the same guarded path. We deliberately
  // do not use the value (or `instanceof`); an object that cannot safely expose
  // its basic reflective surface is not safe to turn into a diagnostic.
  Reflect.getPrototypeOf(error);
  const message = Reflect.get(error, "message");
  return typeof message === "string" ? message : undefined;
}

function unknownDiagnostic(): SafeErrorDiagnostic {
  return { message: UNKNOWN_ERROR_DIAGNOSTIC, findings: [] };
}
