/**
 * GET /api/v1/providers/freebuff/quota
 *
 * Returns the current quota state for the authenticated Freebuff user.
 *
 * Auth: Bearer OmniRoute API key (validated by `isAuthenticated`).
 *
 * Response shape: see `freebuffQuotaStateSchema` in
 * `src/lib/providers/freebuff/metaService.ts`.
 */

import { NextResponse } from "next/server";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  freebuffQuotaStateSchema,
  getQuotaState,
  FreebuffMetaError,
} from "@/lib/providers/freebuff/metaService";

export async function GET(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json(
      { error: { message: "Authentication required", type: "auth_required" } },
      { status: 401 },
    );
  }

  try {
    const quota = await getQuotaState();
    // Re-validate the response at the route boundary — defends against
    // upstream schema drift after Chunk 4 lands.
    const parsed = freebuffQuotaStateSchema.parse(quota);
    return NextResponse.json({ provider: "freebuff", quota: parsed });
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
    console.error("[freebuff/quota] unexpected error:", error);
    return NextResponse.json(
      { error: { message: "Internal error", type: "internal_error" } },
      { status: 500 },
    );
  }
}
