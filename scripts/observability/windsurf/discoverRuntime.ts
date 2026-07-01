export type DiscoveredRuntime = {
  logRoot: string | null;
  primaryLogPath: string | null;
  rendererLogPath: string | null;
};

export const discoverRuntime = (input?: Partial<DiscoveredRuntime>): DiscoveredRuntime => ({
  logRoot: input?.logRoot ?? null,
  primaryLogPath: input?.primaryLogPath ?? null,
  rendererLogPath: input?.rendererLogPath ?? null,
});
