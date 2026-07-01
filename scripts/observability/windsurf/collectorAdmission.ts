import { createCollectorAdmission } from "@/lib/observability/windsurf";

export const buildCollectorAdmissions = () => ({
  logCollector: createCollectorAdmission({
    collector: "logCollector",
    mode: "read_only",
    activationRequiresRuntimeChange: false,
    activationRequiresNewConnection: false,
    mayChangeRuntimeState: false,
    passivityEvidence: "documented",
  }),
  processCollector: createCollectorAdmission({
    collector: "processCollector",
    mode: "read_only",
    activationRequiresRuntimeChange: false,
    activationRequiresNewConnection: false,
    mayChangeRuntimeState: false,
    passivityEvidence: "documented",
  }),
  cdpCollector: createCollectorAdmission({
    collector: "cdpCollector",
    mode: "read_only",
    activationRequiresRuntimeChange: false,
    activationRequiresNewConnection: true,
    mayChangeRuntimeState: false,
    passivityEvidence: "assumed",
  }),
  localTrafficCollector: createCollectorAdmission({
    collector: "localTrafficCollector",
    mode: "read_only",
    activationRequiresRuntimeChange: false,
    activationRequiresNewConnection: true,
    mayChangeRuntimeState: false,
    passivityEvidence: "assumed",
  }),
  ipcPassiveCollector: createCollectorAdmission({
    collector: "ipcPassiveCollector",
    mode: "read_only",
    activationRequiresRuntimeChange: false,
    activationRequiresNewConnection: true,
    mayChangeRuntimeState: false,
    passivityEvidence: "assumed",
  }),
});
