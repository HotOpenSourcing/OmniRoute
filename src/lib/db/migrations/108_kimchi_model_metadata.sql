-- Migration 108: per-model Kimchi health/availability metadata.
--
-- Tracks the result of lightweight health pings against each Kimchi upstream
-- model so the combo router can avoid routing to models that are currently
-- failing, while staying fail-open when data is stale or missing.
--
-- provider_id is scoped to 'kimchi' for now, but kept generic in case other
-- providers adopt the same health-ping pattern later.

CREATE TABLE IF NOT EXISTS provider_model_metadata (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  latency_ms INTEGER,
  last_error TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_model_metadata_checked_at
  ON provider_model_metadata (provider_id, last_checked_at);

CREATE INDEX IF NOT EXISTS idx_provider_model_metadata_available
  ON provider_model_metadata (provider_id, is_available, last_checked_at);
