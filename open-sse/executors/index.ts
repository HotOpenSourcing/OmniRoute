import { AntigravityExecutor } from "./antigravity.ts";
import { GeminiCLIExecutor } from "./gemini-cli.ts";
import { GithubExecutor } from "./github.ts";
import { QoderExecutor } from "./qoder.ts";
import { KiroExecutor } from "./kiro.ts";
import { CodexExecutor } from "./codex.ts";
import { CursorExecutor } from "./cursor.ts";
import { DefaultExecutor } from "./default.ts";
import { PollinationsExecutor } from "./pollinations.ts";
import { CloudflareAIExecutor } from "./cloudflare-ai.ts";
import { OpencodeExecutor } from "./opencode.ts";
import { PuterExecutor } from "./puter.ts";
import { VertexExecutor } from "./vertex.ts";
import { CliproxyapiExecutor } from "./cliproxyapi.ts";
import { PerplexityWebExecutor } from "./perplexity-web.ts";
import { GrokWebExecutor } from "./grok-web.ts";
import { WindsurfExecutor } from "./windsurf.ts";
import { WindsurfLocalExecutor } from "./windsurfLocal.ts";
import { WindsurfHybridExecutor } from "./windsurfHybrid.ts";
import { ChatGptWebExecutor } from "./chatgpt-web.ts";
import { BlackboxWebExecutor } from "./blackbox-web.ts";
import { MuseSparkWebExecutor } from "./muse-spark-web.ts";
import { AzureOpenAIExecutor } from "./azure-openai.ts";
import { GitlabExecutor } from "./gitlab.ts";
import { NlpCloudExecutor } from "./nlpcloud.ts";
import { PetalsExecutor } from "./petals.ts";

const cloudExecutors = {
  antigravity: new AntigravityExecutor(),
  "gemini-cli": new GeminiCLIExecutor(),
  github: new GithubExecutor(),
  qoder: new QoderExecutor(),
  kiro: new KiroExecutor(),
  "amazon-q": new KiroExecutor("amazon-q"),
  codex: new CodexExecutor(),
  cursor: new CursorExecutor(),
  cu: new CursorExecutor(), // Alias for cursor
  windsurf: new WindsurfExecutor(),
  ws: new WindsurfExecutor(),
  "azure-openai": new AzureOpenAIExecutor(),
  gitlab: new GitlabExecutor(),
  "gitlab-duo": new GitlabExecutor("gitlab-duo"),
  nlpcloud: new NlpCloudExecutor(),
  petals: new PetalsExecutor(),
  pollinations: new PollinationsExecutor(),
  pol: new PollinationsExecutor(),
  "cloudflare-ai": new CloudflareAIExecutor(),
  cf: new CloudflareAIExecutor(),
  "opencode-zen": new OpencodeExecutor("opencode-zen"),
  "opencode-go": new OpencodeExecutor("opencode-go"),
  puter: new PuterExecutor(),
  pu: new PuterExecutor(),
  vertex: new VertexExecutor(),
  "vertex-partner": new VertexExecutor(),
  cliproxyapi: new CliproxyapiExecutor(),
  cpa: new CliproxyapiExecutor(),
  "perplexity-web": new PerplexityWebExecutor(),
  "pplx-web": new PerplexityWebExecutor(),
  "grok-web": new GrokWebExecutor(),
  "chatgpt-web": new ChatGptWebExecutor(),
  "cgpt-web": new ChatGptWebExecutor(), // Alias
  "blackbox-web": new BlackboxWebExecutor(),
  "bb-web": new BlackboxWebExecutor(), // Alias
  "muse-spark-web": new MuseSparkWebExecutor(),
  "ms-web": new MuseSparkWebExecutor(), // Alias
};

const localExecutors = {
  windsurf: new WindsurfLocalExecutor(),
};

const hybridExecutors = {
  windsurf: new WindsurfHybridExecutor(),
};

const defaultCache = new Map<string, DefaultExecutor>();

function getDefaultExecutor(provider: string) {
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider)!;
}

function getExecutorOrThrow<T extends Record<string, unknown>>(
  pool: T,
  provider: string,
  backend: string
) {
  const executor = pool[provider as keyof T];
  if (executor) return executor;
  throw new Error(`No ${backend} executor registered for provider '${provider}'`);
}

export function getExecutor(provider: string) {
  return cloudExecutors[provider as keyof typeof cloudExecutors] || getDefaultExecutor(provider);
}

export function getCloudExecutor(provider: string) {
  return getExecutor(provider);
}

export function getLocalExecutor(provider: string) {
  return getExecutorOrThrow(localExecutors, provider, "local");
}

export function getHybridExecutor(provider: string) {
  return getExecutorOrThrow(hybridExecutors, provider, "hybrid");
}

export function hasSpecializedExecutor(provider: string) {
  return Boolean(
    cloudExecutors[provider as keyof typeof cloudExecutors] ||
    localExecutors[provider as keyof typeof localExecutors] ||
    hybridExecutors[provider as keyof typeof hybridExecutors]
  );
}

export { BaseExecutor } from "./base.ts";
export { AntigravityExecutor } from "./antigravity.ts";
export { GeminiCLIExecutor } from "./gemini-cli.ts";
export { GithubExecutor } from "./github.ts";
export { QoderExecutor } from "./qoder.ts";
export { KiroExecutor } from "./kiro.ts";
export { CodexExecutor } from "./codex.ts";
export { CursorExecutor } from "./cursor.ts";
export { DefaultExecutor } from "./default.ts";
export { PollinationsExecutor } from "./pollinations.ts";
export { CloudflareAIExecutor } from "./cloudflare-ai.ts";
export { OpencodeExecutor } from "./opencode.ts";
export { PuterExecutor } from "./puter.ts";
export { CliproxyapiExecutor } from "./cliproxyapi.ts";
export { VertexExecutor } from "./vertex.ts";
export { PerplexityWebExecutor } from "./perplexity-web.ts";
export { GrokWebExecutor } from "./grok-web.ts";
export { WindsurfExecutor } from "./windsurf.ts";
export { WindsurfLocalExecutor } from "./windsurfLocal.ts";
export { WindsurfHybridExecutor } from "./windsurfHybrid.ts";
export { ChatGptWebExecutor } from "./chatgpt-web.ts";
export { BlackboxWebExecutor } from "./blackbox-web.ts";
export { MuseSparkWebExecutor } from "./muse-spark-web.ts";
export { AzureOpenAIExecutor } from "./azure-openai.ts";
export { GitlabExecutor } from "./gitlab.ts";
export { NlpCloudExecutor } from "./nlpcloud.ts";
export { PetalsExecutor } from "./petals.ts";
