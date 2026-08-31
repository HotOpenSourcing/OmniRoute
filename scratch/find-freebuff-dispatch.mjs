import fs from "node:fs";
import path from "node:path";

const root = "C:/Users/amine/OmniRoute";
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git" || e.name === "dist" || e.name === ".build") continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
}
const files = [];
walk(root, files);
const matches = [];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  if (/freebuff/i.test(text)) {
    matches.push(f);
  }
}
for (const f of matches) console.log(f);
console.log("TOTAL:", matches.length);
