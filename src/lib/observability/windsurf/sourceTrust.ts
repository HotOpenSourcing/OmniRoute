import type { ObservabilityTrustLevel } from "./types";

export type CollectorAdmissionInput = {
  collector: string;
  mode: "read_only";
  activationRequiresRuntimeChange: boolean;
  activationRequiresNewConnection: boolean;
  mayChangeRuntimeState: boolean;
  passivityEvidence: "documented" | "tested" | "assumed";
};

export type CollectorAdmissionRecord = CollectorAdmissionInput & {
  trustLevel: ObservabilityTrustLevel;
};

export const createCollectorAdmission = (
  input: CollectorAdmissionInput
): CollectorAdmissionRecord => {
  if (input.activationRequiresRuntimeChange || input.mayChangeRuntimeState) {
    return { ...input, trustLevel: "rejected" };
  }

  if (input.passivityEvidence === "assumed") {
    return { ...input, trustLevel: "passive_probable" };
  }

  return { ...input, trustLevel: "passive_proven" };
};

export const canInfluenceInference = (trustLevel: ObservabilityTrustLevel): boolean =>
  trustLevel === "passive_proven";
