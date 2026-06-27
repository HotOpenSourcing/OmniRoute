import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// GET /api/providers/[id]/export-provider - Export provider info + all connections
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id: providerId } = await params;

    // Gather provider metadata from the catalog
    const providerMeta = AI_PROVIDERS.find((p: any) => p.id === providerId);
    const providerInfo = providerMeta
      ? {
          id: providerMeta.id,
          name: providerMeta.name,
          website: providerMeta.website || null,
          color: providerMeta.color || null,
          category: providerMeta.category || null,
          apiType: providerMeta.apiType || null,
        }
      : { id: providerId, name: providerId };

    // Get all connections (decrypted automatically by getProviderConnections)
    const connections = await getProviderConnections({ provider: providerId });

    const exportPayload = {
      provider: providerInfo,
      exportedAt: new Date().toISOString(),
      totalConnections: connections.length,
      connections: connections.map((c: any) => ({
        id: c.id,
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
        maxRetries: c.maxRetries ?? null,
        disableCooldown: c.disableCooldown ?? null,
        healthCheckIntervalMinutes: c.healthCheckIntervalMinutes ?? null,
        clientId: c.clientId ?? null,
        providerSpecificData: c.providerSpecificData ?? null,
        tags: c.tags ?? null,
        extraApiKeys: c.extraApiKeys ?? null,
      })),
    };

    return NextResponse.json(exportPayload);
  } catch (error) {
    console.error("Provider export error:", error);
    return NextResponse.json({ error: "Failed to export provider" }, { status: 500 });
  }
}
