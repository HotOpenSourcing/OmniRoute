import fs from "node:fs";
const files = [
  "C:/Users/amine/OmniRoute/open-sse/handlers/chatCore.ts",
  "C:/Users/amine/OmniRoute/src/sse/handlers/chat.ts",
  "C:/Users/amine/OmniRoute/src/sse/handlers/chatHelpers.ts",
];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const lines = text.split(/\r?\n/);
  console.log("=== " + f);
  for (let i = 0; i < lines.length; i++) {
    if (/cursor|codex|kiro|antigravity|qoder|trae|freebuff/i.test(lines[i])) {
      console.log((i + 1) + ": " + lines[i]);
    }
  }
}
