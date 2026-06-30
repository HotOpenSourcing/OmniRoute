// scripts/dump-kimchi-config.mjs
// Quick dump of how Omni sees the Kimchi provider: PROVIDERS.kimchi (legacy shape
// consumed by DefaultExecutor's super() call) and the registry entry.

import { kimchiProvider } from "../open-sse/config/providers/registry/kimchi/index.ts";
import { PROVIDERS } from "../open-sse/config/constants.ts";

console.log("─── Registry entry (kimchi/index.ts) ───");
console.log(JSON.stringify({
  id: kimchiProvider.id,
  baseUrl: kimchiProvider.baseUrl,
  preserveStainlessHeaders: kimchiProvider.preserveStainlessHeaders,
  headers: kimchiProvider.headers,
}, null, 2));

console.log("\n─── PROVIDERS.kimchi (legacy, fed to DefaultExecutor) ───");
console.log(JSON.stringify(PROVIDERS.kimchi, null, 2));

console.log("\n─── Diff: registry headers vs PROVIDERS headers ───");
const registryHeaders = kimchiProvider.headers || {};
const legacyHeaders = PROVIDERS.kimchi?.headers || {};
for (const k of new Set([...Object.keys(registryHeaders), ...Object.keys(legacyHeaders)])) {
  if (registryHeaders[k] !== legacyHeaders[k]) {
    console.log(`  DIFF  ${k}: registry=${JSON.stringify(registryHeaders[k])} legacy=${JSON.stringify(legacyHeaders[k])}`);
  }
}
console.log(`  registry header count: ${Object.keys(registryHeaders).length}`);
console.log(`  legacy header count:   ${Object.keys(legacyHeaders).length}`);

console.log("\n─── PROVIDERS.kimchi.preserveStainlessHeaders ───");
console.log(PROVIDERS.kimchi?.preserveStainlessHeaders);
