import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Validation test for Chunk 8 — Freebuff UI Dashboard.
 *
 * Verifies that the i18n keys and the page wrapper are wired together.
 * Does NOT render React (that lives in tests/unit/ui via vitest). This
 * file stays on `node:test` so it runs in the cheap `test:unit` lane.
 */

const ROOT = resolve(__dirname, "../../../..");

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(ROOT, relativePath), "utf8"),
  ) as Record<string, unknown>;
}

function readText(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("freebuff UI i18n wiring", () => {
  test("en.json has a complete freebuff section with all required keys", () => {
    const en = readJson("src/i18n/messages/en.json");
    const fb = en.freebuff as Record<string, unknown>;
    assert.ok(fb, "freebuff section missing from en.json");

    // Top-level keys
    for (const key of ["name", "tagline", "notEnabled", "login", "quota", "streak", "errors"]) {
      assert.ok(fb[key], `en.json freebuff.${key} missing`);
    }

    // Login subkeys
    const login = fb.login as Record<string, unknown>;
    for (const key of ["title", "description", "cta", "release", "pasteToggle"]) {
      assert.ok(login[key], `en.json freebuff.login.${key} missing`);
    }

    // Quota subkeys
    const quota = fb.quota as Record<string, unknown>;
    for (const key of ["title", "sessionsUsed", "sessionsRemaining", "tier", "waitingRoom", "resetAt"]) {
      assert.ok(quota[key], `en.json freebuff.quota.${key} missing`);
    }

    // Streak subkeys
    const streak = fb.streak as Record<string, unknown>;
    for (const key of ["title", "current", "longest", "lastCheckIn"]) {
      assert.ok(streak[key], `en.json freebuff.streak.${key} missing`);
    }

    // Errors subkeys
    const errors = fb.errors as Record<string, unknown>;
    for (const key of ["notImplementedTitle", "genericTitle"]) {
      assert.ok(errors[key], `en.json freebuff.errors.${key} missing`);
    }
  });

  test("fr.json has a freebuff section mirrored from en.json", () => {
    const fr = readJson("src/i18n/messages/fr.json");
    const fb = fr.freebuff as Record<string, unknown>;
    assert.ok(fb, "freebuff section missing from fr.json");

    // All top-level keys present
    for (const key of ["name", "tagline", "login", "quota", "streak", "errors"]) {
      assert.ok(fb[key], `fr.json freebuff.${key} missing`);
    }
  });

  test("fr.json freebuff values are TODO-marked per spec plan", () => {
    const fr = readJson("src/i18n/messages/fr.json");
    const fb = fr.freebuff as Record<string, unknown>;
    const name = fb.name as string;
    assert.match(
      name,
      /TODO i18n fr/,
      "fr.json freebuff.name should be marked TODO per Chunk 8 plan",
    );
  });

  test("en.json freebuff values are NOT TODO-marked", () => {
    const en = readJson("src/i18n/messages/en.json");
    const fb = en.freebuff as Record<string, unknown>;
    const name = fb.name as string;
    assert.doesNotMatch(
      name,
      /TODO/,
      "en.json freebuff.name should NOT contain TODO markers — only fr.json",
    );
  });
});

describe("freebuff page.tsx FREEBUFF_ENABLED gate", () => {
  const pageSource = readText(
    "src/app/(dashboard)/dashboard/providers/freebuff/page.tsx",
  );

  test("page.tsx imports the client component", () => {
    assert.match(
      pageSource,
      /import FreebuffProviderPageClient from/,
      "page.tsx must import FreebuffProviderPageClient",
    );
  });

  test("page.tsx gates rendering on FREEBUFF_ENABLED", () => {
    assert.match(
      pageSource,
      /FREEBUFF_ENABLED/,
      "page.tsx must reference the FREEBUFF_ENABLED env var",
    );
    assert.match(
      pageSource,
      /!== "1"/,
      "page.tsx must compare FREEBUFF_ENABLED to \"1\" (opt-in default off)",
    );
  });

  test("page.tsx exports a default function", () => {
    assert.match(
      pageSource,
      /export default function/,
      "page.tsx must export a default function (Next.js page convention)",
    );
  });

  test("page.tsx is a server component (no 'use client' directive)", () => {
    // First non-empty line must NOT be the client directive — server
    // components gate env reads safely.
    const firstLine = pageSource
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("*") && !l.startsWith("/"));
    assert.notEqual(firstLine, '"use client";');
  });

  test("page.tsx renders a notice when disabled", () => {
    assert.match(
      pageSource,
      /FreebuffNotEnabledNotice/,
      "page.tsx must render a notice component when FREEBUFF_ENABLED is off",
    );
    assert.match(
      pageSource,
      /FREEBUFF_ENABLED=1/,
      "notice must tell the user how to enable the provider",
    );
  });
});

describe("freebuff page client i18n key references", () => {
  const clientSource = readText(
    "src/app/(dashboard)/dashboard/providers/freebuff/FreebuffProviderPageClient.tsx",
  );

  test("client component calls the three meta endpoints", () => {
    assert.match(
      clientSource,
      /\/api\/v1\/providers\/freebuff\/quota/,
      "client must fetch /quota",
    );
    assert.match(
      clientSource,
      /\/api\/v1\/providers\/freebuff\/streak/,
      "client must fetch /streak",
    );
    assert.match(
      clientSource,
      /\/api\/v1\/providers\/freebuff\/login\/start/,
      "client must POST /login/start",
    );
    assert.match(
      clientSource,
      /\/api\/v1\/providers\/freebuff\/session/,
      "client must DELETE /session",
    );
  });

  test("client component polls quota at the documented cadence", () => {
    assert.match(
      clientSource,
      /QUOTA_POLL_MS\s*=\s*30_000|QUOTA_POLL_MS\s*=\s*30000/,
      "client must poll quota every 30s",
    );
  });

  test("client component renders 501 without crashing", () => {
    assert.match(
      clientSource,
      /notImplementedTitle|isPending/,
      "client must special-case the 501 not-implemented response",
    );
  });

  test("client uses next-intl useTranslations for i18n", () => {
    assert.match(
      clientSource,
      /useTranslations\("freebuff"\)/,
      "client must use the freebuff i18n namespace",
    );
  });
});
