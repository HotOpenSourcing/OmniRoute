/**
 * GET /api/v1/providers/freebuff/streak
 *
 * Returns the gamification streak state for the authenticated Freebuff user.
 *
 * Auth: Bearer OmniRoute API key.
 *
 * Response shape: see `freebuffStreakSchema` in
 * `src/lib/providers/freebuff/metaService.ts`.
 */

import { NextResponse } from "next/server";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  freebuffStreakSchema,
  getStreak,
  FreebuffMetaError,
  resolveFreebuffConnectionId,
} from "@/lib/providers/freebuff/metaService";

export async function GET(request: Request) {
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
    const streak = await getStreak(connectionId);
    const parsed = freebuffStreakSchema.parse(streak);
    return NextResponse.json({ provider: "freebuff", streak: parsed });
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
    console.error("[freebuff/streak] unexpected error:", error);
    return NextResponse.json(
      { error: { message: "Internal error", type: "internal_error" } },
      { status: 500 },
    );
  }
}
