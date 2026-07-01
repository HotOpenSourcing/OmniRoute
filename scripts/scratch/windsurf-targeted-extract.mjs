import fs from "node:fs";
import path from "node:path";

const ROOT = "C:/Users/amine/OmniRoute";
const evidencePath = path.join(ROOT, "windsurf-model-architecture-evidence.json");
const outPath = path.join(ROOT, "windsurf-model-targeted-evidence.json");
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));

const wantedNeedles = new Set([
  "chat.modelsControl",
  "modelsControl",
  "getCommandModelConfigs",
  "clientModelConfigs",
  "getModelStatuses",
  "modelStatusInfos",
  "availableModels",
  "GetChatMessage",
  "ApiServerService",
  "exa.api_server_pb.ApiServerService",
  "SeatManagementService",
  "exa.seat_management_pb.SeatManagementService",
  "GetUserStatus",
  "fetchSelfDevinSessionToken",
  "GetUserJwt",
  "AuthService",
  "model_uid",
  "modelUid",
  "model_id",
]);

function compactSnippet(snippet) {
  return snippet
    .replace(/\s+/g, " ")
    .replace(/devin-session-token\$[A-Za-z0-9._-]+/g, "devin-session-token$...[redacted]")
    .slice(0, 1600);
}

const focused = [];
for (const scan of evidence.staticScan) {
  const base = scan.filePath.replace(/\\/g, "/");
  for (const match of scan.matches || []) {
    if (!wantedNeedles.has(match.needle)) continue;
    const snippet = match.snippet || "";
    const isImportant =
      /modelsControl|set\(|store\(|update\(|getCommandModelConfigs|clientModelConfigs|getModelStatuses|modelStatusInfos|GetChatMessageRequest|ApiServerService=|SeatManagementService=|GetUserStatusRequest|GetUserStatusResponse|fetchSelfDevinSessionToken|AuthService|GetUserJwt|ClientModelConfig|ModelInfo|ModelStatusInfo|TeamOrganizationalControls|model_uid/.test(snippet);
    if (!isImportant) continue;
    focused.push({
      file: base,
      needle: match.needle,
      line: match.line,
      offset: match.offset,
      snippet: compactSnippet(snippet),
    });
  }
}

const state = evidence.stateDb;
const modelsControlRaw = state.modelsControl?.preview || "";
const parsedModelsControl = JSON.parse(modelsControlRaw);
const modelCacheRows = [];
for (const tier of Object.keys(parsedModelsControl)) {
  for (const model of Object.values(parsedModelsControl[tier])) {
    modelCacheRows.push({ tier, ...model });
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  stateDb: {
    path: state.dbPath,
    keyCount: state.matchingKeyCount,
    modelsControl: {
      topLevelKeys: state.modelsControl?.topLevelKeys || [],
      rows: modelCacheRows,
    },
  },
  focused,
};
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ outPath, focusedCount: focused.length, modelCacheRows }, null, 2));
