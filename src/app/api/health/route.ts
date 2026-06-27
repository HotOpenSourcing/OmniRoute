import { NextResponse } from "next/server";

/**
 * GET /api/health — Lightweight liveness probe (root)
 *
 * Top-level health endpoint used by external load balancers and monitoring
 * services that probe a single `/health` path rather than the deeper
 * `/api/health/ping` or the heavy `/api/monitoring/health`.
 *
 * Returns `{ status: "ok", timestamp }` on success, or HTTP 503 on failure.
 * No auth required — public liveness signal (classified via
 * PUBLIC_READONLY_API_ROUTE_PREFIXES in publicApiRoutes.ts).
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("[health] Unexpected error in GET /api/health:", error);
    return NextResponse.json(
      { status: "error", error: "health_check_failed" },
      { status: 503 }
    );
  }
}
