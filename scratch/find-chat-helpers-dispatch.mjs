import fs from "node:fs";
const f = "C:/Users/amine/OmniRoute/src/sse/handlers/chatHelpers.ts";
const text = fs.readFileSync(f, "utf8");
const lines = text.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  if (/freebuff|routeFreebuffChat|provider === "freebuff"|provider === "codex"|provider === "cursor"|provider === "kiro"|provider === "antigravity"|provider === "qoder"|provider === "trae"/i.test(lines[i])) {
    console.log((i + 1) + ": " + lines[i]);
  }
}
