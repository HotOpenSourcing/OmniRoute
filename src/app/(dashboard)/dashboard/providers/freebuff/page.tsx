/**
 * Freebuff provider detail page.
 *
 * Server component — checks the FREEBUFF_ENABLED environment variable and
 * either renders the client UI or shows a "not enabled" notice. The
 * client component handles the PKCE login flow, the credentials.json
 * paste fallback, and the live quota/streak polling.
 *
 * Opt-in contract
 * ---------------
 * The Freebuff provider is OFF by default. Setting `FREEBUFF_ENABLED=1`
 * in the OmniRoute environment is the only way this page renders the
 * full UI. The route file under `app/api/v1/providers/freebuff/*` is
 * gated on the same variable in `metaService` (Chunk 4 will harden
 * this further with per-user authentication).
 */

import FreebuffProviderPageClient from "./FreebuffProviderPageClient";

export const dynamic = "force-dynamic";

export default function FreebuffProviderPage() {
  if (process.env.FREEBUFF_ENABLED !== "1") {
    return <FreebuffNotEnabledNotice />;
  }
  return <FreebuffProviderPageClient />;
}

function FreebuffNotEnabledNotice() {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
        <h1 className="text-xl font-semibold text-amber-900">
          Freebuff provider is not enabled
        </h1>
        <p className="mt-2 text-sm text-amber-800">
          Set the <code className="rounded bg-amber-100 px-1 py-0.5">FREEBUFF_ENABLED=1</code>{" "}
          environment variable and restart OmniRoute to access this page.
        </p>
        <p className="mt-3 text-xs text-amber-700">
          Freebuff is an opt-in provider that wraps the Codebuff Free Tier
          CLI. See <code>docs/providers/freebuff.md</code> for setup
          instructions (Chunk 9).
        </p>
      </div>
    </div>
  );
}
