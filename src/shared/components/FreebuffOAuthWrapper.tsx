"use client";

/**
 * Freebuff (Codebuff) OAuth Wrapper.
 *
 * Mirrors the KiroOAuthWrapper pattern: shows a method-selector first, then
 * dispatches to either the shared OAuthModal (browser PKCE polling) or an
 * inline paste-token form (import-token path).
 *
 * Two auth methods:
 *   1. `browser` — opens a verification URL against www.codebuff.com in a new
 *      tab, then polls /api/oauth/freebuff/poll until the user completes the
 *      browser-side OAuth. Uses the shared OAuthModal in device_code mode.
 *   2. `paste`   — user pastes credentials.json (or a bare auth token UUID)
 *      and we POST it to /api/oauth/freebuff/import-token.
 *
 * Both paths converge on the shared `onSuccess` callback, which the
 * ProviderDetailPageClient uses to refresh the connections list.
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import Modal from "./Modal";
import Button from "./Button";
import OAuthModal from "./OAuthModal";
import { parseResponseBody, getErrorMessage } from "@/shared/utils/api";

type FreebuffAuthMethod = null | "browser" | "paste";

interface FreebuffOAuthWrapperProps {
  isOpen: boolean;
  reauthConnection?: null | { id?: string };
  providerInfo?: { id?: string; name?: string } | null;
  onSuccess?: () => void;
  onClose: () => void;
}

export default function FreebuffOAuthWrapper({
  isOpen,
  reauthConnection,
  providerInfo,
  onSuccess,
  onClose,
}: FreebuffOAuthWrapperProps) {
  const t = useTranslations("freebuff");
  const [authMethod, setAuthMethod] = useState<FreebuffAuthMethod>(null);

  const handleMethodSelect = useCallback((method: Exclude<FreebuffAuthMethod, null>) => {
    setAuthMethod(method);
  }, []);

  const handleBack = useCallback(() => {
    setAuthMethod(null);
  }, []);

  const handleBrowserSuccess = useCallback(() => {
    setAuthMethod(null);
    onSuccess?.();
  }, [onSuccess]);

  const handlePasteSuccess = useCallback(() => {
    setAuthMethod(null);
    onSuccess?.();
  }, [onSuccess]);

  const oauthProviderId = providerInfo?.id || "freebuff";

  if (!isOpen) return null;

  // ── Method selector ────────────────────────────────────────────────────
  if (!authMethod) {
    return (
      <Modal isOpen={isOpen} title={`Connect Freebuff`} onClose={onClose} size="lg">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            Choose how to authenticate with Codebuff (www.codebuff.com):
          </p>

          {/* Browser OAuth (PKCE polling) */}
          <button
            type="button"
            onClick={() => handleMethodSelect("browser")}
            className="w-full p-4 text-left border border-border rounded-lg hover:bg-sidebar transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary mt-0.5">
                open_in_new
              </span>
              <div className="flex-1">
                <h3 className="font-semibold mb-1">
                  {t("methods.browser.title", "Sign in via browser")}
                </h3>
                <p className="text-sm text-text-muted">
                  {t(
                    "methods.browser.description",
                    "Open a Codebuff login page in your browser. OmniRoute polls for completion and saves the session automatically. The PKCE fingerprint is derived from this server's hardware — if it does not match your local CLI fingerprint, paste credentials.json instead.",
                  )}
                </p>
              </div>
            </div>
          </button>

          {/* Paste credentials.json */}
          <button
            type="button"
            onClick={() => handleMethodSelect("paste")}
            className="w-full p-4 text-left border border-border rounded-lg hover:bg-sidebar transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary mt-0.5">
                content_paste
              </span>
              <div className="flex-1">
                <h3 className="font-semibold mb-1">
                  {t("methods.paste.title", "Paste credentials.json")}
                </h3>
                <p className="text-sm text-text-muted">
                  {t(
                    "methods.paste.description",
                    "Paste the contents of credentials.json from ~/.config/manicode/credentials.json (or a bare authToken UUID). Recommended for remote OmniRoute deployments where the server-side hardware fingerprint rarely matches your local CLI fingerprint.",
                  )}
                </p>
              </div>
            </div>
          </button>
        </div>
      </Modal>
    );
  }

  // ── Browser OAuth (PKCE polling via shared OAuthModal) ─────────────────
  if (authMethod === "browser") {
    return (
      <OAuthModal
        isOpen={isOpen}
        provider={oauthProviderId}
        providerInfo={providerInfo}
        onSuccess={handleBrowserSuccess}
        reauthConnection={reauthConnection}
        onClose={handleBack}
        defaultTab="browser"
      />
    );
  }

  // ── Paste credentials.json (inline form, posts to /import-token) ──────
  if (authMethod === "paste") {
    return (
      <FreebuffPasteForm
        providerId={oauthProviderId}
        reauthConnection={reauthConnection}
        onSuccess={handlePasteSuccess}
        onBack={handleBack}
        onClose={onClose}
      />
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline paste form for the import-token path.
//
// Kept in the same file as the wrapper because the form is tightly coupled to
// the wrapper's authMethod state machine and shares the i18n namespace.
// ─────────────────────────────────────────────────────────────────────────────

interface FreebuffPasteFormProps {
  providerId: string;
  reauthConnection?: null | { id?: string };
  onSuccess: () => void;
  onBack: () => void;
  onClose: () => void;
}

function FreebuffPasteForm({
  providerId,
  reauthConnection,
  onSuccess,
  onBack,
  onClose,
}: FreebuffPasteFormProps) {
  const t = useTranslations("freebuff");
  const [pasteToken, setPasteToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    const trimmed = pasteToken.trim();
    if (!trimmed) {
      setError("Please paste credentials.json or an auth token.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/oauth/${providerId}/import-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: trimmed,
          connectionId: reauthConnection?.id,
        }),
      });
      const data = (await parseResponseBody(res)) as Record<string, unknown>;
      if (!res.ok) {
        const errMsg = getErrorMessage(data, res.status, "Import failed");
        throw new Error(errMsg);
      }
      setPasteToken("");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSaving(false);
    }
  }, [pasteToken, providerId, reauthConnection?.id, onSuccess]);

  return (
    <Modal isOpen onClose={onClose} title="Freebuff — Paste credentials" size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          {t(
            "paste.help",
            "Paste the contents of credentials.json from ~/.config/manicode/credentials.json (a JSON object with authToken, userId, email fields), or paste just the bare authToken UUID if you only have the token.",
          )}
        </p>
        <textarea
          value={pasteToken}
          onChange={(e) => setPasteToken(e.target.value)}
          placeholder={'{"authToken":"...","userId":"...","email":"..."}'}
          rows={6}
          spellCheck={false}
          className="w-full rounded border border-border bg-bg p-2 font-mono text-sm text-text-main focus:border-primary focus:outline-none"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              disabled={saving || !pasteToken.trim()}
            >
              {saving ? "Saving…" : "Save Connection"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
