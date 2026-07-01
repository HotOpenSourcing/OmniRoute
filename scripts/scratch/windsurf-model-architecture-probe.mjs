import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = "C:/Users/amine/OmniRoute";
const WINDSURF_ROOT = "C:/Users/amine/AppData/Local/Programs/Windsurf/resources/app";
const STATE_DB = "C:/Users/amine/AppData/Roaming/Windsurf/User/globalStorage/state.vscdb";
const OUTPUT = path.join(ROOT, "windsurf-model-architecture-evidence.json");

const targets = [
  path.join(WINDSURF_ROOT, "extensions/windsurf/dist/extension.js"),
  path.join(WINDSURF_ROOT, "node_modules/@exa/chat-client/index.js"),
  path.join(WINDSURF_ROOT, "node_modules/@exa/windsurf-acp/index.js"),
  path.join(WINDSURF_ROOT, "out/vs/workbench/workbench.desktop.main.js"),
  path.join(WINDSURF_ROOT, "out/vs/sessions/sessions.desktop.main.js"),
  path.join(WINDSURF_ROOT, "extensions/windsurf/devin/bin/devin.exe"),
  path.join(ROOT, "open-sse/executors/windsurf.ts"),
  path.join(ROOT, "open-sse/config/windsurfModels.ts"),
  path.join(ROOT, "src/lib/providers/validation.ts"),
  path.join(ROOT, "src/lib/oauth/providers/windsurf.ts"),
];

const needles = [
  "chat.modelsControl",
  "modelsControl",
  "model_uid",
  "modelUid",
  "modelId",
  "model_id",
  "upstreamId",
  "GetChatMessage",
  "ApiServerService",
  "exa.api_server_pb.ApiServerService",
  "SeatManagementService",
  "exa.seat_management_pb.SeatManagementService",
  "GetUserJwt",
  "AuthService",
  "GetUserStatus",
  "getCommandModelConfigs",
  "clientModelConfigs",
  "getModelStatuses",
  "modelStatusInfos",
  "availableModels",
  "fetchSelfDevinSessionToken",
  "X-Api-Key",
  "Authorization",
  "apiServerUrl",
];

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function redactText(text) {
  return String(text)
    .replace(/devin-session-token\$[A-Za-z0-9._-]+/g, "devin-session-token$...[redacted]")
    .replace(/api_key\":\"[^\"]+/g, "api_key\":\"[redacted]")
    .replace(/apiKey\":\"[^\"]+/g, "apiKey\":\"[redacted]")
    .replace(/accessToken\":\"[^\"]+/g, "accessToken\":\"[redacted]")
    .replace(/Authorization\":\"Bearer [^\"]+/g, "Authorization\":\"Bearer [redacted]")
    .replace(/X-Api-Key\",[^\)]{0,240}/g, "X-Api-Key,[redacted]");
}

function summarizeValue(key, raw) {
  const parsed = safeJson(raw);
  const summary = {
    key,
    length: raw.length,
    parsedType: parsed === null ? "raw" : Array.isArray(parsed) ? "array" : typeof parsed,
    topLevelKeys: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 80) : [],
    preview: redactText(raw.slice(0, 500)),
  };

  if (key === "chat.modelsControl" && parsed && typeof parsed === "object") {
    summary.modelsControl = summarizeModelsControl(parsed);
  }
  return summary;
}

function collectModels(value, pathParts = [], out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) collectModels(value[i], [...pathParts, String(i)], out);
    return out;
  }

  const record = value;
  const keys = Object.keys(record);
  const hasModelish = keys.some((key) => /model|uid|status|quota|plan/i.test(key));
  if (hasModelish) {
    const compact = {};
    for (const key of keys) {
      if (/model|uid|name|title|display|status|plan|quota|provider|enabled|available|current|id/i.test(key)) {
        const entry = record[key];
        if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" || entry === null) {
          compact[key] = entry;
        }
      }
    }
    if (Object.keys(compact).length > 0) out.push({ path: pathParts.join("."), ...compact });
  }

  for (const key of keys) {
    const entry = record[key];
    if (entry && typeof entry === "object") collectModels(entry, [...pathParts, key], out);
  }
  return out;
}

function summarizeModelsControl(parsed) {
  const models = collectModels(parsed).slice(0, 200);
  return {
    candidateModelRecords: models,
  };
}

function lineColFromOffset(text, offset) {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastBreak = i;
    }
  }
  return { line, column: offset - lastBreak };
}

function extractAsciiStrings(buffer) {
  return Array.from(buffer.toString("latin1").matchAll(/[ -~]{4,}/g), (match) => match[0]);
}

function scanFile(filePath) {
  if (!fs.existsSync(filePath)) return { filePath, exists: false, matches: [] };
  const stat = fs.statSync(filePath);
  const isBinary = filePath.toLowerCase().endsWith(".exe") || stat.size > 25_000_000;
  const text = isBinary ? extractAsciiStrings(fs.readFileSync(filePath)).join("\n") : fs.readFileSync(filePath, "utf8");
  const matches = [];

  for (const needle of needles) {
    let from = 0;
    let count = 0;
    while (count < 8) {
      const offset = text.indexOf(needle, from);
      if (offset < 0) break;
      const loc = lineColFromOffset(text, offset);
      const start = Math.max(0, offset - 450);
      const end = Math.min(text.length, offset + 900);
      matches.push({
        needle,
        offset,
        line: loc.line,
        column: loc.column,
        snippet: redactText(text.slice(start, end)),
      });
      from = offset + needle.length;
      count++;
    }
  }
  return { filePath, exists: true, size: stat.size, isBinary, matches };
}

function inspectStateDb() {
  const db = new Database(STATE_DB, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        "SELECT key, value FROM ItemTable WHERE key LIKE @m OR key LIKE @M OR key LIKE @c OR key LIKE @C OR key LIKE @s ORDER BY key"
      )
      .all({ m: "%model%", M: "%Model%", c: "%chat%", C: "%Chat%", s: "%seat%" });
    const exactModelsControl = db
      .prepare("SELECT key, value FROM ItemTable WHERE key = ? LIMIT 1")
      .get("chat.modelsControl");
    return {
      dbPath: STATE_DB,
      matchingKeyCount: rows.length,
      keys: rows.map((row) => summarizeValue(row.key, row.value)),
      modelsControl: exactModelsControl ? summarizeValue(exactModelsControl.key, exactModelsControl.value) : null,
    };
  } finally {
    db.close();
  }
}

const evidence = {
  generatedAt: new Date().toISOString(),
  stateDb: inspectStateDb(),
  staticScan: targets.map(scanFile),
};

fs.writeFileSync(OUTPUT, JSON.stringify(evidence, null, 2));

const digest = {
  output: OUTPUT,
  stateKeyCount: evidence.stateDb.matchingKeyCount,
  hasModelsControl: Boolean(evidence.stateDb.modelsControl),
  modelsControlRecords: evidence.stateDb.modelsControl?.modelsControl?.candidateModelRecords?.length || 0,
  staticMatches: evidence.staticScan.map((scan) => ({
    filePath: scan.filePath,
    exists: scan.exists,
    matchCount: scan.matches.length,
    needles: Array.from(new Set(scan.matches.map((match) => match.needle))).slice(0, 40),
  })),
};
console.log(JSON.stringify(digest, null, 2));
