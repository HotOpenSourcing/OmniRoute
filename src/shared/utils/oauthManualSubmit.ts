export function resolveManualOAuthRedirectUri({
  provider,
  authDataRedirectUri,
  fallbackRedirectUri,
}) {
  if (provider === "windsurf" && authDataRedirectUri) {
    return authDataRedirectUri;
  }

  return fallbackRedirectUri;
}

export function extractWindsurfPopupCallbackData({ popupUrl, expectedOrigin }) {
  if (!popupUrl) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(popupUrl);
  } catch {
    return null;
  }

  if (parsed.origin !== expectedOrigin || parsed.pathname !== "/dashboard") {
    return null;
  }

  const fragmentParams = parsed.hash
    .replace(/^#/, "")
    .split("&")
    .reduce((acc, pair) => {
      if (!pair) return acc;
      const [rawKey, rawValue = ""] = pair.split("=", 2);
      const key = decodeURIComponent(rawKey || "").trim();
      if (!key) return acc;
      acc[key] = decodeURIComponent(rawValue.replace(/\+/g, " ")).trim();
      return acc;
    }, {});

  if (!fragmentParams.access_token && !fragmentParams.id_token && !fragmentParams.code) {
    return null;
  }

  return {
    code: null,
    state: fragmentParams.state || null,
    fullUrl: popupUrl,
  };
}

export function resolveOAuthExchangeInput({ provider, code, fullUrl }) {
  if (provider === "windsurf") {
    return fullUrl || code;
  }

  return code;
}

export function buildManualOAuthExchangePayload({
  provider,
  input,
  redirectUri,
  codeVerifier,
  state,
}) {
  return {
    ...(provider === "windsurf" ? { callbackUrl: input } : { code: input }),
    redirectUri,
    ...(codeVerifier ? { codeVerifier } : {}),
    ...(state ? { state } : {}),
  };
}
