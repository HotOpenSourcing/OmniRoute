import { createHash } from "node:crypto";

const DEFAULT_JWT_TTL_MS = 55 * 60 * 1000;

export class WindsurfAuthError extends Error {
  status: number;
  type: string;
  code: string;

  constructor(
    message: string,
    status = 401,
    type = "authentication_error",
    code = "token_required"
  ) {
    super(message);
    this.name = "WindsurfAuthError";
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

type WindsurfJwtCacheEntry = {
  jwt: string;
  expiresAt: number;
};

type ExchangeJwtInput = {
  ident: string;
  signal?: AbortSignal | null;
};

type GetWindsurfJwtInput = {
  ident: string;
  connectionId?: string | null;
  signal?: AbortSignal | null;
  ttlMs?: number;
  exchangeJwt: (input: ExchangeJwtInput) => Promise<string>;
};

const jwtCache = new Map<string, WindsurfJwtCacheEntry>();

export function normalizeWindsurfIdent(ident: string | null | undefined): string {
  return typeof ident === "string" ? ident.trim() : "";
}

export function getWindsurfAuthCacheKey(ident: string, connectionId?: string | null): string {
  const normalizedConnectionId = typeof connectionId === "string" ? connectionId.trim() : "";
  if (normalizedConnectionId) {
    return `windsurf:connection:${normalizedConnectionId}`;
  }

  return `windsurf:ident:${createHash("sha256").update(ident).digest("hex")}`;
}

export function invalidateWindsurfJwtCache(
  connectionId?: string | null,
  ident?: string | null
): void {
  const normalizedIdent = normalizeWindsurfIdent(ident);
  const normalizedConnectionId = typeof connectionId === "string" ? connectionId.trim() : "";

  if (normalizedConnectionId && normalizedIdent) {
    jwtCache.delete(getWindsurfAuthCacheKey(normalizedIdent, normalizedConnectionId));
    return;
  }

  if (normalizedConnectionId) {
    for (const key of jwtCache.keys()) {
      if (key === `windsurf:connection:${normalizedConnectionId}`) {
        jwtCache.delete(key);
      }
    }
  }

  if (normalizedIdent) {
    jwtCache.delete(getWindsurfAuthCacheKey(normalizedIdent));
  }
}

export function resetWindsurfJwtCache(): void {
  jwtCache.clear();
}

export function getCachedWindsurfJwt(
  ident: string,
  connectionId?: string | null,
  now = Date.now()
): string | null {
  const key = getWindsurfAuthCacheKey(ident, connectionId);
  const cached = jwtCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= now) {
    jwtCache.delete(key);
    return null;
  }

  return cached.jwt;
}

export async function getWindsurfJwt({
  ident,
  connectionId,
  signal,
  ttlMs = DEFAULT_JWT_TTL_MS,
  exchangeJwt,
}: GetWindsurfJwtInput): Promise<string> {
  const normalizedIdent = normalizeWindsurfIdent(ident);
  if (!normalizedIdent) {
    throw new WindsurfAuthError("Windsurf token is required.");
  }

  const cached = getCachedWindsurfJwt(normalizedIdent, connectionId);
  if (cached) {
    return cached;
  }

  const jwt = (await exchangeJwt({ ident: normalizedIdent, signal }))?.trim();
  if (!jwt) {
    throw new WindsurfAuthError(
      "Windsurf JWT exchange returned an empty token.",
      502,
      "provider_error",
      "jwt_exchange_failed"
    );
  }

  jwtCache.set(getWindsurfAuthCacheKey(normalizedIdent, connectionId), {
    jwt,
    expiresAt: Date.now() + Math.max(1, ttlMs),
  });

  return jwt;
}
