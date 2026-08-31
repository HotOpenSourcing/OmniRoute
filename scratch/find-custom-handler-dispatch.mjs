import fs from "node:fs";
const files = [
  "C:/Users/amine/OmniRoute/open-sse/handlers/chatCore.ts",
];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/handleCodexChat|handleCursorChat|handleAntigravityChat|handleKiroChat|handleQoderChat|handleTraeChat|routeFreebuffChat|routeCodexChat|routeCursorChat|routeKiroChat|routeAntigravityChat|routeQoderChat|routeTraeChat|customHandler|customChatHandler|provider === "codex"|provider === "cursor"|provider === "kiro"|provider === "antigravity"|provider === "qoder"|provider === "trae"|provider === "freebuff"/i.test(lines[i])) {
      console.log((i + 1) + ": " + lines[i]);
    }
  }
}
