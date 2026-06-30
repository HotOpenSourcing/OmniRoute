/**
 * DELETE /api/v1/providers/freebuff/session
 *
 * Releases the active Codebuff session — frees the PID-file lock so a
 * subsequent login (or another OmniRoute instance) can claim the slot.
 *
 * Auth: Bearer OmniRoute API key.
 *
 * Response: 204 No Content on success.
 */

import { NextResponse } from "next/server";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  releaseSession,
  FreebuffMetaError,
  resolveFreebuffConnectionId,
} from "@/lib/providers/freebuff/metaService";

export async function DELETE(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json(
      { error: { message: "Authentication required", type: "auth_required" } },
      { status: 401 },
    );
  }
  const connectionId = resolveFreebuffConnectionId(request);
  if (!connectionId) {
    return NextResponse.json(
      {
        error: {
          message: "Missing ?connectionId= query parameter",
          type: "missing_connection_id",
        },
      },
      { status: 400 },
    );
  }

  try {
    await releaseSession(connectionId);
    return new NextResponse(null, { status: 204 });
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
    console.error("[freebuff/session] unexpected error:", error);
    return NextResponse.json(
      { error: { message: "Internal error", type: "internal_error" } },
      { status: 500 },
    );
  }
}
