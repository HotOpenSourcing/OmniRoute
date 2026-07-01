import test from "node:test";
import assert from "node:assert/strict";

import {
  buildManualOAuthExchangePayload,
  extractWindsurfPopupCallbackData,
  resolveManualOAuthRedirectUri,
  resolveOAuthExchangeInput,
} from "../../src/shared/utils/oauthManualSubmit.ts";

test("Windsurf manual submit sends callbackUrl instead of treating the full URL as code", () => {
  const payload = buildManualOAuthExchangePayload({
    provider: "windsurf",
    input:
      "https://windsurf.com/editor/auth-success?client_id=devin-auth&redirect_uri=http%3A%2F%2Flocalhost%3A20128&prompt=login&workflow=&authType=signin&response_type=token&state=gefDp_54C8839skSXDpkby73Izmh9XXZFR-IwQG-d6w&redirect_parameters_type=fragment",
    redirectUri: "http://localhost:20128",
    codeVerifier: "TTGlVcTs4_NOFGJSFNKq-3M8B3lMC0p9-zKWMbR-mYY",
    state: "gefDp_54C8839skSXDpkby73Izmh9XXZFR-IwQG-d6w",
  });

  assert.deepEqual(payload, {
    callbackUrl:
      "https://windsurf.com/editor/auth-success?client_id=devin-auth&redirect_uri=http%3A%2F%2Flocalhost%3A20128&prompt=login&workflow=&authType=signin&response_type=token&state=gefDp_54C8839skSXDpkby73Izmh9XXZFR-IwQG-d6w&redirect_parameters_type=fragment",
    redirectUri: "http://localhost:20128",
    codeVerifier: "TTGlVcTs4_NOFGJSFNKq-3M8B3lMC0p9-zKWMbR-mYY",
    state: "gefDp_54C8839skSXDpkby73Izmh9XXZFR-IwQG-d6w",
  });
});

test("Windsurf manual flow keeps the authorize response redirect URI when provided", () => {
  const redirectUri = resolveManualOAuthRedirectUri({
    provider: "windsurf",
    authDataRedirectUri: "windsurf://codeium.windsurf",
    fallbackRedirectUri: "http://localhost:20128",
  });

  assert.equal(redirectUri, "windsurf://codeium.windsurf");
});

test("Windsurf popup callback data is extracted from the final dashboard redirect URL", () => {
  const data = extractWindsurfPopupCallbackData({
    popupUrl:
      "http://localhost:20128/dashboard#state=state-123&access_token=fragment-access-token-123",
    expectedOrigin: "http://localhost:20128",
  });

  assert.deepEqual(data, {
    code: null,
    state: "state-123",
    fullUrl:
      "http://localhost:20128/dashboard#state=state-123&access_token=fragment-access-token-123",
  });
});

test("Windsurf popup callback uses the full URL as exchange input", () => {
  const input = resolveOAuthExchangeInput({
    provider: "windsurf",
    code: null,
    fullUrl:
      "http://localhost:20128/dashboard#state=state-123&access_token=fragment-access-token-123",
  });

  assert.equal(
    input,
    "http://localhost:20128/dashboard#state=state-123&access_token=fragment-access-token-123"
  );
});
