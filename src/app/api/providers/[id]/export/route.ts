import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

// GET /api/providers/[id]/export?ids=id1,id2 - Export connections with full credentials
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id: providerId } = await params;
    const { searchParams } = new URL(request.url);

    const connections = await getProviderConnections({ provider: providerId });

    // If specific IDs are requested, filter to only those
    const idsParam = searchParams.get("ids");
    let filtered = connections;
    if (idsParam) {
      const ids = new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean));
      if (ids.size > 0) {
        filtered = connections.filter((c: any) => ids.has(c.id));
      }
    }

    // Map connections to export-friendly format with full credentials
    const exportData = filtered.map((c: any) => ({
      id: c.id,
      provider: providerId,
      name: c.name || "",
      email: c.email || "",
      apiKey: c.apiKey || null,
      accessToken: c.accessToken || null,
      refreshToken: c.refreshToken || null,
      idToken: c.idToken || null,
      authType: c.authType || "apikey",
      isActive: c.isActive !== false,
      priority: c.priority || 1,
      globalPriority: c.globalPriority ?? null,
      defaultModel: c.defaultModel ?? null,
      testStatus: c.testStatus || "unknown",
      rateLimitedUntil: c.rateLimitedUntil || null,
      rateLimitProtection: c.rateLimitProtection ?? null,
      maxConcurrent: c.maxConcurrent ?? null,
      proxyEnabled: c.proxyEnabled ?? null,
      perKeyProxyEnabled: c.perKeyProxyEnabled ?? null,
      expiresAt: c.expiresAt || null,
      tokenExpiresAt: c.tokenExpiresAt || null,
      lastError: c.lastError || null,
      lastErrorType: c.lastErrorType || null,
      errorCode: c.errorCode ?? null,
      providerSpecificData: c.providerSpecificData || null,
      tags: c.tags || null,
    }));

    return NextResponse.json({
      provider: providerId,
      count: exportData.length,
      connections: exportData,
    });
  } catch (error) {
    console.error("Error exporting connections:", error);
    return NextResponse.json({ error: "Failed to export connections" }, { status: 500 });
  }
}
