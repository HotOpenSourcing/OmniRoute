/**
 * GET /api/v1/providers/freebuff/login/status?fingerprintId=...&fingerprintHash=...&expiresAt=...
 *
 * Polls the status of an in-flight device-code login flow. The dashboard
 * calls this every ~5 seconds after redirecting the user to the `loginUrl`,
 * passing the `fingerprintHash` + `expiresAt` returned by `/login/start`.
 *
 * Auth: Bearer OmniRoute API key.
 *
 * Query params:
 *   - fingerprintId    (string, required)
 *   - fingerprintHash  (hex sha-256, 64 chars, required)
 *   - expiresAt        (ISO-8601 datetime, required)
 *
 * Response shape: see `freebuffLoginStatusSchema` (re-exported from
 * `src/lib/providers/freebuff/oauth.ts`) — discriminated union on `status`.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  freebuffLoginStatusSchema,
  pollLoginStatus,
  FreebuffMetaError,
} from "@/lib/providers/freebuff/metaService";

const querySchema = z.object({
  fingerprintId: z.string().min(1),
  fingerprintHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(),
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
    fingerprintId: url.searchParams.get("fingerprintId") ?? undefined,
    fingerprintHash: url.searchParams.get("fingerprintHash") ?? undefined,
    expiresAt: url.searchParams.get("expiresAt") ?? undefined,
  };
  const parsedQuery = querySchema.safeParse(rawParams);
  if (!parsedQuery.success) {
    return NextResponse.json(
      {
        error: {
          message:
            "Invalid or missing query parameter (fingerprintId, fingerprintHash, expiresAt all required)",
          type: "validation_error",
          issues: parsedQuery.error.issues,
        },
      },
      { status: 400 },
    );
  }

  try {
    const status = await pollLoginStatus({
      fingerprintId: parsedQuery.data.fingerprintId,
      fingerprintHash: parsedQuery.data.fingerprintHash,
      expiresAt: parsedQuery.data.expiresAt,
    });
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
