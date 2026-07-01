import type { ExecuteInput } from "./base.ts";
import { WindsurfExecutor } from "./windsurf.ts";

export class WindsurfLocalExecutor extends WindsurfExecutor {
  constructor() {
    super();
    this.provider = "windsurf-local";
  }

  async execute(input: ExecuteInput) {
    return super.execute({
      ...input,
      model: typeof input.model === "string" ? input.model.replace(/^windsurf-local\//, "windsurf/") : input.model,
      body:
        typeof input.body === "object" && input.body !== null
          ? {
              ...(input.body as Record<string, unknown>),
              model:
                typeof (input.body as { model?: unknown }).model === "string"
                  ? String((input.body as { model: string }).model).replace(/^windsurf-local\//, "windsurf/")
                  : (input.body as { model?: unknown }).model,
            }
          : input.body,
    });
  }
}

export default WindsurfLocalExecutor;
