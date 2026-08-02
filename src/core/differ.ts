import type { ImpactProviderContext } from "../impact/types";

export interface UpdateContext {
  existingDoc: string;
  impactPlan: ImpactProviderContext;
}

/** Builds the bounded, value-free context needed for a planned update. */
export function buildUpdateContext(
  existingDoc: string,
  impactPlan: ImpactProviderContext,
): UpdateContext {
  return { existingDoc, impactPlan };
}
