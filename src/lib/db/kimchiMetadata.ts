/**
 * Database module: Kimchi model metadata.
 *
 * Persists the result of lightweight health pings against each Kimchi upstream
 * model. The combo engine reads this table to skip models that are currently
 * failing, but it is fail-open: stale or missing rows are treated as routable.
 */

import { getDbInstance } from "./core.ts";

export interface KimchiModelMetadata {
  providerId: string;
  modelId: string;
  isAvailable: boolean;
  lastCheckedAt: string;
  latencyMs: number | null;
  lastError: string | null;
  metadataJson: string | null;
  createdAt: string;
  updatedAt: string;
}

interface KimchiModelMetadataDbRow {
  provider_id: string;
  model_id: string;
  is_available: number;
  last_checked_at: string;
  latency_ms: number | null;
  last_error: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: KimchiModelMetadataDbRow): KimchiModelMetadata {
  return {
    providerId: row.provider_id,
    modelId: row.model_id,
    isAvailable: row.is_available === 1,
    lastCheckedAt: row.last_checked_at,
    latencyMs: row.latency_ms ?? null,
    lastError: row.last_error ?? null,
    metadataJson: row.metadata_json ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PROVIDER_ID = "kimchi";

export function getKimchiModelMetadata(modelId: string): KimchiModelMetadata | null {
  const db = getDbInstance();
  const row = db
    .prepare(
      "SELECT * FROM provider_model_metadata WHERE provider_id = ? AND model_id = ?"
    )
    .get(PROVIDER_ID, modelId) as KimchiModelMetadataDbRow | undefined;
  return row ? mapRow(row) : null;
}

export function getAllKimchiModelMetadata(): KimchiModelMetadata[] {
  const db = getDbInstance();
  const rows = db
    .prepare(
      "SELECT * FROM provider_model_metadata WHERE provider_id = ? ORDER BY model_id ASC"
    )
    .all(PROVIDER_ID) as KimchiModelMetadataDbRow[];
  return rows.map(mapRow);
}

export function upsertKimchiModelMetadata(
  modelId: string,
  update: Omit<Partial<KimchiModelMetadata>, "providerId" | "modelId" | "createdAt" | "updatedAt">
): void {
  const db = getDbInstance();
  const existing = getKimchiModelMetadata(modelId);
  const now = new Date().toISOString();

  if (!existing) {
    db.prepare(
      `INSERT INTO provider_model_metadata
         (provider_id, model_id, is_available, last_checked_at, latency_ms, last_error, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      PROVIDER_ID,
      modelId,
      update.isAvailable !== undefined ? (update.isAvailable ? 1 : 0) : 1,
      update.lastCheckedAt ?? now,
      update.latencyMs ?? null,
      update.lastError ?? null,
      update.metadataJson ?? null,
      now,
      now
    );
  } else {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (update.isAvailable !== undefined) {
      fields.push("is_available = ?");
      values.push(update.isAvailable ? 1 : 0);
    }
    if (update.lastCheckedAt !== undefined) {
      fields.push("last_checked_at = ?");
      values.push(update.lastCheckedAt);
    }
    if (update.latencyMs !== undefined) {
      fields.push("latency_ms = ?");
      values.push(update.latencyMs ?? null);
    }
    if (update.lastError !== undefined) {
      fields.push("last_error = ?");
      values.push(update.lastError ?? null);
    }
    if (update.metadataJson !== undefined) {
      fields.push("metadata_json = ?");
      values.push(update.metadataJson ?? null);
    }

    if (fields.length === 0) return;

    fields.push("updated_at = ?");
    values.push(now);
    values.push(PROVIDER_ID);
    values.push(modelId);

    db.prepare(
      `UPDATE provider_model_metadata SET ${fields.join(", ")} WHERE provider_id = ? AND model_id = ?`
    ).run(...values);
  }
}

export function deleteKimchiModelMetadata(modelId: string): void {
  const db = getDbInstance();
  db.prepare(
    "DELETE FROM provider_model_metadata WHERE provider_id = ? AND model_id = ?"
  ).run(PROVIDER_ID, modelId);
}

export function clearKimchiModelMetadata(): void {
  const db = getDbInstance();
  db.prepare("DELETE FROM provider_model_metadata WHERE provider_id = ?").run(PROVIDER_ID);
}

export function isKimchiModelRoutable(modelId: string, staleThresholdMs = 5 * 60 * 1000): boolean {
  const row = getKimchiModelMetadata(modelId);
  if (!row) return true; // fail-open: no data means routable
  const ageMs = Date.now() - new Date(row.lastCheckedAt).getTime();
  if (ageMs > staleThresholdMs) return true; // fail-open on stale data
  return row.isAvailable;
}
