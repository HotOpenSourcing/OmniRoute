/**
 * Service kind — declarative tag for what a provider can do beyond basic LLM chat.
 * Affects UI filtering and playground routing; does not influence request routing.
 */
export type ServiceKind =
  | "llm"
  | "embedding"
  | "image"
  | "imageToText"
  | "tts"
  | "stt"
  | "webSearch"
  | "webFetch"
  | "video"
  | "music";

export type RiskNoticeVariant = "oauth" | "webCookie" | "deprecated" | "embedded-service";

export interface ProviderRiskNoticeFields {
  subscriptionRisk?: boolean;
  riskNoticeVariant?: RiskNoticeVariant;
  isEmbeddedService?: boolean;
}

import { NOAUTH_PROVIDERS } from "./providers/noauth";
import { OAUTH_PROVIDERS } from "./providers/oauth";
import { WEB_COOKIE_PROVIDERS } from "./providers/web-cookie";
import { APIKEY_PROVIDERS } from "./providers/apikey";
import { LOCAL_PROVIDERS } from "./providers/local";
import { SEARCH_PROVIDERS } from "./providers/search";
import { AUDIO_ONLY_PROVIDERS } from "./providers/audio";
import { UPSTREAM_PROXY_PROVIDERS } from "./providers/upstream-proxy";
import { CLOUD_AGENT_PROVIDERS } from "./providers/cloud-agent";
import { SYSTEM_PROVIDERS } from "./providers/system";

export const FREE_PROVIDERS = {};

// No-auth Providers

export const FREE_APIKEY_PROVIDER_IDS = new Set([
  "qoder",
  "mimocode",
  "opencode",
  // codebuddy-cn is OAuth-primary but the Tencent gateway also accepts a direct
  // API key (Authorization: Bearer). Admit it through the same managed-provider
  // gate so POST /api/providers accepts the dual-auth shape.
  "codebuddy-cn",
]);

export function supportsApiKeyOnFreeProvider(providerId: unknown): boolean {
  return typeof providerId === "string" && FREE_APIKEY_PROVIDER_IDS.has(providerId);
}

// OAuth Providers
export const OAUTH_PROVIDERS = {
  qoder: {
    id: "qoder",
    alias: "if",
    name: "Qoder AI",
    icon: "water_drop",
    color: "#6366F1",
    subscriptionRisk: true,
    riskNoticeVariant: "oauth",
    hasFree: true,
    rateLimitProtected: true,
  },
  qwen: {
    id: "qwen",
    alias: "qw",
    name: "Qwen Code",
    icon: "psychology",
    color: "#10B981",
    subscriptionRisk: true,
    riskNoticeVariant: "deprecated",
    deprecated: true,
    deprecationReason:
      "Qwen OAuth free tier was discontinued on 2026-04-15. Use 'bailian-coding-plan', 'alibaba', 'alibaba-cn', or 'openrouter' provider with API key instead.",
    rateLimitProtected: true,
  },
  "gemini-cli": {
    id: "gemini-cli",
    alias: "gemini-cli",
    name: "Gemini CLI",
    icon: "terminal",
    color: "#4285F4",
    subscriptionRisk: true,
    riskNoticeVariant: "deprecated",
    hasFree: true,
    authHint:
      "Uses Gemini CLI OAuth / Cloud Code credentials. Pro models require an eligible Google account or paid plan.",
    rateLimitProtected: true,
  },
  agy: {
    id: "agy",
    alias: "agy",
    name: "Antigravity CLI",
    icon: "terminal",
    color: "#F59E0B",
    textIcon: "AGY",
    website: "https://antigravity.google",
    subscriptionRisk: true,
    riskNoticeVariant: "oauth",
    hasFree: true,
    authHint:
      "Import your Antigravity CLI (`agy`) login (paste/upload its token file), auto-detect a local CLI login, or sign in with Google. Shares the Antigravity backend (incl. Claude models).",
    rateLimitProtected: true,
  },
  kiro: {
    id: "kiro",
    alias: "kr",
    name: "Kiro AI",
    icon: "psychology_alt",
    color: "#FF6B35",
    subscriptionRisk: true,
    riskNoticeVariant: "deprecated",
    hasFree: true,
    freeNote:
      "Free tier: 50 credits/month (~25K–100K tokens). ⚠️ Kiro ToS prohibits third-party proxy/harness use.",
    rateLimitProtected: true,
    perKeyProxyByDefault: true,
  },
  "amazon-q": {
    id: "amazon-q",
    alias: "aq",
    name: "Amazon Q",
    icon: "cloud",
    color: "#FF9900",
    textIcon: "AQ",
    website: "https://aws.amazon.com/q/developer/",
    hasFree: true,
    authHint:
      "Uses the same AWS Builder ID or imported refresh-token flow as Kiro, but keeps Amazon Q connections separate.",
    rateLimitProtected: true,
  },
  claude: {
    id: "claude",
    alias: "cc",
    name: "Claude Code",
    icon: "smart_toy",
    color: "#D97757",
    subscriptionRisk: true,
    riskNoticeVariant: "oauth",
    rateLimitProtected: true,
  },
  antigravity: {
    id: "antigravity",
    alias: undefined,
    name: "Antigravity",
    icon: "rocket_launch",
    color: "#F59E0B",
    subscriptionRisk: true,
    riskNoticeVariant: "oauth",
    rateLimitProtected: true,
  },
  codex: {
    id: "codex",
    alias: "cx",
    name: "OpenAI Codex",
    icon: "code",
    color: "#3B82F6",
    subscriptionRisk: true,
    riskNoticeVariant: "oauth",
    rateLimitProtected: true,
  },
  github: { id: "github", alias: "gh", name: "GitHub Copilot", icon: "code", color: "#333333", rateLimitProtected: true },
  "gitlab-duo": {
    id: "gitlab-duo",
    alias: "gitlab-duo",
    name: "GitLab Duo",
    icon: "hub",
    color: "#FC6D26",
    textIcon: "GL",
    website: "https://docs.gitlab.com/user/duo_agent_platform/code_suggestions/",
    authHint:
      "OAuth application with ai_features + read_user scopes. Configure GITLAB_DUO_OAUTH_CLIENT_ID and optionally GITLAB_DUO_OAUTH_CLIENT_SECRET on this OmniRoute instance.",
    rateLimitProtected: true,
  },
  cursor: {
    id: "cursor",
    alias: "cu",
    name: "Cursor IDE",
    icon: "edit_note",
    color: "#00D4AA",
    subscriptionRisk: true,
    riskNoticeVariant: "oauth",
    rateLimitProtected: true,
  },
  zed: {
    id: "zed",
    alias: "zd",
    name: "Zed IDE",
    icon: "code",
    color: "#084CCF",
    textIcon: "ZD",
    website: "https://zed.dev",
    authHint:
      "Zed stores LLM provider credentials (OpenAI, Anthropic, Google, Mistral, xAI) in the OS keychain. Use the Import button below to discover and import them automatically.",
    rateLimitProtected: true,
  },
  trae: {
    id: "trae",
    alias: "tr",
    name: "Trae",
    icon: "edit_square",
    color: "#FF7849",
    textIcon: "TR",
    website: "https://trae.ai",
    authHint:
      "Trae is an AI-native IDE by ByteDance (SOLO remote agent). Authorize via trae.ai in the popup, or sign in at solo.trae.ai and paste the Cloud-IDE-JWT (sent as 'Authorization: Cloud-IDE-JWT <token>', ~14-day lifetime) as the access token; web_id/biz_user_id/user_unique_id/scope/tenant/region propagate via providerSpecificData. No headless refresh for pasted tokens — re-paste on expiry.",
    rateLimitProtected: true,
  },
  "kimi-coding": {
    id: "kimi-coding",
    alias: "kmc",
    name: "Kimi Coding",
    icon: "psychology",
    color: "#1E40AF",
    textIcon: "KC",
    subscriptionRisk: true,
    riskNoticeVariant: "oauth",
    rateLimitProtected: true,
  },
  kilocode: {
    id: "kilocode",
    alias: "kc",
    name: "Kilo Code",
    icon: "code",
    color: "#FF6B35",
    textIcon: "KC",
    subscriptionRisk: true,
    riskNoticeVariant: "oauth",
    rateLimitProtected: true,
  },
  cline: {
    id: "cline",
    alias: "cl",
    name: "Cline",
    icon: "smart_toy",
    color: "#5B9BD5",
    textIcon: "CL",
    subscriptionRisk: true,
    riskNoticeVariant: "oauth",
    rateLimitProtected: true,
  },
  windsurf: {
    id: "windsurf",
    alias: "ws",
    name: "Windsurf (Devin CLI)",
    icon: "air",
    color: "#00C5A0",
    textIcon: "WS",
    enabled: false,
    subscriptionRisk: true,
    riskNoticeVariant: "oauth",
    authHint:
      'In the Windsurf / VS Code IDE, open the command palette and run `Windsurf: Provide Auth Token` (or click the Jupyter "Get Windsurf Authentication Token" button), then copy the shown token and paste it here. Note: opening windsurf.com/show-auth-token directly only renders a "Redirecting" page — the IDE must initiate the flow (it adds a `?state=...` param) for the token to appear.',
    website: "https://windsurf.com",
    rateLimitProtected: true,
  },
  "devin-cli": {
    id: "devin-cli",
    alias: "dv",
    name: "Devin CLI (Official)",
    icon: "terminal",
    color: "#6366F1",
    textIcon: "DV",
    authHint:
      "Requires the Devin CLI binary. Run `devin auth login` to authenticate, or provide your WINDSURF_API_KEY. Install: https://cli.devin.ai",
    website: "https://cli.devin.ai",
    rateLimitProtected: true,
  },
};

// Web / Cookie Providers

// API Key Providers
export const APIKEY_PROVIDERS = {
  agentrouter: {
    id: "agentrouter",
    alias: "agentrouter",
    name: "AgentRouter",
    icon: "router",
    color: "#10B981",
    textIcon: "AR",
    passthroughModels: true,
    website: "https://agentrouter.org",
    hasFree: true,
    freeNote: "$200 free credits on signup - multi-model routing gateway",
    apiHint: "Get $200 free credits at https://agentrouter.org/register — no credit card required.",
    rateLimitProtected: true,
  },
  kimchi: {
    id: "kimchi",
    alias: "kimchi",
    name: "Kimchi AI (Cast AI)",
    icon: "eco",
    color: "#E63946",
    textIcon: "KC",
    passthroughModels: true,
    website: "https://kimchi.dev",
    apiHint:
      "Get a Kimchi API key (format: castai_v1_…) and paste it here. Requests are routed to https://llm.kimchi.dev/openai/v1/chat/completions.",
    rateLimitProtected: true,
  },
  "command-code": {
    id: "command-code",
    alias: "cmd",
    name: "Command Code",
    icon: "terminal",
    color: "#111827",
    textIcon: "CC",
    website: "https://commandcode.ai/",
    authHint:
      "Use a Command Code API key. Requests are sent to Command Code's /alpha/generate endpoint.",
    apiHint: "Create or copy an API key from Command Code, then paste it here as a Bearer token.",
    rateLimitProtected: true,
  },
  openrouter: {
    id: "openrouter",
    alias: "openrouter",
    name: "OpenRouter",
    icon: "router",
    color: "#F97316",
    textIcon: "OR",
    passthroughModels: true,
    website: "https://openrouter.ai",
    hasFree: true,
    freeNote: "Free models at $0/token with :free suffix - 20 RPM / 200 RPD",
    rateLimitProtected: true,
  },
  orcarouter: {
    id: "orcarouter",
    alias: "orcarouter",
    name: "OrcaRouter",
    icon: "router",
    color: "#0891B2",
    textIcon: "ORC",
    passthroughModels: true,
    website: "https://www.orcarouter.ai",
    apiHint:
      "Create an API key (starts with sk-orca-) at https://www.orcarouter.ai, then paste it as a Bearer token. OpenAI-compatible endpoint at https://api.orcarouter.ai/v1.",
    rateLimitProtected: true,
  },
  "api-airforce": {
    id: "api-airforce",
    alias: "af",
    name: "Api.airforce",
    icon: "flight",
    color: "#1E3A5F",
    textIcon: "AF",
    website: "https://api.airforce",
    hasFree: true,
    freeNote:
      "55 free tier models including Grok-3, Claude 3.7, Qwen3, Kimi-K2, Gemini 2.5 Flash, DeepSeek-V3",
    apiHint:
      "Get your API key from https://panel.api.airforce — OpenAI-compatible endpoint at https://api.airforce/v1",
    rateLimitProtected: true,
  },
  qianfan: {
    id: "qianfan",
    alias: "qianfan",
    name: "Baidu Qianfan",
    icon: "cloud",
    color: "#2468F2",
    textIcon: "BD",
    website: "https://cloud.baidu.com/product/wenxinworkshop",
    apiHint:
      "Use a Qianfan API key from Baidu AI Cloud. The default endpoint is OpenAI-compatible v2.",
    rateLimitProtected: true,
  },
  glm: {
    id: "glm",
    alias: "glm",
    name: "GLM Coding",
    icon: "code",
    color: "#2563EB",
    textIcon: "GL",
    website: "https://z.ai/subscribe",
    rateLimitProtected: true,
  },
  "glm-cn": {
    id: "glm-cn",
    alias: "glmcn",
    name: "GLM Coding (China)",
    icon: "code",
    color: "#DC2626",
    textIcon: "GC",
    website: "https://open.bigmodel.cn",
    rateLimitProtected: true,
  },
  glmt: {
    id: "glmt",
    alias: "glmt",
    name: "GLM Thinking",
    icon: "psychology",
    color: "#1D4ED8",
    textIcon: "GT",
    website: "https://open.bigmodel.cn",
    apiHint: "Preset GLM profile with higher token budget, thinking enabled, and longer timeout.",
    rateLimitProtected: true,
  },
  "bailian-coding-plan": {
    id: "bailian-coding-plan",
    alias: "bcp",
    name: "Alibaba Coding Plan",
    icon: "code",
    color: "#FF6A00",
    textIcon: "BCP",
    website: "https://www.alibabacloud.com/help/en/model-studio/coding-plan",
    rateLimitProtected: true,
  },
  kimi: {
    id: "kimi",
    alias: "kimi",
    name: "Kimi",
    icon: "psychology",
    color: "#1E3A8A",
    textIcon: "KM",
    website: "https://platform.moonshot.ai",
    rateLimitProtected: true,
  },
  "kimi-coding-apikey": {
    id: "kimi-coding-apikey",
    alias: "kmca",
    name: "Kimi Coding (API Key)",
    icon: "psychology",
    color: "#1E40AF",
    textIcon: "KC",
    website: "https://www.kimi.com/code",
    rateLimitProtected: true,
  },
  minimax: {
    id: "minimax",
    alias: "minimax",
    name: "Minimax Coding",
    icon: "memory",
    color: "#7C3AED",
    textIcon: "MM",
    website: "https://www.minimax.io",
    rateLimitProtected: true,
  },
  "minimax-cn": {
    id: "minimax-cn",
    alias: "minimax-cn",
    name: "Minimax (China)",
    icon: "memory",
    color: "#DC2626",
    textIcon: "MC",
    website: "https://www.minimaxi.com",
    rateLimitProtected: true,
  },
  crof: {
    id: "crof",
    alias: "crof",
    name: "CrofAI",
    icon: "auto_awesome",
    color: "#0EA5E9",
    textIcon: "CR",
    website: "https://crof.ai",
    rateLimitProtected: true,
  },
  openai: {
    id: "openai",
    alias: "openai",
    name: "OpenAI",
    icon: "auto_awesome",
    color: "#10A37F",
    textIcon: "OA",
    website: "https://platform.openai.com",
    rateLimitProtected: true,
  },
  "azure-openai": {
    id: "azure-openai",
    alias: "azure",
    name: "Azure OpenAI",
    icon: "cloud",
    color: "#0078D4",
    textIcon: "AZ",
    website: "https://azure.microsoft.com/products/ai-services/openai-service",
    authHint:
      "Use your Azure OpenAI API key. Base URL should be your resource endpoint, for example https://my-resource.openai.azure.com.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  "azure-ai": {
    id: "azure-ai",
    alias: "azure-ai",
    name: "Azure AI Foundry",
    icon: "cloud",
    color: "#2563EB",
    textIcon: "AF",
    website: "https://learn.microsoft.com/azure/ai-foundry",
    authHint:
      "Use your Azure AI Foundry key. Base URL can be https://<resource>.services.ai.azure.com/openai/v1/ or https://<resource>.openai.azure.com/openai/v1/.",
    apiHint:
      "Foundry uses the OpenAI v1 surface with deployment names as models. OmniRoute normalizes root resource URLs to the v1 chat and /models endpoints.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  bedrock: {
    id: "bedrock",
    alias: "bedrock",
    name: "Amazon Bedrock",
    icon: "cloud",
    color: "#FF9900",
    textIcon: "BR",
    website: "https://aws.amazon.com/bedrock",
    authHint:
      "Use your Amazon Bedrock API key and configure the AWS region where your models are enabled (for example eu-west-2). OmniRoute calls Bedrock's native Converse API directly.",
    apiHint:
      "Native Bedrock integration: model discovery uses Bedrock foundation models and inference profiles, while chat uses the regional Bedrock Runtime Converse/ConverseStream APIs.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  watsonx: {
    id: "watsonx",
    alias: "watsonx",
    name: "IBM watsonx.ai Gateway",
    icon: "hub",
    color: "#0F62FE",
    textIcon: "WX",
    website: "https://www.ibm.com/products/watsonx-ai",
    authHint:
      "Use your watsonx bearer token. Base URL can be https://<region>.ml.cloud.ibm.com/ml/gateway/v1/ or a self-managed /ml/gateway/v1 endpoint.",
    apiHint:
      "The watsonx model gateway exposes OpenAI-compatible /chat/completions and /models under /ml/gateway/v1.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  oci: {
    id: "oci",
    alias: "oci",
    name: "OCI Generative AI",
    icon: "cloud",
    color: "#C74634",
    textIcon: "OCI",
    website: "https://www.oracle.com/artificial-intelligence/generative-ai",
    authHint:
      "Use your OCI Generative AI API key or IAM bearer token. Base URL can be https://inference.generativeai.<region>.oci.oraclecloud.com/openai/v1/.",
    apiHint:
      "OCI exposes OpenAI-compatible chat and responses endpoints. Project ID is optional in OmniRoute but may be required for Responses and agentic workflows.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  sap: {
    id: "sap",
    alias: "sap",
    name: "SAP Generative AI Hub",
    icon: "business",
    color: "#0FAAFF",
    textIcon: "SAP",
    website:
      "https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/generative-ai-hub-in-sap-ai-core",
    authHint:
      "Use your SAP AI Core bearer token. Base URL can be your AI_API_URL root or a deploymentUrl from Generative AI Hub.",
    apiHint:
      "Model discovery uses /v2/lm/scenarios/foundation-models/models on AI_API_URL. Chat requests use deploymentUrl/chat/completions and require AI-Resource-Group.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  modal: {
    id: "modal",
    alias: "mdl",
    name: "Modal",
    icon: "cloud_queue",
    color: "#7C3AED",
    textIcon: "MDL",
    website: "https://modal.com/docs",
    authHint:
      "Use the bearer token that protects your Modal deployment, if enabled. Base URL should point to your OpenAI-compatible Modal app, for example https://<workspace>--<app>.modal.run/v1.",
    apiHint:
      "Modal commonly serves user-hosted OpenAI-compatible apps on /v1. OmniRoute will probe /v1/models and route chat traffic to /v1/chat/completions.",
    hasFree: true,
    freeNote: "$30/month free credits for new accounts",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  reka: {
    id: "reka",
    alias: "reka",
    name: "Reka",
    icon: "auto_awesome",
    color: "#111827",
    textIcon: "RK",
    website: "https://docs.reka.ai/chat/overview",
    authHint:
      "Use your Reka API key. OmniRoute supports the OpenAI-compatible base URL https://api.reka.ai/v1 and sends both Authorization and X-Api-Key headers for compatibility.",
    apiHint:
      "Reka Chat is OpenAI-compatible on /v1. OmniRoute probes /v1/models and routes chat traffic to /v1/chat/completions.",
    hasFree: true,
    freeNote: "$10/month recurring free API credits",
    rateLimitProtected: true,
  },
  nlpcloud: {
    id: "nlpcloud",
    alias: "nlpc",
    name: "NLP Cloud",
    icon: "psychology",
    color: "#2196F3",
    textIcon: "NLPC",
    website: "https://docs.nlpcloud.com",
    authHint:
      "Use your NLP Cloud API key in Authorization: Token <key>. OmniRoute targets the chatbot endpoint on https://api.nlpcloud.io/v1/gpu/<model>/chatbot by default.",
    apiHint:
      "NLP Cloud uses a proprietary chatbot API instead of OpenAI chat/completions. OmniRoute adapts OpenAI messages to input/context/history and exposes a local catalog of supported chatbot models.",
    hasFree: true,
    freeNote: "Trial credits for new accounts",
    rateLimitProtected: true,
  },
  runwayml: {
    id: "runwayml",
    alias: "runway",
    name: "Runway",
    icon: "movie",
    color: "#111827",
    textIcon: "RW",
    website: "https://docs.dev.runwayml.com",
    authHint:
      "Use your Runway API key in Authorization: Bearer <key>. OmniRoute targets the current Runway API at https://api.dev.runwayml.com/v1 and sends the required X-Runway-Version header automatically.",
    apiHint:
      "Runway video generation is task-based. OmniRoute submits text-to-video or image-to-video jobs, polls /v1/tasks/{id}, and normalizes the finished video outputs back into the OpenAI-like /v1/videos/generations response.",
    rateLimitProtected: true,
  },
  anthropic: {
    id: "anthropic",
    alias: "anthropic",
    name: "Anthropic",
    icon: "smart_toy",
    color: "#D97757",
    textIcon: "AN",
    website: "https://platform.claude.com",
    rateLimitProtected: true,
  },
  gemini: {
    id: "gemini",
    alias: "gemini",
    name: "Gemini (Google AI Studio)",
    icon: "diamond",
    color: "#4285F4",
    textIcon: "GE",
    website: "https://aistudio.google.com",
    hasFree: true,
    freeNote:
      "Free forever: 1,500 req/day for Gemini 2.5 Flash — no credit card, get key at aistudio.google.com",
    rateLimitProtected: true,
  },
  deepseek: {
    id: "deepseek",
    alias: "ds",
    name: "DeepSeek",
    icon: "bolt",
    color: "#4D6BFE",
    textIcon: "DS",
    website: "https://platform.deepseek.com",
    hasFree: true,
    freeNote: "5M free tokens on signup - no credit card required",
    rateLimitProtected: true,
  },
  groq: {
    id: "groq",
    alias: "groq",
    name: "Groq",
    icon: "speed",
    color: "#F55036",
    textIcon: "GQ",
    website: "https://groq.com",
    hasFree: true,
    freeNote: "Free tier: 30 RPM / 14.4K RPD — no credit card",
    rateLimitProtected: true,
  },
  blackbox: {
    id: "blackbox",
    alias: "bb",
    name: "Blackbox AI",
    icon: "view_in_ar",
    color: "#1A1A2E",
    textIcon: "BB",
    website: "https://blackbox.ai",
    hasFree: true,
    freeNote: "Free tier: unlimited basic chat plus Minimax-M2.5, no credit card required",
    rateLimitProtected: true,
  },
  bazaarlink: {
    id: "bazaarlink",
    alias: "bzl",
    name: "BazaarLink",
    icon: "storefront",
    color: "#6366F1",
    textIcon: "BZ",
    website: "https://bazaarlink.ai",
    hasFree: true,
    freeNote: "Free tier with auto:free routing — zero-cost inference, no credit card required",
    apiHint:
      "Get free API key at https://bazaarlink.ai — use model 'auto:free' for zero-cost inference. OpenAI-compatible.",
    rateLimitProtected: true,
  },
  xai: {
    id: "xai",
    alias: "xai",
    name: "xAI (Grok)",
    icon: "auto_awesome",
    color: "#1DA1F2",
    textIcon: "XA",
    website: "https://x.ai",
    rateLimitProtected: true,
  },
  mistral: {
    id: "mistral",
    alias: "mistral",
    name: "Mistral",
    icon: "air",
    color: "#FF7000",
    textIcon: "MI",
    website: "https://mistral.ai",
    hasFree: true,
    freeNote: "Free Experiment tier: rate-limited access to all models, no credit card required",
    rateLimitProtected: true,
  },
  perplexity: {
    id: "perplexity",
    alias: "pplx",
    name: "Perplexity",
    icon: "search",
    color: "#20808D",
    textIcon: "PP",
    website: "https://www.perplexity.ai",
    rateLimitProtected: true,
  },
  together: {
    id: "together",
    alias: "together",
    name: "Together AI",
    icon: "group_work",
    color: "#0F6FFF",
    textIcon: "TG",
    website: "https://www.together.ai",
    hasFree: true,
    freeNote:
      "$25 signup credits + 3 permanently free models: Llama 3.3 70B, Vision, DeepSeek-R1 distill",
    rateLimitProtected: true,
  },
  fireworks: {
    id: "fireworks",
    alias: "fireworks",
    name: "Fireworks AI",
    icon: "local_fire_department",
    color: "#7B2EF2",
    textIcon: "FW",
    website: "https://fireworks.ai",
    hasFree: true,
    freeNote: "$1 free starter credits on signup for API testing",
    rateLimitProtected: true,
  },
  cerebras: {
    id: "cerebras",
    alias: "cerebras",
    name: "Cerebras",
    icon: "memory",
    color: "#FF4F00",
    textIcon: "CB",
    website: "https://inference.cerebras.ai",
    hasFree: true,
    freeNote: "Free Trial: 1M tokens/day, 30K TPM, 5 RPM — no credit card.",
    rateLimitProtected: true,
  },
  cohere: {
    id: "cohere",
    alias: "cohere",
    name: "Cohere",
    icon: "hub",
    color: "#39594D",
    textIcon: "CO",
    website: "https://cohere.com",
    hasFree: true,
    freeNote: "Free Trial: 1,000 API calls/month for testing, no credit card required",
    rateLimitProtected: true,
  },
  nvidia: {
    id: "nvidia",
    alias: "nvidia",
    name: "NVIDIA NIM",
    icon: "developer_board",
    color: "#76B900",
    textIcon: "NV",
    website: "https://build.nvidia.com",
    hasFree: true,
    freeNote: "Free dev access: ~40 RPM, 70+ models (Kimi K2.5, GLM 4.7, DeepSeek V3.2...)",
    rateLimitProtected: true,
  },
  nebius: {
    id: "nebius",
    alias: "nebius",
    name: "Nebius AI",
    icon: "cloud",
    color: "#6C5CE7",
    textIcon: "NB",
    website: "https://nebius.com",
    hasFree: true,
    freeNote: "~$1 trial credits on signup for API testing",
    rateLimitProtected: true,
  },
  siliconflow: {
    id: "siliconflow",
    alias: "siliconflow",
    name: "SiliconFlow",
    icon: "cloud_queue",
    color: "#5B6EF5",
    textIcon: "SF",
    website: "https://cloud.siliconflow.com",
    hasFree: true,
    freeNote: "$1 free credits plus permanently free models after identity verification",
    rateLimitProtected: true,
  },
  hyperbolic: {
    id: "hyperbolic",
    alias: "hyp",
    name: "Hyperbolic",
    icon: "bolt",
    color: "#00D4FF",
    textIcon: "HY",
    website: "https://hyperbolic.xyz",
    hasFree: true,
    freeNote: "$1-5 trial credits on signup for serverless inference",
    rateLimitProtected: true,
  },
  kie: {
    id: "kie",
    alias: "kie",
    name: "KIE.AI",
    icon: "hub",
    color: "#2563EB",
    textIcon: "KIE",
    website: "https://kie.ai",
    rateLimitProtected: true,
  },
  "ollama-cloud": {
    id: "ollama-cloud",
    alias: "ollamacloud",
    name: "Ollama Cloud",
    icon: "cloud",
    color: "#58A6FF",
    textIcon: "OC",
    website: "https://ollama.com/settings/api-keys",
    hasFree: true,
    rateLimitProtected: true,
  },
  huggingface: {
    id: "huggingface",
    alias: "hf",
    name: "HuggingFace",
    icon: "face",
    color: "#FFD21E",
    textIcon: "HF",
    website: "https://huggingface.co",
    hasFree: true,
    freeNote: "Free Inference API for thousands of models (Whisper, VITS, SDXL…)",
    rateLimitProtected: true,
  },
  synthetic: {
    id: "synthetic",
    alias: "synthetic",
    name: "Synthetic",
    icon: "verified_user",
    color: "#6366F1",
    textIcon: "SY",
    website: "https://synthetic.new",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  "kilo-gateway": {
    id: "kilo-gateway",
    alias: "kg",
    name: "Kilo Gateway",
    icon: "hub",
    color: "#617A91",
    textIcon: "KG",
    website: "https://kilo.ai",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  vertex: {
    id: "vertex",
    alias: "vertex",
    name: "Vertex AI",
    icon: "cloud",
    color: "#4285F4",
    textIcon: "VA",
    website: "https://cloud.google.com/vertex-ai",
    hasFree: true,
    authHint: "Provide Service Account JSON or OAuth access_token",
    rateLimitProtected: true,
  },
  "vertex-partner": {
    id: "vertex-partner",
    alias: "vp",
    name: "Vertex AI Partners",
    icon: "cloud",
    color: "#34A853",
    textIcon: "VP",
    website: "https://cloud.google.com/vertex-ai",
    authHint: "Provide the same Service Account JSON used for Vertex AI partner models.",
    rateLimitProtected: true,
  },
  zai: {
    id: "zai",
    alias: "zai",
    name: "Z.AI",
    icon: "psychology",
    color: "#2563EB",
    textIcon: "ZA",
    website: "https://open.bigmodel.cn",
    apiHint: "API key from https://open.bigmodel.cn/usercenter/apikeys",
    rateLimitProtected: true,
  },
  "zai-coding-plan": {
    id: "zai-coding-plan",
    alias: "zcp",
    name: "Z.AI Coding Plan",
    icon: "code",
    color: "#2563EB",
    textIcon: "ZC",
    website: "https://zcode.z.ai",
    authHint: "OAuth via ZCode CLI flow - JWT token-based authentication",
    rateLimitProtected: true,
    serviceKinds: ["llm"],
    subscriptionRisk: true,
    riskNoticeVariant: "oauth" as RiskNoticeVariant,
    notice: {
      text: "Z.AI Coding Plan requires OAuth authentication via ZCode CLI flow. The provider uses JWT tokens for API access.",
    },
  },
  wafer: {
    id: "wafer",
    alias: "wafer",
    name: "Wafer AI",
    icon: "layers",
    color: "#6366F1",
    textIcon: "WF",
    website: "https://wafer.ai",
    apiHint: "API key from https://wafer.ai",
    rateLimitProtected: true,
  },
  "opencode-zen": {
    id: "opencode-zen",
    alias: "opencode-zen",
    name: "OpenCode Zen",
    icon: "opencode",
    color: "#6366f1",
    website: "https://opencode.ai/zen",
    anonymousFallback: true,
    rateLimitProtected: true,
  },
  "opencode-go": {
    id: "opencode-go",
    alias: "opencode-go",
    name: "OpenCode Go",
    icon: "opencode",
    color: "#6366f1",
    website: "https://opencode.ai/go",
    anonymousFallback: true,
    rateLimitProtected: true,
  },
  alibaba: {
    id: "alibaba",
    alias: "ali",
    name: "Alibaba",
    icon: "cloud_queue",
    color: "#FF6600",
    textIcon: "AL",
    website: "https://dashscope-intl.aliyuncs.com",
    hasFree: false,
    rateLimitProtected: true,
  },
  "alibaba-cn": {
    id: "alibaba-cn",
    alias: "ali-cn",
    name: "Alibaba (China)",
    icon: "cloud_queue",
    color: "#FF6600",
    textIcon: "AL",
    website: "https://dashscope.aliyuncs.com",
    hasFree: false,
    rateLimitProtected: true,
  },
  longcat: {
    id: "longcat",
    alias: "lc",
    name: "LongCat AI",
    icon: "auto_awesome",
    color: "#FF6B9D",
    textIcon: "LC",
    website: "https://longcat.chat/platform/docs",
    hasFree: true,
    freeNote:
      "Free: 5M tokens/day on LongCat-2.0-Preview (Flash models retired 2026-05-29); up to 120M/day via feedback.",
    rateLimitProtected: true,
  },
  pollinations: {
    id: "pollinations",
    alias: "pol",
    name: "Pollinations AI",
    icon: "local_florist",
    color: "#4CAF50",
    textIcon: "PO",
    website: "https://pollinations.ai",
    hasFree: true,
    anonymousFallback: true,
    freeNote:
      "Free keyless tier: openai, openai-fast, openai-large, qwen-coder, mistral, deepseek, grok, gemini-flash-lite-3.1, perplexity-fast, perplexity-reasoning. Premium models (claude, gemini, midijourney) require a Pollinations API key from enter.pollinations.ai.",
    rateLimitProtected: true,
  },
  puter: {
    id: "puter",
    alias: "pu",
    name: "Puter AI",
    icon: "cloud_circle",
    color: "#6366F1",
    textIcon: "PU",
    website: "https://puter.com",
    hasFree: true,
    freeNote:
      "500+ models (GPT-5, Claude Opus 4, Gemini 3 Pro, Grok 4, DeepSeek V3...) — Users pay via free Puter account",
    passthroughModels: true,
    authHint: "Get token at puter.com/dashboard → Copy Auth Token",
    rateLimitProtected: true,
  },
  uncloseai: {
    id: "uncloseai",
    alias: "unc",
    name: "UncloseAI",
    icon: "auto_awesome",
    color: "#8B5CF6",
    textIcon: "UN",
    website: "https://uncloseai.com",
    hasFree: true,
    freeNote: "Free forever — no signup, no credit card. OpenAI-compatible endpoints.",
    passthroughModels: true,
    authHint: "No auth required. API accepts any non-empty string as key for identification.",
    rateLimitProtected: true,
  },
  hackclub: {
    id: "hackclub",
    alias: "hc",
    name: "Hackclub AI",
    icon: "auto_awesome",
    color: "#FF6B00",
    textIcon: "HC",
    website: "https://ai.hackclub.com",
    hasFree: true,
    freeNote: "Free AI for Hack Club members — 30+ models, no credit card.",
    passthroughModels: true,
    authHint: "Sign in with your Hack Club account at ai.hackclub.com.",
    rateLimitProtected: true,
  },
  "github-models": {
    id: "github-models",
    alias: "ghm",
    name: "GitHub Models",
    icon: "code",
    color: "#238636",
    textIcon: "GH",
    website: "https://github.com/marketplace/models",
    hasFree: true,
    freeNote: "Free GPT-5, o-series, DeepSeek-R1, Llama 4, Grok 3 — GitHub account only.",
    authHint: "Create a GitHub PAT with 'models: read' scope at github.com/settings/tokens",
    rateLimitProtected: true,
  },
  haiper: {
    id: "haiper",
    alias: "hp",
    name: "Haiper",
    icon: "videocam",
    color: "#6366F1",
    textIcon: "HP",
    website: "https://haiper.ai",
    authHint: "Get API key at haiper.ai/haiper-api",
    rateLimitProtected: true,
  },
  leonardo: {
    id: "leonardo",
    alias: "leo",
    name: "Leonardo AI",
    icon: "palette",
    color: "#8B5CF6",
    textIcon: "LE",
    website: "https://leonardo.ai",
    authHint: "Get API key at leonardo.ai/developer",
    rateLimitProtected: true,
  },
  ideogram: {
    id: "ideogram",
    alias: "ideo",
    name: "Ideogram",
    icon: "image",
    color: "#EC4899",
    textIcon: "ID",
    website: "https://ideogram.ai",
    authHint: "Get API key at ideogram.ai/docs/api",
    rateLimitProtected: true,
  },
  suno: {
    id: "suno",
    alias: "suno",
    name: "Suno",
    icon: "music_note",
    color: "#F59E0B",
    textIcon: "SU",
    website: "https://suno.ai",
    authHint: "Paste session cookie from suno.ai (Clerk auth)",
    rateLimitProtected: true,
  },
  udio: {
    id: "udio",
    alias: "udio",
    name: "Udio",
    icon: "music_note",
    color: "#10B981",
    textIcon: "UD",
    website: "https://udio.com",
    authHint: "Paste session cookie from udio.com (Supabase auth)",
    rateLimitProtected: true,
  },
  "cloudflare-ai": {
    id: "cloudflare-ai",
    alias: "cf",
    name: "Cloudflare Workers AI",
    icon: "cloud",
    color: "#F48120",
    textIcon: "CF",
    website: "https://developers.cloudflare.com/workers-ai",
    hasFree: true,
    freeNote:
      "Free 10K Neurons/day: ~150 LLM responses or 500s Whisper audio — edge inference globally",
    authHint: "Requires API Token AND Account ID (found at dash.cloudflare.com)",
    rateLimitProtected: true,
  },
  scaleway: {
    id: "scaleway",
    alias: "scw",
    name: "Scaleway AI",
    icon: "cloud",
    color: "#4F0599",
    textIcon: "SCW",
    website: "https://www.scaleway.com/en/ai/generative-apis",
    hasFree: true,
    freeNote: "1M free tokens for new accounts — EU/GDPR compliant (Paris), Qwen3 235B & Llama 70B",
    rateLimitProtected: true,
  },
  deepinfra: {
    id: "deepinfra",
    alias: "deepinfra",
    name: "DeepInfra",
    icon: "hub",
    color: "#2563EB",
    textIcon: "DI",
    website: "https://deepinfra.com",
    hasFree: true,
    freeNote: "Free signup credits for API testing and model exploration",
    rateLimitProtected: true,
  },
  "vercel-ai-gateway": {
    id: "vercel-ai-gateway",
    alias: "vag",
    name: "Vercel AI Gateway",
    icon: "route",
    color: "#111827",
    textIcon: "VAI",
    website: "https://vercel.com/docs/ai-gateway",
    rateLimitProtected: true,
  },
  "lambda-ai": {
    id: "lambda-ai",
    alias: "lambda",
    name: "Lambda AI",
    icon: "bolt",
    color: "#7C3AED",
    textIcon: "LA",
    website: "https://lambda.ai",
    rateLimitProtected: true,
  },
  sambanova: {
    id: "sambanova",
    alias: "samba",
    name: "SambaNova",
    icon: "memory",
    color: "#DC2626",
    textIcon: "SN",
    website: "https://sambanova.ai",
    hasFree: true,
    freeNote: "$5 free credits on signup (30-day validity), no credit card required",
    rateLimitProtected: true,
  },
  nscale: {
    id: "nscale",
    alias: "nscale",
    name: "nScale",
    icon: "token",
    color: "#0891B2",
    textIcon: "NS",
    website: "https://nscale.com",
    hasFree: true,
    freeNote: "$5 free credits on signup for inference testing",
    rateLimitProtected: true,
  },
  ovhcloud: {
    id: "ovhcloud",
    alias: "ovh",
    name: "OVHcloud AI",
    icon: "cloud",
    color: "#2563EB",
    textIcon: "OVH",
    website: "https://www.ovhcloud.com",
    rateLimitProtected: true,
  },
  baseten: {
    id: "baseten",
    alias: "baseten",
    name: "Baseten",
    icon: "deployed_code",
    color: "#111827",
    textIcon: "BT",
    website: "https://baseten.co",
    hasFree: true,
    freeNote: "$30 free trial credits for GPU inference",
    rateLimitProtected: true,
  },
  publicai: {
    id: "publicai",
    alias: "publicai",
    name: "PublicAI",
    icon: "public",
    color: "#059669",
    textIcon: "PA",
    website: "https://publicai.co",
    // #3558: PublicAI requires an API key (registry authType:"apikey"); signup grants a
    // one-time credit, then it bills per-model. It is NOT a keyless/free tier.
    hasFree: false,
    freeNote: "Requires an API key — one-time signup credit, then paid",
    rateLimitProtected: true,
  },
  moonshot: {
    id: "moonshot",
    alias: "moonshot",
    name: "Moonshot AI",
    icon: "rocket_launch",
    color: "#1E40AF",
    textIcon: "MS",
    website: "https://platform.moonshot.ai",
    rateLimitProtected: true,
  },
  "meta-llama": {
    id: "meta-llama",
    alias: "meta",
    name: "Meta Llama API",
    icon: "smart_toy",
    color: "#0F766E",
    textIcon: "ML",
    website: "https://llama.developer.meta.com",
    rateLimitProtected: true,
  },
  "v0-vercel": {
    id: "v0-vercel",
    alias: "v0",
    name: "v0 (Vercel)",
    icon: "code_blocks",
    color: "#111827",
    textIcon: "V0",
    website: "https://v0.dev",
    rateLimitProtected: true,
  },
  morph: {
    id: "morph",
    alias: "morph",
    name: "Morph",
    icon: "auto_fix_high",
    color: "#2563EB",
    textIcon: "MP",
    website: "https://morphllm.com",
    hasFree: true,
    freeNote: "Free tier: 250K credits/month, $0",
    rateLimitProtected: true,
  },
  "featherless-ai": {
    id: "featherless-ai",
    alias: "featherless",
    name: "Featherless AI",
    icon: "flutter_dash",
    color: "#EA580C",
    textIcon: "FL",
    website: "https://featherless.ai",
    hasFree: true,
    freeNote: "Free tier available — no credit card required",
    rateLimitProtected: true,
  },
  llm7: {
    id: "llm7",
    alias: "llm7",
    name: "LLM7.io",
    icon: "hub",
    color: "#6366F1",
    textIcon: "LM",
    website: "https://llm7.io",
    hasFree: true,
    freeNote: "No signup required - 2 req/s, 20 RPM, 100 req/hr free tier",
    apiHint:
      "Works without API key (use 'unused' as key). Get free token at token.llm7.io for higher limits.",
    rateLimitProtected: true,
  },
  kluster: {
    id: "kluster",
    alias: "kluster",
    name: "Kluster AI",
    icon: "hub",
    color: "#8B5CF6",
    textIcon: "KL",
    website: "https://kluster.ai",
    hasFree: false,
    freeNote: "Discontinued 2026 — kluster.ai sunset (2026-06-09); no free tier.",
    apiHint: "Get API key at https://kluster.ai/dashboard/api-keys",
    subscriptionRisk: true,
    riskNoticeVariant: "deprecated",
    deprecated: true,
    deprecationReason:
      "kluster.ai shut down (2026-06-09); api.kluster.ai no longer resolves (sweep 2026-06-19). Use another OpenAI-compatible provider.",
    rateLimitProtected: true,
  },
  friendliai: {
    id: "friendliai",
    alias: "friendli",
    name: "FriendliAI",
    icon: "handshake",
    color: "#EC4899",
    textIcon: "FR",
    website: "https://friendli.ai",
    hasFree: true,
    freeNote: "Free tier for serverless inference — no credit card required",
    rateLimitProtected: true,
  },
  llamagate: {
    id: "llamagate",
    alias: "llamagate",
    name: "LlamaGate",
    icon: "gate",
    color: "#16A34A",
    textIcon: "LG",
    website: "https://llamagate.ai",
    rateLimitProtected: true,
  },
  heroku: {
    id: "heroku",
    alias: "heroku",
    name: "Heroku AI",
    icon: "cloud_upload",
    color: "#7C3AED",
    textIcon: "HK",
    website: "https://www.heroku.com",
    rateLimitProtected: true,
  },
  galadriel: {
    id: "galadriel",
    alias: "galadriel",
    name: "Galadriel",
    icon: "auto_awesome",
    color: "#F59E0B",
    textIcon: "GA",
    website: "https://galadriel.com",
    subscriptionRisk: true,
    riskNoticeVariant: "deprecated",
    deprecated: true,
    deprecationReason:
      "api.galadriel.ai no longer resolves (sweep 2026-06-19); the inference API appears discontinued.",
    rateLimitProtected: true,
  },
  databricks: {
    id: "databricks",
    alias: "databricks",
    name: "Databricks",
    icon: "table_chart",
    color: "#F97316",
    textIcon: "DB",
    website: "https://www.databricks.com",
    rateLimitProtected: true,
  },
  datarobot: {
    id: "datarobot",
    alias: "datarobot",
    name: "DataRobot",
    icon: "precision_manufacturing",
    color: "#6D28D9",
    textIcon: "DR",
    website: "https://docs.datarobot.com",
    authHint:
      "Use your DataRobot API token. Optional Base URL can be the account root (for LLM Gateway) or a deployment URL under /api/v2/deployments/<id>.",
    apiHint:
      "The default gateway catalogs active models from /genai/llmgw/catalog/. Deployment URLs are also supported for direct OpenAI-compatible chat requests.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  clarifai: {
    id: "clarifai",
    alias: "clarifai",
    name: "Clarifai",
    icon: "hub",
    color: "#7C3AED",
    textIcon: "CF",
    website: "https://docs.clarifai.com",
    authHint:
      "Use your Clarifai PAT or app-specific API key. OmniRoute targets the OpenAI-compatible endpoint at https://api.clarifai.com/v2/ext/openai/v1 and authenticates with Authorization: Key <token>.",
    apiHint:
      "Clarifai exposes OpenAI-compatible chat, responses and /models on /v2/ext/openai/v1. Public/community models typically require a PAT; app-scoped keys only work for resources inside that app.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  snowflake: {
    id: "snowflake",
    alias: "snowflake",
    name: "Snowflake Cortex",
    icon: "ac_unit",
    color: "#29B5E8",
    textIcon: "SF",
    website: "https://www.snowflake.com",
    rateLimitProtected: true,
  },
  wandb: {
    id: "wandb",
    alias: "wandb",
    name: "Weights & Biases Inference",
    icon: "monitoring",
    color: "#FFBE0B",
    textIcon: "WB",
    website: "https://wandb.ai",
    rateLimitProtected: true,
  },
  volcengine: {
    id: "volcengine",
    alias: "volcengine",
    name: "Volcengine",
    icon: "local_fire_department",
    color: "#DC2626",
    textIcon: "VE",
    website: "https://www.volcengine.com",
    rateLimitProtected: true,
  },
  ai21: {
    id: "ai21",
    alias: "ai21",
    name: "AI21 Labs",
    icon: "psychology_alt",
    color: "#0284C7",
    textIcon: "AI21",
    website: "https://www.ai21.com",
    hasFree: true,
    freeNote: "$10 trial credits on signup (valid 3 months), no credit card required",
    rateLimitProtected: true,
  },
  gigachat: {
    id: "gigachat",
    alias: "gigachat",
    name: "GigaChat (Sber)",
    icon: "lock_person",
    color: "#10B981",
    textIcon: "GC",
    website: "https://developers.sber.ru",
    rateLimitProtected: true,
  },
  venice: {
    id: "venice",
    alias: "venice",
    name: "Venice.ai",
    icon: "travel_explore",
    color: "#0EA5E9",
    textIcon: "VN",
    website: "https://venice.ai",
    rateLimitProtected: true,
  },
  codestral: {
    id: "codestral",
    alias: "codestral",
    name: "Codestral",
    icon: "terminal",
    color: "#FF7000",
    textIcon: "CS",
    website: "https://mistral.ai",
    rateLimitProtected: true,
  },
  upstage: {
    id: "upstage",
    alias: "upstage",
    name: "Upstage",
    icon: "trending_up",
    color: "#0F766E",
    textIcon: "UP",
    website: "https://www.upstage.ai",
    rateLimitProtected: true,
  },
  maritalk: {
    id: "maritalk",
    alias: "maritalk",
    name: "Maritalk",
    icon: "translate",
    color: "#1D4ED8",
    textIcon: "MT",
    website: "https://www.maritaca.ai",
    rateLimitProtected: true,
  },
  "xiaomi-mimo": {
    id: "xiaomi-mimo",
    alias: "mimo",
    name: "Xiaomi MiMo",
    icon: "devices",
    color: "#EA580C",
    textIcon: "MM",
    website: "https://mimo.mi.com",
    rateLimitProtected: true,
  },
  gitlawb: {
    id: "gitlawb",
    alias: "glb",
    name: "Gitlawb Opengateway (MiMo)",
    icon: "hub",
    color: "#10B981",
    textIcon: "GLB",
    website: "https://opengateway.gitlawb.com",
    hasFree: false,
    freeNote: "Free MiMo (xiaomi/mimo-v2.5) revoked 2026-05 — Opengateway is now a pay-as-you-go credit gateway; no recurring free model.",
    apiHint: "Get your API key from Gitlawb Opengateway dashboard.",
    rateLimitProtected: true,
  },
  "gitlawb-gmi": {
    id: "gitlawb-gmi",
    alias: "glb-gmi",
    name: "Gitlawb Opengateway (GMI Cloud)",
    icon: "hub",
    color: "#10B981",
    textIcon: "GMI",
    website: "https://opengateway.gitlawb.com",
    hasFree: false,
    freeNote: "Free Nemotron promo ended 2026-06 — the GMI Cloud route is now pay-as-you-go credit only.",
    apiHint: "Get your API key from Gitlawb Opengateway dashboard.",
    rateLimitProtected: true,
  },
  "inference-net": {
    id: "inference-net",
    alias: "inet",
    name: "Inference.net",
    icon: "dns",
    color: "#2563EB",
    textIcon: "IN",
    website: "https://inference.net",
    hasFree: true,
    freeNote: "$25 free credits on signup plus research grants available",
    rateLimitProtected: true,
  },
  nanogpt: {
    id: "nanogpt",
    alias: "nanogpt",
    name: "NanoGPT",
    icon: "chat",
    color: "#4F46E5",
    textIcon: "NG",
    website: "https://nano-gpt.com",
    rateLimitProtected: true,
  },
  predibase: {
    id: "predibase",
    alias: "predibase",
    name: "Predibase",
    icon: "deployed_code_history",
    color: "#0F766E",
    textIcon: "PB",
    website: "https://predibase.com",
    hasFree: false,
    freeNote: "$25 free trial credits (30-day validity)",
    subscriptionRisk: true,
    riskNoticeVariant: "deprecated",
    deprecated: true,
    deprecationReason:
      "serving.app.predibase.com no longer resolves (sweep 2026-06-19); the managed serving API appears discontinued.",
    rateLimitProtected: true,
  },
  bytez: {
    id: "bytez",
    alias: "bytez",
    name: "Bytez",
    icon: "api",
    color: "#6366F1",
    textIcon: "BZ",
    website: "https://bytez.com",
    hasFree: true,
    freeNote: "$1 free credits, refreshes every 4 weeks",
    rateLimitProtected: true,
  },
  aimlapi: {
    id: "aimlapi",
    alias: "aiml",
    name: "AI/ML API",
    icon: "hub",
    color: "#6366F1",
    textIcon: "AI",
    website: "https://aimlapi.com",
    hasFree: false,
    freeNote:
      "Free tier paused (2026) — AI/ML API is now pay-as-you-go only (min $20 top-up); no recurring free credits.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  novita: {
    id: "novita",
    alias: "novita",
    name: "Novita AI",
    icon: "auto_awesome",
    color: "#FF4081",
    textIcon: "NV",
    website: "https://novita.ai",
    hasFree: true,
    freeNote: "$0.50 trial credits on signup (valid about 1 year)",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  piapi: {
    id: "piapi",
    alias: "pi",
    name: "PiAPI",
    icon: "api",
    color: "#7C4DFF",
    textIcon: "PI",
    website: "https://piapi.ai",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  getgoapi: {
    id: "getgoapi",
    alias: "ggo",
    name: "GoAPI",
    icon: "rocket_launch",
    color: "#FF6D00",
    textIcon: "GO",
    website: "https://api.getgoapi.com",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  laozhang: {
    id: "laozhang",
    alias: "lz",
    name: "LaoZhang AI",
    icon: "hub",
    color: "#FF1744",
    textIcon: "LZ",
    website: "https://api.laozhang.ai",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  glhf: {
    id: "glhf",
    alias: "glhf",
    name: "GLHF Chat",
    icon: "hub",
    color: "#10B981",
    textIcon: "GH",
    website: "https://glhf.chat",
    authHint: "Bearer API key for the GLHF OpenAI-compatible gateway.",
    hasFree: false,
    freeNote: "Discontinued 2026 — glhf.chat free beta ended; no free tier.",
    passthroughModels: true,
    subscriptionRisk: true,
    riskNoticeVariant: "deprecated",
    deprecated: true,
    deprecationReason:
      "glhf.chat shut down (2026); its api.laf.run gateway no longer serves the catalog (sweep 2026-06-19).",
    rateLimitProtected: true,
  },
  cablyai: {
    id: "cablyai",
    alias: "cablyai",
    name: "CablyAI",
    icon: "hub",
    color: "#FF4081",
    textIcon: "CA",
    website: "https://cablyai.com",
    authHint: "Bearer API key for the CablyAI OpenAI-compatible gateway.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  thebai: {
    id: "thebai",
    alias: "thebai",
    name: "TheB.AI",
    icon: "hub",
    color: "#3B82F6",
    textIcon: "TB",
    website: "https://theb.ai",
    authHint: "Bearer API key for the TheB.AI OpenAI-compatible gateway.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  fenayai: {
    id: "fenayai",
    alias: "fenayai",
    name: "FenayAI",
    icon: "hub",
    color: "#FF9800",
    textIcon: "FN",
    website: "https://fenayai.com",
    authHint: "Bearer API key for the FenayAI OpenAI-compatible gateway.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  empower: {
    id: "empower",
    alias: "empower",
    name: "Empower",
    icon: "hub",
    color: "#14B8A6",
    textIcon: "EM",
    website: "https://docs.empower.dev",
    authHint: "Bearer API key for the Empower OpenAI-compatible endpoint.",
    apiHint:
      "Empower exposes OpenAI-compatible chat on https://app.empower.dev/api/v1 with tool-calling support on empower-functions.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  "nous-research": {
    id: "nous-research",
    alias: "nous",
    name: "Nous Research",
    icon: "hub",
    color: "#2563EB",
    textIcon: "NO",
    website: "https://portal.nousresearch.com/help",
    authHint:
      "Use your Nous Portal API key. OmniRoute targets the official OpenAI-compatible inference endpoint at https://inference-api.nousresearch.com/v1.",
    apiHint:
      "Nous exposes an OpenAI-compatible /v1 surface with a large remote /models catalog. The /chat/completions endpoint requires a valid API key for programmatic inference.",
    hasFree: true,
    freeNote: "Free tier: 50 RPM, 500,000 TPM — no credit card",
    rateLimitProtected: true,
  },
  poe: {
    id: "poe",
    alias: "poe",
    name: "Poe",
    icon: "hub",
    color: "#F97316",
    textIcon: "PO",
    website: "https://creator.poe.com/api-reference",
    authHint: "Bearer API key for the Poe OpenAI-compatible API.",
    apiHint:
      "Poe exposes OpenAI-compatible chat and responses on https://api.poe.com/v1, with authenticated balance checks on /usage/current_balance.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  gitlab: {
    id: "gitlab",
    alias: "gitlab",
    name: "GitLab Duo PAT",
    icon: "hub",
    color: "#FC6D26",
    textIcon: "GL",
    website: "https://docs.gitlab.com/user/duo_agent_platform/code_suggestions/",
    authHint:
      "GitLab personal access token for the public Code Suggestions API. Configure a self-hosted base URL when not using gitlab.com.",
    rateLimitProtected: true,
  },
  chutes: {
    id: "chutes",
    alias: "chutes",
    name: "Chutes.ai",
    icon: "hub",
    color: "#06B6D4",
    textIcon: "CH",
    website: "https://chutes.ai",
    hasFree: false,
    freeNote: "No free tier as of 2026 — Chutes moved to pay-as-you-go (free Early Access ended 2026-03).",
    authHint: "Bearer API key for the Chutes OpenAI-compatible gateway.",
    passthroughModels: true,
    rateLimitProtected: true,
  },
  "voyage-ai": {
    id: "voyage-ai",
    alias: "voyage",
    name: "Voyage AI",
    icon: "blur_on",
    color: "#0F766E",
    textIcon: "VA",
    website: "https://www.voyageai.com",
    authHint: "Bearer API key for Voyage AI embeddings and rerank APIs.",
    hasFree: true,
    freeNote: "200M free tokens for embeddings and reranking",
    rateLimitProtected: true,
  },
  "jina-ai": {
    id: "jina-ai",
    alias: "jina",
    name: "Jina AI",
    icon: "sort",
    color: "#2563EB",
    textIcon: "JA",
    website: "https://jina.ai",
    authHint: "Bearer API key for the Jina AI rerank API.",
    hasFree: true,
    freeNote: "10M free tokens on signup (non-commercial), no credit card required",
    rateLimitProtected: true,
  },
  "fal-ai": {
    id: "fal-ai",
    alias: "fal",
    name: "Fal.ai",
    icon: "image",
    color: "#2563EB",
    textIcon: "FL",
    website: "https://fal.ai",
    rateLimitProtected: true,
  },
  "stability-ai": {
    id: "stability-ai",
    alias: "stability",
    name: "Stability AI",
    icon: "image",
    color: "#8B5CF6",
    textIcon: "SA",
    website: "https://stability.ai",
    rateLimitProtected: true,
  },
  "black-forest-labs": {
    id: "black-forest-labs",
    alias: "bfl",
    name: "Black Forest Labs",
    icon: "image",
    color: "#111827",
    textIcon: "BF",
    website: "https://blackforestlabs.ai",
    rateLimitProtected: true,
  },
  recraft: {
    id: "recraft",
    alias: "recraft",
    name: "Recraft",
    icon: "image",
    color: "#EC4899",
    textIcon: "RC",
    website: "https://recraft.ai",
    rateLimitProtected: true,
  },
  topaz: {
    id: "topaz",
    alias: "topaz",
    name: "Topaz",
    icon: "image",
    color: "#059669",
    textIcon: "TP",
    website: "https://topazlabs.com",
    rateLimitProtected: true,
  },
  baidu: {
    id: "baidu",
    alias: "baidu",
    name: "Baidu (ERNIE)",
    icon: "auto_awesome",
    color: "#2932E1",
    textIcon: "BD",
    website: "https://yiyan.baidu.com",
    hasFree: true,
    freeNote: "Free ERNIE Speed/Lite models. China's #2 LLM.",
    passthroughModels: true,
    authHint: "Get API key at console.bce.baidu.com",
    rateLimitProtected: true,
  },
  tencent: {
    id: "tencent",
    alias: "tencent",
    name: "Tencent Hunyuan",
    icon: "auto_awesome",
    color: "#07C160",
    textIcon: "TC",
    website: "https://hunyuan.tencent.com",
    hasFree: true,
    freeNote: "Free Hunyuan Lite models. WeChat ecosystem.",
    passthroughModels: true,
    authHint: "Get API key at console.cloud.tencent.com",
    rateLimitProtected: true,
  },
  iflytek: {
    id: "iflytek",
    alias: "iflytek",
    name: "iFlytek Spark",
    icon: "auto_awesome",
    color: "#0066FF",
    textIcon: "IF",
    website: "https://xinghuo.xfyun.cn",
    hasFree: true,
    freeNote: "Spark Lite is free (2 QPS rate-limited), but iFlytek ToS §2.4(3) prohibits programmatic extraction and requires Chinese real-name auth — use with caution.",
    passthroughModels: true,
    authHint: "Get API key at console.xfyun.cn",
    rateLimitProtected: true,
  },
  baichuan: {
    id: "baichuan",
    alias: "baichuan",
    name: "Baichuan",
    icon: "auto_awesome",
    color: "#6366F1",
    textIcon: "BC",
    website: "https://baichuan.com",
    hasFree: true,
    freeNote: "Free Baichuan models. Popular Chinese LLM startup.",
    passthroughModels: true,
    authHint: "Get API key at platform.baichuan-ai.com",
    rateLimitProtected: true,
  },
  yi: {
    id: "yi",
    alias: "yi",
    name: "Yi (01.AI)",
    icon: "auto_awesome",
    color: "#10B981",
    textIcon: "YI",
    website: "https://01.ai",
    hasFree: false,
    freeNote: "No free API tier (2026) — Yi-Light retired; platform.01.ai is pay-as-you-go (Yi-Lightning paid). Open weights are download-only.",
    passthroughModels: true,
    authHint: "Get API key at platform.lingyiwanwu.com",
    rateLimitProtected: true,
  },
  stepfun: {
    id: "stepfun",
    alias: "stepfun",
    name: "StepFun",
    icon: "auto_awesome",
    color: "#8B5CF6",
    textIcon: "SF",
    website: "https://stepfun.com",
    hasFree: true,
    freeNote: "Free Step-2 models. Chinese AI company.",
    passthroughModels: true,
    authHint: "Get API key at platform.stepfun.com",
    rateLimitProtected: true,
  },
  coze: {
    id: "coze",
    alias: "coze",
    name: "Coze",
    icon: "smart_toy",
    color: "#3B82F6",
    textIcon: "CZ",
    website: "https://coze.com",
    hasFree: true,
    freeNote: "Free ByteDance agent platform. Bot building + LLM access.",
    passthroughModels: true,
    authHint: "Get API key at coze.com/open/api",
    rateLimitProtected: true,
  },
  "360ai": {
    id: "360ai",
    alias: "360ai",
    name: "360 AI",
    icon: "auto_awesome",
    color: "#00B96B",
    textIcon: "360",
    website: "https://ai.360.cn",
    hasFree: true,
    freeNote: "Free 360 AI Brain models. Major Chinese security company.",
    passthroughModels: true,
    authHint: "Get API key at ai.360.cn",
    rateLimitProtected: true,
  },
  doubao: {
    id: "doubao",
    alias: "doubao",
    name: "Doubao",
    icon: "auto_awesome",
    color: "#FE2C55",
    textIcon: "DB",
    website: "https://doubao.com",
    hasFree: true,
    freeNote: "Free Doubao models. ByteDance's chatbot.",
    passthroughModels: true,
    authHint: "Get API key at console.volcengine.com",
    rateLimitProtected: true,
  },
  sensenova: {
    id: "sensenova",
    alias: "sensenova",
    name: "SenseNova",
    icon: "auto_awesome",
    color: "#0066FF",
    textIcon: "SN",
    website: "https://platform.sensenova.cn",
    hasFree: true,
    freeNote: "Free SenseTime models. Computer vision leader.",
    passthroughModels: true,
    authHint: "Get API key at platform.sensenova.cn",
    rateLimitProtected: true,
  },
  sparkdesk: {
    id: "sparkdesk",
    alias: "sparkdesk",
    name: "SparkDesk",
    icon: "auto_awesome",
    color: "#0066FF",
    textIcon: "SD",
    website: "https://xinghuo.xfyun.cn",
    hasFree: true,
    freeNote: "Spark Lite free (alias for iflytek), but ToS restricts to personal/non-commercial use and prohibits relaying access to third parties — use with caution.",
    passthroughModels: true,
    authHint: "Get API key at console.xfyun.cn",
    rateLimitProtected: true,
  },
  phind: {
    id: "phind",
    alias: "phind",
    name: "Phind",
    icon: "search",
    color: "#EC4899",
    textIcon: "PH",
    website: "https://phind.com",
    hasFree: false,
    freeNote: "Discontinued 2026 — phind.com shut down (2026-01); no free tier.",
    passthroughModels: true,
    authHint: "Get API key at phind.com",
    rateLimitProtected: true,
  },
  huggingchat: {
    id: "huggingchat",
    alias: "huggingchat",
    name: "HuggingChat",
    icon: "chat",
    color: "#FFD21E",
    textIcon: "HC",
    website: "https://huggingface.co/chat",
    hasFree: true,
    freeNote: "Free chat with open models (Llama, Mistral, etc.).",
    passthroughModels: true,
    authHint: "No API key required for basic access.",
    rateLimitProtected: true,
  },
  dify: {
    id: "dify",
    alias: "dify",
    name: "Dify",
    icon: "smart_toy",
    color: "#6366F1",
    textIcon: "DF",
    website: "https://dify.ai",
    hasFree: true,
    freeNote: "Free open-source AI app builder + RAG platform.",
    passthroughModels: true,
    authHint: "Get API key from your Dify instance.",
    rateLimitProtected: true,
  },
  "arcee-ai": {
    id: "arcee-ai",
    alias: "arcee",
    name: "Arcee AI",
    icon: "auto_awesome",
    color: "#8B5CF6",
    textIcon: "AR",
    website: "https://arcee.ai",
    hasFree: true,
    freeNote: "Free Trinity Large Thinking model (262K context). No credit card required.",
    passthroughModels: true,
    authHint: "Get API key at arcee.ai",
    rateLimitProtected: true,
  },
  inclusionai: {
    id: "inclusionai",
    alias: "inclusion",
    name: "InclusionAI",
    icon: "psychology",
    color: "#10B981",
    textIcon: "IA",
    website: "https://inclusionai.com",
    hasFree: true,
    freeNote: "Free Ling-2.6-flash model (1T-param MoE, 262K context). No credit card required.",
    passthroughModels: true,
    authHint: "Get API key at inclusionai.com",
    subscriptionRisk: true,
    riskNoticeVariant: "deprecated",
    deprecated: true,
    deprecationReason:
      "api.inclusionai.tech no longer resolves (sweep 2026-06-19); the inference API appears discontinued.",
    rateLimitProtected: true,
  },
  liquid: {
    id: "liquid",
    alias: "liquid",
    name: "Liquid AI",
    icon: "water_drop",
    color: "#06B6D4",
    textIcon: "LQ",
    website: "https://liquid.ai",
    hasFree: true,
    freeNote:
      "Free LFM2.5-1.2B-Thinking and LFM2.5-1.2B-Instruct models. MIT spinoff, hybrid architecture.",
    passthroughModels: true,
    authHint: "Get API key at liquid.ai",
    rateLimitProtected: true,
  },
  nomic: {
    id: "nomic",
    alias: "nomic",
    name: "Nomic",
    icon: "hub",
    color: "#7C3AED",
    textIcon: "NM",
    website: "https://nomic.ai",
    hasFree: true,
    freeNote: "Free Nomic Embed API. Open-source embeddings, no credit card required.",
    passthroughModels: true,
    authHint: "Get API key at atlas.nomic.ai",
    rateLimitProtected: true,
  },
  monsterapi: {
    id: "monsterapi",
    alias: "monster",
    name: "MonsterAPI",
    icon: "cloud",
    color: "#EF4444",
    textIcon: "MA",
    website: "https://monsterapi.ai",
    hasFree: true,
    freeNote: "One-time signup trial credits for decentralized GPU inference (no recurring free plan). No credit card required.",
    passthroughModels: true,
    authHint: "Get API key at monsterapi.ai",
    rateLimitProtected: true,
  },
  // ── Web Fetch Providers ─────────────────────────────────────────────────────
  firecrawl: {
    id: "firecrawl",
    alias: "fc",
    name: "Firecrawl",
    icon: "language",
    color: "#FB923C",
    textIcon: "FC",
    website: "https://firecrawl.dev",
    hasFree: true,
    notice: {
      text: "Free tier: 500 fetches/month, no credit card needed.",
      apiKeyUrl: "https://firecrawl.dev/app/api-keys",
    },
    serviceKinds: ["webFetch"],
    rateLimitProtected: true,
  },
  "jina-reader": {
    id: "jina-reader",
    alias: "jr",
    name: "Jina Reader",
    icon: "menu_book",
    color: "#0EA5E9",
    textIcon: "JR",
    website: "https://jina.ai/reader",
    hasFree: true,
    notice: {
      text: "Free tier: 1M fetches/month.",
      apiKeyUrl: "https://jina.ai/api-dashboard",
    },
    serviceKinds: ["webFetch"],
    rateLimitProtected: true,
  },
  byteplus: {
    id: "byteplus",
    alias: "bpm",
    name: "BytePlus ModelArk",
    icon: "cloud",
    color: "#2563EB",
    textIcon: "BP",
    website: "https://console.byteplus.com/ark",
    hasFree: true,
    notice: {
      text: "Free credits for new accounts. Seed 2.0, Kimi K2 Thinking, GLM 4.7, GPT-OSS-120B available.",
      apiKeyUrl: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey",
    },
    serviceKinds: ["llm"],
    rateLimitProtected: true,
  },
  bluesminds: {
    id: "bluesminds",
    alias: "bm",
    name: "BluesMinds",
    icon: "psychology",
    color: "#3B82F6",
    textIcon: "BM",
    website: "https://www.bluesminds.com",
    hasFree: true,
    freeNote:
      "Free daily pi credits — supports 200+ models including GPT-4o, GPT-4.1, Claude Sonnet 4.5, Gemini 2.0 Flash, DeepSeek V4, Qwen, Kimi K2",
    apiHint:
      "Get your API key at https://www.bluesminds.com — OpenAI-compatible endpoint at https://api.bluesminds.com/v1 with free daily credits. VIP models (Claude Opus 4.5, Gemini 2.5 Pro) consume pi credits.",
    rateLimitProtected: true,
  },
  "freemodel-dev": {
    id: "freemodel-dev",
    alias: "fmd",
    name: "FreeModel.dev",
    icon: "auto_awesome",
    color: "#8B5CF6",
    textIcon: "FM",
    website: "https://freemodel.dev",
    hasFree: true,
    freeNote:
      "$300 free credits on signup — no credit card required. Access GPT-5.4 and GPT-5.5 (OpenAI's latest flagship models) through an OpenAI-compatible API.",
    apiHint:
      "Get $300 free API credits at https://freemodel.dev — no payment info required. OpenAI-compatible endpoint. GPT-5.4 and GPT-5.5 models available.",
    rateLimitProtected: true,
  },
  freeaiapikey: {
    id: "freeaiapikey",
    alias: "faik",
    name: "FreeAIAPIKey",
    icon: "vpn_key",
    color: "#F59E0B",
    textIcon: "FK",
    website: "https://freeaiapikey.com",
    apiHint:
      "Discounted API proxy for 40+ models including GPT-5, Claude Opus 4.6, Claude Sonnet 4.6, Qwen 3.5. Get your API key at https://freeaiapikey.com/dashboard. Base URL: https://freeaiapikey.com/v1.",
    rateLimitProtected: true,
  },
  zenmux: {
    id: "zenmux",
    alias: "zm",
    name: "ZenMux",
    icon: "neurology",
    color: "#7C3AED",
    textIcon: "ZM",
    website: "https://zenmux.ai",
    hasFree: true,
    freeNote:
      "Free tier includes access to Gemini 3 Flash, DeepSeek V3.2, Grok 4.1 Fast, Mistral Large, and more. Get your API key at https://zenmux.ai.",
    authHint:
      "Use your ZenMux API key in Authorization: Bearer <key>. ZenMux is fully OpenAI-compatible. Base URL: https://zenmux.ai/api/v1.",
    apiHint:
      "ZenMux exposes an OpenAI-compatible chat completions endpoint at /api/v1/chat/completions, plus Anthropic Messages (/api/anthropic/v1/messages) and Google Gemini (/api/vertex-ai) protocol surfaces. OmniRoute uses the OpenAI protocol.",
    rateLimitProtected: true,
  },
  openadapter: {
    id: "openadapter",
    alias: "oad",
    name: "OpenAdapter",
    icon: "hub",
    color: "#10B981",
    textIcon: "OD",
    website: "https://openadapter.dev",
    hasFree: true,
    freeNote:
      "Free tier with a generous quota and no credit card — 15+ open-source models with daily quota. Get your API key at https://dashboard.openadapter.in.",
    authHint:
      "Use your OpenAdapter API key in Authorization: Bearer sk-cv-<key>. Fully OpenAI-compatible. API base URL: https://api.openadapter.in/v1.",
    apiHint:
      "OpenAdapter exposes an OpenAI-compatible chat completions endpoint at https://api.openadapter.in/v1/chat/completions, aggregating 70+ open-source models (DeepSeek, Qwen, Kimi, MiniMax, GLM, Llama, Mistral, …). OmniRoute uses the OpenAI protocol.",
    rateLimitProtected: true,
  },
  dit: {
    id: "dit",
    alias: "dai",
    name: "DIT.ai",
    icon: "hub",
    color: "#0EA5E9",
    textIcon: "DT",
    website: "https://dit.ai",
    authHint:
      "Use your dit.ai API key in Authorization: Bearer <key>. Fully OpenAI-compatible — a drop-in replacement, just change the base URL to https://api.dit.ai/v1.",
    apiHint:
      "dit.ai (Distributed Intelligence Trade) is an OpenAI-compatible router/gateway with dynamic per-request pricing, exposing /v1/chat/completions at https://api.dit.ai/v1. OmniRoute uses the OpenAI protocol; spend/savings analytics live in the dit.ai dashboard.",
    rateLimitProtected: true,
  },
  tokenrouter: {
    id: "tokenrouter",
    alias: "trk",
    name: "TokenRouter",
    icon: "hub",
    color: "#F59E0B",
    textIcon: "TK",
    website: "https://tokenrouter.com",
    hasFree: true,
    freeNote: "Free tier includes the MiniMax 3 model. Get your API key at https://tokenrouter.com.",
    authHint:
      "Use your TokenRouter API key in Authorization: Bearer <key>. Fully OpenAI-compatible. API base URL: https://api.tokenrouter.com/v1.",
    apiHint:
      "TokenRouter exposes an OpenAI-compatible chat completions endpoint at https://api.tokenrouter.com/v1/chat/completions, plus a working /v1/models catalog. OmniRoute uses the OpenAI protocol.",
    rateLimitProtected: true,
  },
};

// Sub-categories within APIKEY_PROVIDERS (used by dashboard and catalog views).
export const IMAGE_ONLY_PROVIDER_IDS = new Set([
  "nanobanana",
  "fal-ai",
  "stability-ai",
  "black-forest-labs",
  "recraft",
  "topaz",
]);

export const AGGREGATOR_PROVIDER_IDS = new Set([
  "openrouter",
  "synthetic",
  "kilo-gateway",
  "aimlapi",
  "novita",
  "piapi",
  "getgoapi",
  "laozhang",
  "vercel-ai-gateway",
  "agentrouter",
  "glhf",
  "cablyai",
  "thebai",
  "fenayai",
  "empower",
  "poe",
  "chutes",
  "hackclub",
]);

export const ENTERPRISE_CLOUD_PROVIDER_IDS = new Set([
  "azure-openai",
  "azure-ai",
  "bedrock",
  "watsonx",
  "oci",
  "sap",
  "vertex",
  "vertex-partner",
  "databricks",
  "datarobot",
  "clarifai",
  "snowflake",
  "heroku",
  "modal",
]);

export const VIDEO_PROVIDER_IDS = new Set([
  "runwayml",
  "veoaifree-web",
  "pollinations",
  "minimax",
  "together",
  "replicate",
  "haiper",
  "leonardo",
]);

// IDE Providers: editors with built-in AI subscription (separate section in UI).
// These providers live in OAUTH_PROVIDERS but render under "IDE Providers"
// instead of "OAuth Providers" to avoid visual duplication.
export const IDE_PROVIDER_IDS = new Set(["cursor", "zed", "trae"]);

export const EMBEDDING_RERANK_PROVIDER_IDS = new Set(["voyage-ai", "jina-ai"]);

// Local / Self-Hosted Providers

// Search Providers

// Audio Only Providers

export const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
export const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
export const CLAUDE_CODE_COMPATIBLE_PREFIX = "anthropic-compatible-cc-";

export function isOpenAICompatibleProvider(providerId: unknown): providerId is string {
  return typeof providerId === "string" && providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

export function isAnthropicCompatibleProvider(providerId: unknown): providerId is string {
  return typeof providerId === "string" && providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}



export function isClaudeCodeCompatibleProvider(providerId: unknown): providerId is string {
  return typeof providerId === "string" && providerId.startsWith(CLAUDE_CODE_COMPATIBLE_PREFIX);
}

export function isLocalProvider(providerId: unknown): boolean {
  return (
    typeof providerId === "string" &&
    Object.prototype.hasOwnProperty.call(LOCAL_PROVIDERS, providerId)
  );
}

export const SELF_HOSTED_CHAT_PROVIDER_IDS = new Set([
  "lm-studio",
  "vllm",
  "lemonade",
  "llamafile",
  "llama-cpp",
  "triton",
  "docker-model-runner",
  "xinference",
  "oobabooga",
]);

export function isSelfHostedChatProvider(providerId: unknown): boolean {
  return typeof providerId === "string" && SELF_HOSTED_CHAT_PROVIDER_IDS.has(providerId);
}

export function providerAllowsOptionalApiKey(providerId: unknown): boolean {
  return (
    // ponytail: any noAuth provider auto-qualifies — no per-provider maintenance
    (typeof providerId === "string" && providerId in NOAUTH_PROVIDERS) ||
    providerId === "searxng-search" ||
    providerId === "pollinations" ||
    providerId === "copilot-web" ||
    providerId === "hackclub" ||
    providerId === "huggingchat" ||
    providerId === "gitlawb" ||
    providerId === "gitlawb-gmi" ||
    isLocalProvider(providerId) ||
    isSelfHostedChatProvider(providerId) ||
    isOpenAICompatibleProvider(providerId) ||
    isAnthropicCompatibleProvider(providerId)
  );
}

/**
 * Providers explicitly excluded from bulk API key add — auth is heterogeneous,
 * OAuth-based, multi-field, or requires manual setup per connection.
 */
const BULK_API_KEY_EXCLUDED = new Set([
  "vertex",
  "vertex-partner",
  "ollama-local",
  "grok-web",
  "perplexity-web",
  "blackbox-web",
  "muse-spark-web",
  "deepseek-web",
  "inner-ai",
  "qoder",
  "google-pse-search",
  "command-code",
  "azure",
  "cloudflare-ai",
]);

export function supportsBulkApiKey(providerId: unknown): boolean {
  if (typeof providerId !== "string" || !providerId) return false;
  if (BULK_API_KEY_EXCLUDED.has(providerId)) return false;
  if (isLocalProvider(providerId)) return false;
  if (isSelfHostedChatProvider(providerId)) return false;
  if (isClaudeCodeCompatibleProvider(providerId)) return false;
  return true;
}

// ── System Providers (virtual, not user-connectable) ──────────────────────────

const _PROVIDER_SECTIONS = [
  NOAUTH_PROVIDERS,
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  LOCAL_PROVIDERS,
  SEARCH_PROVIDERS,
  AUDIO_ONLY_PROVIDERS,
  UPSTREAM_PROXY_PROVIDERS,
  CLOUD_AGENT_PROVIDERS,
  SYSTEM_PROVIDERS,
] as const;

let _aiProviders: Record<string, any> | null = null;

function getOrCreateAiProviders(): Record<string, any> {
  if (!_aiProviders) {
    _aiProviders = {};
    for (const section of _PROVIDER_SECTIONS) {
      Object.assign(_aiProviders, section);
    }
  }
  return _aiProviders;
}

let _ALIAS_TO_ID: Record<string, string> | null = null;

function getOrCreateAliasToId(): Record<string, string> {
  if (!_ALIAS_TO_ID) {
    _ALIAS_TO_ID = {};
    for (const section of _PROVIDER_SECTIONS) {
      for (const p of Object.values(section)) {
        if ((p as any).alias) _ALIAS_TO_ID[(p as any).alias] = (p as any).id;
      }
    }
  }
  return _ALIAS_TO_ID;
}

let _ID_TO_ALIAS: Record<string, string> | null = null;

function getOrCreateIdToAlias(): Record<string, string> {
  if (!_ID_TO_ALIAS) {
    _ID_TO_ALIAS = {};
    for (const section of _PROVIDER_SECTIONS) {
      for (const p of Object.values(section)) {
        _ID_TO_ALIAS[(p as any).id] = (p as any).alias || (p as any).id;
      }
    }
  }
  return _ID_TO_ALIAS;
}

export function getProviderById(id: string) {
  return (
    (NOAUTH_PROVIDERS as Record<string, any>)[id] ??
    (OAUTH_PROVIDERS as Record<string, any>)[id] ??
    (APIKEY_PROVIDERS as Record<string, any>)[id] ??
    (WEB_COOKIE_PROVIDERS as Record<string, any>)[id] ??
    (LOCAL_PROVIDERS as Record<string, any>)[id] ??
    (SEARCH_PROVIDERS as Record<string, any>)[id] ??
    (AUDIO_ONLY_PROVIDERS as Record<string, any>)[id] ??
    (UPSTREAM_PROXY_PROVIDERS as Record<string, any>)[id] ??
    (CLOUD_AGENT_PROVIDERS as Record<string, any>)[id] ??
    (SYSTEM_PROVIDERS as Record<string, any>)[id] ??
    undefined
  );
}

export const AI_PROVIDERS = new Proxy({} as Record<string, any>, {
  get(_, key) {
    if (key === "then") return undefined;
    return typeof key === "string" ? getOrCreateAiProviders()[key] : undefined;
  },
  ownKeys() {
    return Reflect.ownKeys(getOrCreateAiProviders());
  },
  has(_, key) {
    return key in getOrCreateAiProviders();
  },
  getOwnPropertyDescriptor(_, key) {
    const obj = getOrCreateAiProviders();
    if (typeof key === "string" && key in obj) {
      return { configurable: true, enumerable: true, value: obj[key] };
    }
    return undefined;
  },
});

export type AiProviderId =
  | keyof typeof NOAUTH_PROVIDERS
  | keyof typeof OAUTH_PROVIDERS
  | keyof typeof APIKEY_PROVIDERS
  | keyof typeof WEB_COOKIE_PROVIDERS
  | keyof typeof LOCAL_PROVIDERS
  | keyof typeof SEARCH_PROVIDERS
  | keyof typeof AUDIO_ONLY_PROVIDERS
  | keyof typeof UPSTREAM_PROXY_PROVIDERS
  | keyof typeof CLOUD_AGENT_PROVIDERS
  | keyof typeof SYSTEM_PROVIDERS;

export type AiProviderDefinition =
  | (typeof NOAUTH_PROVIDERS)[keyof typeof NOAUTH_PROVIDERS]
  | (typeof OAUTH_PROVIDERS)[keyof typeof OAUTH_PROVIDERS]
  | (typeof APIKEY_PROVIDERS)[keyof typeof APIKEY_PROVIDERS]
  | (typeof WEB_COOKIE_PROVIDERS)[keyof typeof WEB_COOKIE_PROVIDERS]
  | (typeof LOCAL_PROVIDERS)[keyof typeof LOCAL_PROVIDERS]
  | (typeof SEARCH_PROVIDERS)[keyof typeof SEARCH_PROVIDERS]
  | (typeof AUDIO_ONLY_PROVIDERS)[keyof typeof AUDIO_ONLY_PROVIDERS]
  | (typeof UPSTREAM_PROXY_PROVIDERS)[keyof typeof UPSTREAM_PROXY_PROVIDERS]
  | (typeof CLOUD_AGENT_PROVIDERS)[keyof typeof CLOUD_AGENT_PROVIDERS]
  | (typeof SYSTEM_PROVIDERS)[keyof typeof SYSTEM_PROVIDERS];

// Auth methods
export const AUTH_METHODS = {
  oauth: { id: "oauth", name: "OAuth", icon: "lock" },
  apikey: { id: "apikey", name: "API Key", icon: "key" },
};

export function getProviderByAlias(alias: string): AiProviderDefinition | null {
  for (const section of _PROVIDER_SECTIONS) {
    for (const provider of Object.values(section)) {
      if (provider.alias === alias || provider.id === alias) {
        return provider as AiProviderDefinition;
      }
    }
  }
  return null;
}

// Helper: Get provider ID from alias
export function resolveProviderId(aliasOrId: string): string {
  const provider = getProviderByAlias(aliasOrId);
  return provider?.id || aliasOrId;
}

export function getProviderAlias(providerId: string): string {
  const provider = getProviderById(providerId);
  return provider?.alias || providerId;
}

export const ALIAS_TO_ID = new Proxy({} as Record<string, string>, {
  get(_, key) {
    return typeof key === "string" ? getOrCreateAliasToId()[key] : undefined;
  },
  ownKeys() {
    return Reflect.ownKeys(getOrCreateAliasToId());
  },
  has(_, key) {
    return key in getOrCreateAliasToId();
  },
  getOwnPropertyDescriptor(_, key) {
    const obj = getOrCreateAliasToId();
    if (typeof key === "string" && key in obj) {
      return { configurable: true, enumerable: true, value: obj[key] };
    }
    return undefined;
  },
});

export const ID_TO_ALIAS = new Proxy({} as Record<string, string>, {
  get(_, key) {
    return typeof key === "string" ? getOrCreateIdToAlias()[key] : undefined;
  },
  ownKeys() {
    return Reflect.ownKeys(getOrCreateIdToAlias());
  },
  has(_, key) {
    return key in getOrCreateIdToAlias();
  },
  getOwnPropertyDescriptor(_, key) {
    const obj = getOrCreateIdToAlias();
    if (typeof key === "string" && key in obj) {
      return { configurable: true, enumerable: true, value: obj[key] };
    }
    return undefined;
  },
});

// Providers that support usage/quota API
export const USAGE_SUPPORTED_PROVIDERS = [
  "antigravity",
  "agy",
  "gemini-cli",
  "kiro",
  "amazon-q",
  "github",
  "codex",
  "claude",
  "cursor",
  "kimi-coding",
  "kimi-coding-apikey",
  "glm",
  "glm-cn",
  "zai",
  "glmt",
  "opencode-go",
  "ollama-cloud",
  "minimax",
  "minimax-cn",
  "crof",
  "nanogpt",
  "deepseek",
  "xiaomi-mimo",
  "vertex",
  "vertex-partner",
  "codebuddy-cn",
];

// ── Zod validation at module load (Phase 7.2) ──

// Re-export the extracted data catalogs so external importers of providers.ts are unchanged.
export {
  NOAUTH_PROVIDERS,
  OAUTH_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  APIKEY_PROVIDERS,
  LOCAL_PROVIDERS,
  SEARCH_PROVIDERS,
  AUDIO_ONLY_PROVIDERS,
  UPSTREAM_PROXY_PROVIDERS,
  CLOUD_AGENT_PROVIDERS,
  SYSTEM_PROVIDERS,
};

import { validateProviders } from "../validation/providerSchema";

validateProviders(NOAUTH_PROVIDERS, "NOAUTH_PROVIDERS");
validateProviders(OAUTH_PROVIDERS, "OAUTH_PROVIDERS");
validateProviders(APIKEY_PROVIDERS, "APIKEY_PROVIDERS");
validateProviders(WEB_COOKIE_PROVIDERS, "WEB_COOKIE_PROVIDERS");
validateProviders(LOCAL_PROVIDERS, "LOCAL_PROVIDERS");
validateProviders(SEARCH_PROVIDERS, "SEARCH_PROVIDERS");
validateProviders(AUDIO_ONLY_PROVIDERS, "AUDIO_ONLY_PROVIDERS");
validateProviders(UPSTREAM_PROXY_PROVIDERS, "UPSTREAM_PROXY_PROVIDERS");
validateProviders(CLOUD_AGENT_PROVIDERS, "CLOUD_AGENT_PROVIDERS");
