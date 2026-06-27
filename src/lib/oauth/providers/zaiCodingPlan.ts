import { ZAI_CODING_PLAN_CONFIG } from "../constants/oauth";

/**
 * Z.AI Coding Plan OAuth Provider (Déprécié — Import Manuel Requis)
 *
 * ⚠️ Le flow OAuth externe n'est pas fonctionnel.
 * Les endpoints /oauth/cli/init et /oauth/cli/poll ne sont pas accessibles
 * depuis l'extérieur du desktop ZCode (redirection Next.js 404).
 *
 * Solution actuelle : Import manuel du JWT depuis config.json de ZCode.
 * Voir le provider registry zai-coding-plan/index.ts pour la procédure.
 *
 * Ce fichier est conservé pour référence mais le provider utilise
 * désormais authType "bearer" sans OAuth.
 *
 * Ancien flow (non fonctionnel) :
 *   1. GET authorizeUrl → code-<hex>
 *   2. (BLOQUÉ) POST /oauth/cli/init → flow_id
 *   3. (BLOQUÉ) GET /oauth/cli/poll/{flow_id} → access_token
 *   4. POST /api/auth/z/login → bizToken
 *
 * Client ID (public) : client_P8X5CMWmlaRO9gyO-KSqtg
 */
export const zaiCodingPlan = {
  config: ZAI_CODING_PLAN_CONFIG,
  flowType: "manual_token",

  /**
   * Build authorization URL (non fonctionnel).
   */
  buildAuthUrl: (config: typeof ZAI_CODING_PLAN_CONFIG, redirectUri: string, state: string) => {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      state: state,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },

  /**
   * Échange du code OAuth (non fonctionnel).
   * La token doit être importée manuellement depuis le desktop ZCode.
   */
  exchangeToken: (_config: typeof ZAI_CODING_PLAN_CONFIG, code: string, _redirectUri: string) => {
    if (!code || code.length === 0) {
      throw new Error("Token is required. Paste your JWT from ZCode config.json.");
    }
    return {
      access_token: code,
      token_type: "Bearer",
      scope: "coding",
    };
  },
};
