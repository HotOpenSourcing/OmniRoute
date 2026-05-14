import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import {
  createProviderConnection,
  getProviderConnections,
  isCloudEnabled,
  resolveProxyForProvider,
  updateProviderConnection,
} from "@/models";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/cloudSync";
import { kiroImportSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { isAuthRequired, isAuthenticated } from "@/shared/utils/apiAuth";
import { runWithProxyContext } from "@omniroute/open-sse/utils/proxyFetch.ts";

async function requireOAuthImportAuth(request: Request) {
  if (!(await isAuthRequired(request))) return null;
  if (await isAuthenticated(request)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function matchesConnectionIdentity(
  connection: any,
  email: string | null,
  profileArn: string | null
) {
  if (connection?.authType !== "oauth") return false;
  if (email && connection?.email === email) return true;
  return Boolean(profileArn && connection?.providerSpecificData?.profileArn === profileArn);
}

function resolveImportedConnectionMetadata(input: {
  name?: string;
  accountName?: string;
  tagGroupLabel?: string;
}) {
  const normalizedName = input.name?.trim() || input.accountName?.trim() || undefined;
  const normalizedAccountName = input.accountName?.trim() || normalizedName || undefined;
  const normalizedGroup = input.tagGroupLabel?.trim() || undefined;

  return {
    name: normalizedName,
    displayName: normalizedAccountName,
    group: normalizedGroup,
    providerSpecificData: {
      ...(normalizedAccountName ? { accountName: normalizedAccountName } : {}),
      ...(normalizedGroup ? { tagGroupLabel: normalizedGroup } : {}),
    },
  };
}

/**
 * POST /api/oauth/kiro/import
 * Import and validate refresh token from Kiro IDE
 */
export async function POST(request: Request) {
  const authResponse = await requireOAuthImportAuth(request);
  if (authResponse) return authResponse;

  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          message: "Invalid request",
          details: [{ field: "body", message: "Invalid JSON body" }],
        },
      },
      { status: 400 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const targetProvider = searchParams.get("targetProvider") === "amazon-q" ? "amazon-q" : "kiro";
    const validation = validateBody(kiroImportSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { refreshToken, name, accountName, tagGroupLabel } = validation.data;

    const kiroService = new KiroService();

    // Resolve proxy for this provider (provider-level → global → direct)
    const proxy = await resolveProxyForProvider(targetProvider);

    // Validate and refresh token (through proxy if configured)
    const tokenData = await runWithProxyContext(proxy, () =>
      kiroService.validateImportToken(refreshToken.trim())
    );

    // Extract email from JWT if available
    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);

    const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000).toISOString();
    const profileArn = tokenData.profileArn || null;
    const importedMetadata = resolveImportedConnectionMetadata({
      name,
      accountName,
      tagGroupLabel,
    });
    const existingConnections = await getProviderConnections({ provider: targetProvider });
    const matchingConnections = existingConnections.filter((connection: any) =>
      matchesConnectionIdentity(connection, email || null, profileArn)
    );

    if (matchingConnections.length > 1) {
      return NextResponse.json(
        { error: "Multiple existing Kiro connections match this import" },
        { status: 409 }
      );
    }

    const connectionPayload = {
      provider: targetProvider,
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt,
      email: email || null,
      ...(importedMetadata.name ? { name: importedMetadata.name } : {}),
      ...(importedMetadata.displayName ? { displayName: importedMetadata.displayName } : {}),
      ...(importedMetadata.group ? { group: importedMetadata.group } : {}),
      providerSpecificData: {
        profileArn,
        authMethod: "imported",
        provider: "Imported",
        ...importedMetadata.providerSpecificData,
      },
      testStatus: "active",
      isActive: true,
    };

    const existingConnection = matchingConnections[0];
    const alreadyImported = Boolean(existingConnection);
    const connection: any = existingConnection
      ? await updateProviderConnection(existingConnection.id, connectionPayload)
      : await createProviderConnection(connectionPayload);

    // Auto sync to Cloud if enabled
    await syncToCloudIfEnabled();

    return NextResponse.json({
      success: true,
      alreadyImported,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        name: connection.name,
        displayName: connection.displayName,
        group: connection.group,
      },
    });
  } catch (error: any) {
    console.log("Kiro-compatible import token error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Sync to Cloud if enabled
 */
async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing to cloud after Kiro import:", error);
  }
}
