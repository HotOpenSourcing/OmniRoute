/**
 * POST /api/v1/providers/freebuff/login/start
 *
 * Starts a new device-code login flow against Codebuff. Returns a
 * `loginUrl` the user must open in a browser, plus the `fingerprintHash`
 * and `expiresAt` the caller must persist to poll status.
 *
 * Auth: Bearer OmniRoute API key.
 *
 * Response shape: see `freebuffLoginStartSchema` (re-exported from
 * `src/lib/providers/freebuff/oauth.ts`) — wire format per rapport
 * `rapport-architecture-reseau-avance.md` §5.3.
 */

import { NextResponse } from "next/server";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  freebuffLoginStartSchema,
  startLogin,
  FreebuffMetaError,
} from "@/lib/providers/freebuff/metaService";

export async function POST(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json(
      { error: { message: "Authentication required", type: "auth_required" } },
      { status: 401 },
    );
  }

  try {
    const start = await startLogin();
    // `startLogin` returns the wire-format shape (loginUrl, fingerprintHash,
    // expiresAt) directly — no translation needed. The legacy `flowId`
    // field is kept on the internal API for backward compatibility with
    // older dashboard clients but is intentionally dropped from the wire.
    const wireShape = {
      loginUrl: start.loginUrl,
      fingerprintHash: start.fingerprintHash,
      expiresAt: start.expiresAt,
    };
    const parsed = freebuffLoginStartSchema.parse(wireShape);
    return NextResponse.json({ provider: "freebuff", login: parsed });
  } catch (error) {
    if (error instanceof FreebuffMetaError) {
      return NextResponse.json(
        { error: { message: error.message, type: error.code ?? "meta_error" } },
        { status: error.status },
      );
    }
    if (
      error instanceof Error &&
      error.message.includes("not implemented")
    ) {
      return NextResponse.json(
        {
          error: {
            message:
              "Freebuff meta-service not yet available — Chunk 4 must land first.",
            type: "not_implemented",
            code: "CHUNK_4_PENDING",
          },
        },
        { status: 501 },
      );
    }
    console.error("[freebuff/login/start] unexpected error:", error);
    return NextResponse.json(
      { error: { message: "Internal error", type: "internal_error" } },
      { status: 500 },
    );
  }
}
