import { BaseExecutor, mergeUpstreamExtraHeaders, type ExecuteInput } from "./base.ts";
import { PROVIDERS } from "../config/constants.ts";
import { trimWindsurfModelPrefix } from "../config/windsurfModels.ts";

function getWindsurfToken(credentials: ExecuteInput["credentials"]): string {
  const apiKey = typeof credentials.apiKey === "string" ? credentials.apiKey.trim() : "";
  if (apiKey) return apiKey;

  const accessToken =
    typeof credentials.accessToken === "string" ? credentials.accessToken.trim() : "";
  if (accessToken) return accessToken;

  return "";
}

export class WindsurfExecutor extends BaseExecutor {
  constructor() {
    super("windsurf", PROVIDERS.windsurf);
  }

  buildUrl() {
    return `${this.config.baseUrl}/exa.api_server_pb.ApiServerService/GetChatMessage`;
  }

  buildHeaders(credentials: ExecuteInput["credentials"]): Record<string, string> {
    void credentials;
    return {
      "user-agent": "connect-go/1.17.0 (go1.23.4 X:nocoverageredesign)",
      "content-type": "application/connect+proto",
      "connect-protocol-version": "1",
      "accept-encoding": "identity",
      host: "server.codeium.com",
      "connect-content-encoding": "gzip",
      "connect-accept-encoding": "gzip",
    };
  }

  async execute({ body, credentials, upstreamExtraHeaders }: ExecuteInput) {
    const token = getWindsurfToken(credentials);
    const headers = this.buildHeaders(credentials);
    mergeUpstreamExtraHeaders(headers, upstreamExtraHeaders);
    const requestedModel =
      typeof (body as { model?: unknown })?.model === "string"
        ? ((body as { model: string }).model ?? "")
        : "";
    const resolvedModel = trimWindsurfModelPrefix(requestedModel) || requestedModel;

    if (!token) {
      return {
        response: new Response(
          JSON.stringify({
            error: {
              message: "Windsurf token is required. Add a Windsurf provider connection first.",
              type: "authentication_error",
              code: "token_required",
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        ),
        url: this.buildUrl(),
        headers,
        transformedBody: body,
      };
    }

    return {
      response: new Response(
        JSON.stringify({
          error: {
            message:
              "Windsurf native protocol support remains experimental. Internal client auth has been observed, the OAuth abstraction is placeholder-only, and unsupported third-party OAuth is disabled by default.",
            type: "provider_error",
            code: "windsurf_protocol_not_implemented",
          },
        }),
        { status: 501, headers: { "Content-Type": "application/json" } }
      ),
      url: this.buildUrl(),
      headers,
      transformedBody:
        resolvedModel && typeof body === "object" && body !== null
          ? { ...(body as Record<string, unknown>), model: resolvedModel }
          : body,
    };
  }
}

export default WindsurfExecutor;
