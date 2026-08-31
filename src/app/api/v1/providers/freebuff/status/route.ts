/**
 * GET /api/v1/providers/freebuff/status
 *
 * Returns the token-TTL status snapshot for one or all Freebuff connections.
 * The dashboard polls this endpoint to render the "Session expiring soon"
 * banner that prompts a re-auth via FreebuffOAuthWrapper.
 *
 * Response shape:
 *
 *   GET /api/v1/providers/freebuff/status?connectionId=<id>
 *   → { status: { connectionId, state, tokenExpiresAt, remainingMs, ... } }
 *
 *   GET /api/v1/providers/freebuff/status        (no connectionId)
 *   → { statuses: [ ...FreebuffConnectionStatus ] }
 *
 *   GET /api/v1/providers/freebuff/status?expiringOnly=true
 *   → { statuses: [ ...FreebuffConnectionStatus where state !== "active" ] }
 *
 * Auth: Bearer OmniRoute API key (same as other /api/v1/providers/* routes).
 */

import { NextResponse } from "next/server";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  listFreebuffConnectionStatuses,
  getFreebuffConnectionStatus,
} from "@/lib/providers/freebuff/metaService";

export async function GET(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json(
      { error: { message: "Authentication required", type: "auth_required" } },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId") ?? undefined;
  const expiringOnly = url.searchParams.get("expiringOnly") === "true";

  try {
    if (connectionId) {
      const status = await getFreebuffConnectionStatus(connectionId);
      return NextResponse.json({ status });
    }
    let statuses = await listFreebuffConnectionStatuses();
    if (expiringOnly) {
      statuses = statuses.filter((s) => s.isExpiring || s.hasUnknownTtl);
    }
    return NextResponse.json({ statuses });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not_found")) {
      return NextResponse.json(
        { error: { message: err.message, type: "not_found" } },
        { status: 404 },
      );
    }
    console.error("[freebuff/status] unexpected error:", err);
    return NextResponse.json(
      { error: { message: "Internal error", type: "internal_error" } },
      { status: 500 },
    );
  }
}
