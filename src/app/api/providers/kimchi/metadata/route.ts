/**
 * Kimchi model metadata API.
 *
 * GET  /api/providers/kimchi/metadata  → read persisted per-model health metadata
 * POST /api/providers/kimchi/metadata  → trigger an on-demand health-ping refresh
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import pino from "pino";

import { buildErrorBody } from "@omniroute/open-sse/utils/error.ts";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getAllKimchiModelMetadata } from "@/lib/db/kimchiMetadata";
import { refreshKimchiMetadata } from "@omniroute/open-sse/services/kimchiMetadataPoller.ts";
import { getProviderConnectionById } from "@/lib/db/providers";

const logger = pino({ name: "kimchi-metadata-api" });

const refreshBodySchema = z.object({
  connectionId: z.string().trim().min(1).optional(),
  modelIds: z.array(z.string().trim().min(1)).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
});

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const metadata = getAllKimchiModelMetadata();
    return NextResponse.json({
      provider: "kimchi",
      count: metadata.length,
      metadata,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to read Kimchi metadata");
    return NextResponse.json(buildErrorBody(500, "Failed to read Kimchi metadata"), {
      status: 500,
    });
  }
}

export async function POST(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsedBody = refreshBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(buildErrorBody(400, "Invalid refresh request body"), {
      status: 400,
    });
  }

  try {
    const connectionId = parsedBody.data.connectionId;
    if (!connectionId) {
      return NextResponse.json(
        buildErrorBody(400, "connectionId is required to refresh Kimchi metadata"),
        { status: 400 }
      );
    }

    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return NextResponse.json(buildErrorBody(404, "Provider connection not found"), {
        status: 404,
      });
    }
    if (connection.provider !== "kimchi") {
      return NextResponse.json(
        buildErrorBody(400, "Connection is not a Kimchi connection"),
        { status: 400 }
      );
    }

    const apiKey = connection.apiKey || connection.decryptedApiKey;
    if (!apiKey) {
      return NextResponse.json(
        buildErrorBody(400, "Kimchi connection has no API key"),
        { status: 400 }
      );
    }

    const results = await refreshKimchiMetadata({
      apiKey,
      modelIds: parsedBody.data.modelIds,
      timeoutMs: parsedBody.data.timeoutMs,
    });

    return NextResponse.json({
      provider: "kimchi",
      connectionId,
      refreshed: results.length,
      results,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to refresh Kimchi metadata");
    const message = error instanceof Error ? error.message : "Refresh failed";
    return NextResponse.json(buildErrorBody(500, message), { status: 500 });
  }
}
