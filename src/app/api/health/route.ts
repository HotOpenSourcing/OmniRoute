import { NextResponse } from "next/server";

/**
 * GET /api/health — canonical liveness probe, no auth required.
 *
 * Top-level health endpoint used by external load balancers and monitoring
 * services that probe a single `/health` path rather than the deeper
 * `/api/health/ping` or the heavy `/api/monitoring/health`.
 *
 * Deliberately minimal: `{ status, timestamp }` and nothing else. Whatever this returns is
 * public on an exposed instance, so version, uptime and memory stay behind the authenticated
 * `/api/monitoring/health`. For a probe that also confirms the database answers, use
 * `/api/health/ping`.
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
