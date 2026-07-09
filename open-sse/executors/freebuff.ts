import {
  BaseExecutor,
  type ExecuteInput,
  type ProviderCredentials,
} from "./base.ts";
import { PROVIDERS } from "../config/constants.ts";
import { sanitizeErrorMessage } from "../utils/error.ts";
import {
  emulateChat,
  FreebuffChainExhaustedError,
  FreebuffAuthError,
  type FreebuffCredentials,
} from "../../src/lib/providers/freebuff/cliEmulator/index.ts";

/**
 * Freebuff (Codebuff Free Tier) executor.
 *
 * Bridges the OmniRoute SSE dispatcher (`open-sse/handlers/chatCore`) and
 * the Freebuff CLI emulator (`src/lib/providers/freebuff/cliEmulator/`).
 *
 * Flow:
 *   1. Extract `connectionId` from `input.credentials.connectionId` so we
 *      can fail fast on misconfigured connections.
 *   2. Map the OmniRoute `ProviderCredentials` to the emulator's
 *      `FreebuffCredentials` shape (authToken + fingerprintId +
 *      fingerprintHash). Two storage paths are supported, mirroring the
 *      legacy `chatIntegration.loadFreebuffCredentials` logic:
 *        a. `apiKey` JSON blob (meta-service path)
 *        b. `accessToken` + `providerSpecificData` (OAuth import-token path)
 *   3. Delegate to `emulateChat()` which walks the fallback chain,
 *      acquires a queue seat, registers an agent run, and pipes the
 *      upstream SSE stream back through the caller's transformer.
 *   4. Return the resulting Response in the standard
 *      `{ response, url, headers, transformedBody }` shape so combo /
 *      account fallback logic in `chatCore` can react on errors.
 *
 * Errors are mapped to typed JSON Responses (401 / 502) so the downstream
 * fallback chain can react. The emulator's typed errors
 * (`FreebuffAuthError`, `FreebuffChainExhaustedError`) are translated
 * into HTTP responses with stable `type` discriminators.
 *
 * The legacy `routeFreebuffChat` path in `chatIntegration.ts` is kept
 * for backwards compatibility but is no longer invoked from this
 * executor — the emulator is now the single source of truth.
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

    const freebuffCreds = extractFreebuffCredentials(credentials);
    if (!freebuffCreds) {
      return {
        response: jsonError(
          401,
          "Freebuff credentials (authToken + fingerprintId) are missing. Re-authenticate via the Freebuff dashboard.",
          "authentication_error",
        ),
        url: "https://www.codebuff.com",
        headers: { "Content-Type": "application/json" },
        transformedBody: body,
      };
    }

    let chatInput;
    try {
      chatInput = parseChatInput(body);
    } catch (err) {
      return {
        response: jsonError(
          400,
          err instanceof Error ? err.message : "Invalid request body",
          "validation_error",
        ),
        url: "https://www.codebuff.com",
        headers: { "Content-Type": "application/json" },
        transformedBody: body,
      };
    }

    try {
      const result = await emulateChat(chatInput, {
        credentials: freebuffCreds,
        format: "openai",
        ...(signal != null ? { signal } : {}),
      });

      log?.info?.(
        "FreebuffExecutor",
        `freebuff upstream responded with status ${result.response.status} ` +
          `(model=${result.servedModel}, tier=${result.servedTier}, ` +
          `agent=${result.agent}, attempts=${result.fallbackAttempts})`,
      );

      return {
        response: result.response,
        url: "https://www.codebuff.com/api/v1/chat/completions",
        headers: { "Content-Type": "application/json" },
        transformedBody: body,
      };
    } catch (err) {
      const error = err as Error;
      if (error?.name === "AbortError") {
        throw err;
      }

      // Auth errors → 401 with `unauthenticated` discriminator.
      if (err instanceof FreebuffAuthError) {
        log?.error?.(
          "FreebuffExecutor",
          `freebuff auth error: ${sanitizeErrorMessage(error.message)}`,
        );
        return {
          response: jsonError(401, error.message, "unauthenticated"),
          url: "https://www.codebuff.com/api/v1/chat/completions",
          headers: { "Content-Type": "application/json" },
          transformedBody: body,
        };
      }

      // Chain exhausted → 502 with attempt summary.
      if (err instanceof FreebuffChainExhaustedError) {
        const summary = err.attempts
          .map((a) => `${a.model}/${a.tier}: ${a.error}`)
          .join("; ");
        log?.error?.(
          "FreebuffExecutor",
          `freebuff chain exhausted (${err.attempts.length} attempts): ${sanitizeErrorMessage(summary)}`,
        );
        return {
          response: jsonError(
            502,
            `Freebuff fallback chain exhausted (${err.attempts.length} attempts): ${summary}`,
            "chain_exhausted",
          ),
          url: "https://www.codebuff.com/api/v1/chat/completions",
          headers: { "Content-Type": "application/json" },
          transformedBody: body,
        };
      }

      // Anything else → 502 with sanitized message.
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

// ---------------------------------------------------------------------------
// Helpers — credential extraction.
// ---------------------------------------------------------------------------

/**
 * Map the OmniRoute `ProviderCredentials` to the emulator's
 * `FreebuffCredentials` shape.
 *
 * Two storage paths are supported (same logic as
 * `chatIntegration.loadFreebuffCredentials`):
 *
 *   1. `apiKey` as a JSON blob — legacy meta-service path.
 *   2. `accessToken` (decrypted bearer) + `providerSpecificData` —
 *      OAuth import-token flow where the user pastes `credentials.json`.
 *
 * Returns `null` when neither path yields a valid fingerprint triple.
 */
export function extractFreebuffCredentials(
  credentials: ProviderCredentials,
): FreebuffCredentials | null {
  // Path 1: apiKey as JSON blob.
  if (credentials.apiKey) {
    try {
      const parsed = JSON.parse(credentials.apiKey);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.authToken === "string" &&
        typeof parsed.fingerprintId === "string" &&
        typeof parsed.fingerprintHash === "string"
      ) {
        return buildCredentials({
          authToken: parsed.authToken,
          fingerprintId: parsed.fingerprintId,
          fingerprintHash: parsed.fingerprintHash,
          userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
          email: typeof parsed.email === "string" ? parsed.email : undefined,
          name: typeof parsed.name === "string" ? parsed.name : undefined,
        });
      }
    } catch {
      // fall through to path 2
    }
  }

  // Path 2: accessToken + providerSpecificData.
  if (credentials.accessToken) {
    const psd = credentials.providerSpecificData;
    if (psd && typeof psd === "object") {
      const fingerprintId = (psd as Record<string, unknown>).fingerprintId;
      const fingerprintHash = (psd as Record<string, unknown>).fingerprintHash;
      if (
        typeof fingerprintId === "string" &&
        /^enhanced-[A-Za-z0-9_-]{43}$/.test(fingerprintId) &&
        typeof fingerprintHash === "string"
      ) {
        return buildCredentials({
          authToken: credentials.accessToken,
          fingerprintId,
          fingerprintHash,
        });
      }
    }
  }

  return null;
}

/**
 * Build a `FreebuffCredentials` value, dropping undefined optional fields so
 * the returned object matches the readonly interface exactly.
 */
function buildCredentials(input: {
  authToken: string;
  fingerprintId: string;
  fingerprintHash: string;
  userId?: string;
  email?: string;
  name?: string;
}): FreebuffCredentials {
  const out: {
    authToken: string;
    fingerprintId: string;
    fingerprintHash: string;
    userId?: string;
    email?: string;
    name?: string;
  } = {
    authToken: input.authToken,
    fingerprintId: input.fingerprintId,
    fingerprintHash: input.fingerprintHash,
  };
  if (input.userId !== undefined) out.userId = input.userId;
  if (input.email !== undefined) out.email = input.email;
  if (input.name !== undefined) out.name = input.name;
  return out;
}

/**
 * Validate and narrow the incoming body into the `FreebuffChatInput`
 * shape consumed by `emulateChat`. The body is already OpenAI-shaped
 * (the upstream HTTP handler parses it as JSON), so we only enforce the
 * minimum required fields.
 */
function parseChatInput(body: unknown): {
  model: string;
  messages: ReadonlyArray<unknown>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  tools?: unknown;
  tool_choice?: unknown;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid request body: expected a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (typeof b.model !== "string" || b.model.length === 0) {
    throw new Error("Missing or invalid `model` field");
  }
  if (!Array.isArray(b.messages)) {
    throw new Error("Missing or invalid `messages` field");
  }
  const out: {
    model: string;
    messages: ReadonlyArray<unknown>;
    stream?: boolean;
    max_tokens?: number;
    temperature?: number;
    tools?: unknown;
    tool_choice?: unknown;
  } = {
    model: b.model,
    messages: b.messages,
  };
  if (typeof b.stream === "boolean") out.stream = b.stream;
  if (typeof b.max_tokens === "number") out.max_tokens = b.max_tokens;
  if (typeof b.temperature === "number") out.temperature = b.temperature;
  if (b.tools !== undefined) out.tools = b.tools;
  if (b.tool_choice !== undefined) out.tool_choice = b.tool_choice;
  return out;
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
