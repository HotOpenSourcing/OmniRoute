import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

// POST /api/providers/[id]/import-provider - Import connections into a provider
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id: providerId } = await params;
    const body = await request.json();
    const connectionsToImport: any[] = body.connections || [];

    if (!Array.isArray(connectionsToImport) || connectionsToImport.length === 0) {
      return NextResponse.json({ error: "No connections provided" }, { status: 400 });
    }

    // Deduplicate by name or apiKey
    const seenKeys = new Set<string>();
    const deduped = connectionsToImport.filter((conn) => {
      const key = conn.apiKey || conn.accessToken || conn.name || "";
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    let imported = 0;
    let errors = 0;
    const results: { name: string; status: string; error?: string }[] = [];

    for (const conn of deduped) {
      try {
        const createBody: Record<string, unknown> = {
          provider: providerId,
          name: conn.name || conn.email || `Imported ${Date.now()}`,
          apiKey: conn.apiKey || conn.accessToken || conn.idToken || "",
          authType: conn.authType || "apikey",
          isActive: conn.isActive !== false,
          priority: conn.priority || 1,
          globalPriority: conn.globalPriority ?? null,
          defaultModel: conn.defaultModel ?? null,
          maxConcurrent: conn.maxConcurrent ?? null,
          proxyEnabled: conn.proxyEnabled ?? null,
          perKeyProxyEnabled: conn.perKeyProxyEnabled ?? null,
          disableCooldown: conn.disableCooldown ?? null,
          healthCheckIntervalMinutes: conn.healthCheckIntervalMinutes ?? null,
          providerSpecificData: conn.providerSpecificData
            ? (typeof conn.providerSpecificData === "string"
                ? JSON.parse(conn.providerSpecificData)
                : conn.providerSpecificData)
            : {},
          tags: conn.tags ?? null,
          extraApiKeys: conn.extraApiKeys ?? null,
        };
        if (conn.email) createBody.email = conn.email;
        if (conn.clientId) createBody.clientId = conn.clientId;
        if (conn.maxRetries != null) createBody.maxRetries = conn.maxRetries;

        // Build the URL for the providers API endpoint
        const url = new URL(request.url);
        const baseApiUrl = `${url.protocol}//${url.host}/api/providers`;
        const createRes = await fetch(baseApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createBody),
        });

        if (createRes.ok) {
          imported++;
          results.push({ name: String(conn.name || conn.email || "?"), status: "imported" });
        } else {
          const errData = await createRes.json().catch(() => ({ error: "Unknown error" }));
          errors++;
          results.push({
            name: String(conn.name || conn.email || "?"),
            status: "failed",
            error: errData.error || "Unknown error",
          });
        }
      } catch (e) {
        errors++;
        results.push({
          name: String(conn.name || conn.email || "?"),
          status: "failed",
          error: e instanceof Error ? e.message : "Request error",
        });
      }
    }

    return NextResponse.json({
      imported,
      failed: errors,
      total: deduped.length,
      results,
      provider: providerId,
    });
  } catch (error) {
    console.error("Provider import error:", error);
    return NextResponse.json({ error: "Failed to import provider" }, { status: 500 });
  }
}
