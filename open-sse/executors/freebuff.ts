import {
  BaseExecutor,
  type ExecuteInput,
  type ProviderCredentials,
} from "./base.ts";
import { PROVIDERS } from "../config/constants.ts";
import { sanitizeErrorMessage } from "../utils/error.ts";
import { routeFreebuffChat } from "../../src/lib/providers/freebuff/chatIntegration.ts";

/**
 * Freebuff (Codebuff Free Tier) executor.
 *
 * The Codebuff upstream requires a proprietary wire envelope (top-level
 * `runId`, `provider`, `codebuff_metadata`, plus pre-acquired seat and
 * registered agent run). All of that logic lives in
 * `src/lib/providers/freebuff/chatIntegration.ts::routeFreebuffChat` —
 * this executor is a thin adapter that delegates to it.
 *
 * Flow:
 *   1. Extract `connectionId` from `input.credentials.connectionId`
 *      (set by `chatCore` upstream of the executor dispatch).
 *   2. Call `routeFreebuffChat` with the parsed body, the connection id,
 *      and the OpenAI wire format (the only format exposed via
 *      `/v1/chat/completions`).
 *   3. Return the resulting Response in the standard
 *      `{ response, url, headers, transformedBody }` shape so combo /
 *      account fallback logic in `chatCore` can trigger on errors.
 *
 * Errors are mapped to typed JSON Responses (401 / 502 / 503) so the
 * downstream fallback chain can react. The synthetic `Request` passed
 * to `routeFreebuffChat` is unused by the implementation but is required
 * by the signature.
 */
export class FreebuffExecutor extends BaseExecutor {
  constructor(providerId = "freebuff") {
    super(providerId, PROVIDERS[providerId] || PROVIDERS.freebuff);
  }

  async execute({
    body,
    credentials,
    signal,
    log,
  }: ExecuteInput): Promise<{
    response: Response;
    url: string;
    headers: Record<string, string>;
    transformedBody: unknown;
  }> {
    const connectionId = extractConnectionId(credentials);

    if (!connectionId) {
      return {
        response: jsonError(
          401,
          "Freebuff connection id is required. Please sign in or paste credentials.json.",
          "authentication_error",
        ),
        url: "https://www.codebuff.com",
        headers: { "Content-Type": "application/json" },
        transformedBody: body,
      };
    }

    // Synthetic Request — `routeFreebuffChat` ignores it (param `_request`).
    const syntheticRequest = new Request("http://internal/freebuff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    try {
      const response = await routeFreebuffChat(syntheticRequest, body, {
        userId: "",
        connectionId,
        format: "openai",
        ...(signal != null ? { signal } : {}),
      });

      log?.info?.(
        "FreebuffExecutor",
        `freebuff upstream responded with status ${response.status}`,
      );

      return {
        response,
        url: "https://www.codebuff.com/api/v1/chat/completions",
        headers: { "Content-Type": "application/json" },
        transformedBody: body,
      };
    } catch (err) {
      const error = err as Error;
      if (error?.name === "AbortError") {
        throw err;
      }
      log?.error?.(
        "FreebuffExecutor",
        `freebuff upstream error: ${sanitizeErrorMessage(error?.message ?? "unknown")}`,
      );
      return {
        response: jsonError(
          502,
          `Freebuff upstream error: ${sanitizeErrorMessage(error?.message ?? "unknown error")}`,
          "provider_error",
        ),
        url: "https://www.codebuff.com/api/v1/chat/completions",
        headers: { "Content-Type": "application/json" },
        transformedBody: body,
      };
    }
  }
}

function extractConnectionId(credentials: ProviderCredentials): string | null {
  const direct = credentials.connectionId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const psd = credentials.providerSpecificData;
  if (psd && typeof psd === "object") {
    const fromPsd = (psd as Record<string, unknown>).connectionId;
    if (typeof fromPsd === "string" && fromPsd.trim()) return fromPsd.trim();
  }

  return null;
}

function jsonError(
  status: number,
  message: string,
  type: string,
): Response {
  return new Response(
    JSON.stringify({
      error: { message, type },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export default FreebuffExecutor;
