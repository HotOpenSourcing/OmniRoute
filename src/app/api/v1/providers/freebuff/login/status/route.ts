/**
 * GET /api/v1/providers/freebuff/login/status?flowId=...
 *
 * Polls the status of an in-flight PKCE login flow. The dashboard calls
 * this every ~2 seconds after redirecting the user to the `loginUrl`.
 *
 * Auth: Bearer OmniRoute API key.
 *
 * Query params:
 *   - flowId (uuid, required)
 *
 * Response shape: see `freebuffLoginStatusSchema` in
 * `src/lib/providers/freebuff/metaService.ts`.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  freebuffLoginStatusSchema,
  pollLoginStatus,
  FreebuffMetaError,
} from "@/lib/providers/freebuff/metaService";
import { freebuffUuidSchema } from "@/shared/schemas/providers/freebuff";

const querySchema = z.object({
  flowId: freebuffUuidSchema,
});

export async function GET(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json(
      { error: { message: "Authentication required", type: "auth_required" } },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const rawParams = {
    flowId: url.searchParams.get("flowId") ?? undefined,
  };
  const parsedQuery = querySchema.safeParse(rawParams);
  if (!parsedQuery.success) {
    return NextResponse.json(
      {
        error: {
          message: "Invalid or missing flowId query parameter",
          type: "validation_error",
          issues: parsedQuery.error.issues,
        },
      },
      { status: 400 },
    );
  }

  try {
    const status = await pollLoginStatus(parsedQuery.data.flowId);
    const parsed = freebuffLoginStatusSchema.parse(status);
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
    console.error("[freebuff/login/status] unexpected error:", error);
    return NextResponse.json(
      { error: { message: "Internal error", type: "internal_error" } },
      { status: 500 },
    );
  }
}
