import fs from "node:fs";
import path from "node:path";

const root = "C:/Users/amine/OmniRoute";
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git" || e.name === "dist" || e.name === ".build" || e.name === ".kimchi") continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
}
const files = [];
walk(root, files);
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  if (/routeFreebuffChat/.test(text)) {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (/routeFreebuffChat/.test(lines[i])) {
        console.log(f + ":" + (i + 1) + ": " + lines[i]);
      }
    }
  }
}
