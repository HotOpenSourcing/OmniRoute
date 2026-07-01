/**
 * Kimchi model metadata poller.
 *
 * Performs lightweight health pings against each Kimchi upstream model and
 * persists the results in provider_model_metadata. The combo engine uses this
 * data to skip currently-failing models, but it is intentionally fail-open:
 * stale or missing rows are treated as routable.
 *
 * Source: .kimchi/docs/KIMCHI_MODEL_MAP.md — metadata `is_routable` from
 * /v1/models/metadata is unreliable, so we use a real single-token completion
 * ping instead.
 */

import { getRegistryEntry } from "../config/providerRegistry.ts";
import {
  getAllKimchiModelMetadata,
  upsertKimchiModelMetadata,
  isKimchiModelRoutable,
} from "../../src/lib/db/kimchiMetadata.ts";

export { isKimchiModelRoutable };

const KIMCHI_PROVIDER_ID = "kimchi";
const DEFAULT_HEALTH_TIMEOUT_MS = 25000;
const DEFAULT_POLL_INTERVAL_MS = 60 * 1000; // 60s

export interface KimchiHealthPingResult {
  modelId: string;
  isAvailable: boolean;
  latencyMs: number;
  lastError: string | null;
  checkedAt: string;
}

export interface KimchiMetadataPollerOptions {
  apiKey: string;
  timeoutMs?: number;
  baseUrl?: string;
  onResult?: (result: KimchiHealthPingResult) => void;
}

export function getKimchiBaseUrl(): string | null {
  const entry = getRegistryEntry(KIMCHI_PROVIDER_ID);
  return entry?.baseUrl ?? null;
}

export function getKimchiModelIds(): string[] {
  const entry = getRegistryEntry(KIMCHI_PROVIDER_ID);
  return entry?.models?.map((m) => m.id) ?? [];
}

export function buildKimchiHealthHeaders(
  apiKey: string,
  extraHeaders?: Record<string, string>
): Record<string, string> {
  const entry = getRegistryEntry(KIMCHI_PROVIDER_ID);
  const registryHeaders = entry?.headers ?? {};
  return {
    ...registryHeaders,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(extraHeaders ?? {}),
  };
}

function buildHealthRequestBody(modelId: string): Record<string, unknown> {
  return {
    model: modelId,
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 1,
    stream: false,
  };
}

async function pingKimchiModel(opts: {
  modelId: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}): Promise<KimchiHealthPingResult> {
  const { modelId, apiKey, baseUrl, timeoutMs } = opts;
  const startedAt = Date.now();
  const checkedAt = new Date(startedAt).toISOString();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: buildKimchiHealthHeaders(apiKey),
      body: JSON.stringify(buildHealthRequestBody(modelId)),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        modelId,
        isAvailable: false,
        latencyMs,
        lastError: `HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`,
        checkedAt,
      };
    }

    // Even HTTP 200 can be a silent failure (content:null, usage.total_tokens:0).
    // We treat any parseable 200 as available; the SSE parser warning will catch
    // silent empties at request time.
    return {
      modelId,
      isAvailable: true,
      latencyMs,
      lastError: null,
      checkedAt,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    return {
      modelId,
      isAvailable: false,
      latencyMs,
      lastError: message,
      checkedAt,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Refresh health metadata for all Kimchi models (or a specific subset).
 * Persists results to provider_model_metadata.
 */
export async function refreshKimchiMetadata(
  opts: KimchiMetadataPollerOptions & { modelIds?: string[] }
): Promise<KimchiHealthPingResult[]> {
  const { apiKey, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS, baseUrl, modelIds, onResult } = opts;
  const resolvedBaseUrl = baseUrl ?? getKimchiBaseUrl();
  if (!resolvedBaseUrl) {
    throw new Error("Kimchi provider not registered; cannot refresh metadata");
  }

  const models = modelIds ?? getKimchiModelIds();
  if (models.length === 0) {
    return [];
  }

  const results: KimchiHealthPingResult[] = [];

  for (const modelId of models) {
    const result = await pingKimchiModel({
      modelId,
      apiKey,
      baseUrl: resolvedBaseUrl,
      timeoutMs,
    });

    upsertKimchiModelMetadata(modelId, {
      isAvailable: result.isAvailable,
      lastCheckedAt: result.checkedAt,
      latencyMs: result.latencyMs,
      lastError: result.lastError,
    });

    onResult?.(result);
    results.push(result);
  }

  return results;
}

/**
 * Read the latest persisted metadata for all Kimchi models.
 */
export function getKimchiMetadataSnapshot(): ReturnType<typeof getAllKimchiModelMetadata> {
  return getAllKimchiModelMetadata();
}

// Simple in-memory scheduler for server-side polling. Not persisted across restarts.
let pollTimer: NodeJS.Timeout | null = null;
let isPolling = false;

export function startKimchiMetadataPoller(opts: {
  apiKey: string;
  intervalMs?: number;
  timeoutMs?: number;
  onResult?: (result: KimchiHealthPingResult) => void;
  onError?: (err: unknown) => void;
}): void {
  if (pollTimer) return; // already running

  const intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  async function tick() {
    if (isPolling) return;
    isPolling = true;
    try {
      await refreshKimchiMetadata({
        apiKey: opts.apiKey,
        timeoutMs: opts.timeoutMs,
        onResult: opts.onResult,
      });
    } catch (err) {
      opts.onError?.(err);
    } finally {
      isPolling = false;
    }
  }

  void tick();
  pollTimer = setInterval(tick, intervalMs);
}

export function stopKimchiMetadataPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
