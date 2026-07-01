import type { RouteDecision } from "./types";

export interface ExecutorLike {
  execute(input: unknown): Promise<{
    response: Response;
    url?: string;
    headers?: Headers | Record<string, string>;
    transformedBody?: unknown;
  }>;
  refreshCredentials?: (...args: unknown[]) => Promise<unknown> | unknown;
}

export interface ExecutorFactory {
  getLocalExecutor(provider: string): ExecutorLike;
  getCloudExecutor(provider: string): ExecutorLike;
  getHybridExecutor(provider: string): ExecutorLike;
}

export class ExecutionAdapter {
  constructor(private readonly factory: ExecutorFactory) {}

  resolve(decision: RouteDecision) {
    if (typeof decision.provider !== "string" || decision.provider.trim().length === 0) {
      throw new Error("RouteDecision provider is required for executor resolution");
    }

    const provider = decision.provider.trim();
    if (decision.primary === "local_ls") {
      return this.factory.getLocalExecutor(provider);
    }
    if (decision.primary === "hybrid") return this.factory.getHybridExecutor(provider);
    return this.factory.getCloudExecutor(provider);
  }
}
