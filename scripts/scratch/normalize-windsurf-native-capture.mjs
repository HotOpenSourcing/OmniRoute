import fs from "node:fs";
import path from "node:path";

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJson(filePath) {
  return JSON.parse(stripBom(fs.readFileSync(filePath, "utf8")));
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function extractTraceEvents(tracePath) {
  if (!fs.existsSync(tracePath)) {
    return { rawEventCount: 0, frameEvents: [], requestEvents: [], mojoEvents: [] };
  }

  const raw = fs.readFileSync(tracePath, "utf8");
  const parsed = JSON.parse(raw);
  const events = Array.isArray(parsed) ? parsed : Array.isArray(parsed.traceEvents) ? parsed.traceEvents : [];

  const frameEvents = [];
  const requestEvents = [];
  const mojoEvents = [];

  for (const event of events) {
    const text = JSON.stringify(event);
    if (/frame_tree_node_id|routing_id|RenderFrame|frameId|loaderId/i.test(text)) {
      frameEvents.push(event);
    }
    if (/URLRequest|URLLoader|request_id|requestId|url_loader_factory|NetLog|HTTP_STREAM_JOB/i.test(text)) {
      requestEvents.push(event);
    }
    if (/mojo|ipc|Interface|message pipe|message_id/i.test(text)) {
      mojoEvents.push(event);
    }
  }

  return {
    rawEventCount: events.length,
    frameEvents,
    requestEvents,
    mojoEvents,
  };
}

function extractNetlog(netlogPath) {
  if (!fs.existsSync(netlogPath)) {
    return { constants: null, events: [], requests: [], sockets: [] };
  }

  const parsed = readJson(netlogPath);
  const events = Array.isArray(parsed.events) ? parsed.events : [];
  const requests = [];
  const sockets = [];

  for (const event of events) {
    const sourceType = event?.source?.type || "UNKNOWN";
    const paramsText = JSON.stringify(event?.params || {});
    if (/URL_REQUEST|HTTP_STREAM_JOB|URL_LOADER/i.test(sourceType) || /request_id|requestId|url_loader_factory/i.test(paramsText)) {
      requests.push(event);
    }
    if (/SOCKET|CONNECT_JOB|SSL_SOCKET|TCP_CONNECT/i.test(sourceType)) {
      sockets.push(event);
    }
  }

  return {
    constants: parsed.constants || null,
    events,
    requests,
    sockets,
  };
}

function buildProcessTable(processSnapshots) {
  const latestByPid = new Map();
  for (const snapshot of processSnapshots) {
    for (const process of snapshot.processes || []) {
      latestByPid.set(process.pid, {
        ...process,
        observedAt: snapshot.timestamp,
      });
    }
  }
  return Array.from(latestByPid.values()).sort((a, b) => a.pid - b.pid);
}

function buildSocketTable(tcpSnapshots, interestingPids) {
  const rows = [];
  for (const snapshot of tcpSnapshots) {
    for (const row of snapshot.rows || []) {
      if (interestingPids.size > 0 && !interestingPids.has(row.owningPid)) continue;
      rows.push({
        observedAt: snapshot.timestamp,
        ...row,
      });
    }
  }
  return rows;
}

function correlate(processes, traceData, netlogData, sockets) {
  const frameHints = traceData.frameEvents.slice(0, 200).map((event) => ({
    pid: event.pid ?? null,
    tid: event.tid ?? null,
    name: event.name ?? null,
    cat: event.cat ?? null,
    args: event.args ?? null,
    ts: event.ts ?? null,
  }));

  const requestHints = netlogData.requests.slice(0, 200).map((event) => ({
    source: event.source ?? null,
    type: event.type ?? null,
    phase: event.phase ?? null,
    params: event.params ?? null,
    time: event.time ?? null,
  }));

  const socketHints = sockets.slice(0, 400).map((row) => ({
    owningPid: row.owningPid,
    localAddress: row.localAddress,
    localPort: row.localPort,
    remoteAddress: row.remoteAddress,
    remotePort: row.remotePort,
    state: row.state,
    observedAt: row.observedAt,
  }));

  const networkService = processes.find((p) => /network\.mojom\.NetworkService/i.test(p.commandLine || "")) || null;
  const nodeServiceCandidates = processes.filter((p) => /node\.mojom\.NodeService/i.test(p.commandLine || ""));
  const nodeService = nodeServiceCandidates.find((p) => /--experimental-network-inspection/i.test(p.commandLine || ""))
    || nodeServiceCandidates[0]
    || null;
  const renderer = processes.find((p) => /--type=renderer/i.test(p.commandLine || "")) || null;
  const browserMainCandidates = processes.filter((p) => p.name === "Windsurf.exe" && !/--type=/.test(p.commandLine || ""));
  const browserMain = browserMainCandidates.find((p) => /^\s*"?[A-Z]:\\.*Windsurf\.exe"?\s*$/i.test((p.commandLine || "").trim()))
    || browserMainCandidates.find((p) => !/--node-ipc|jsonServerMain|extension/i.test(p.commandLine || ""))
    || browserMainCandidates[0]
    || null;
  const languageServer = processes.find((p) => /language_server_windows_x64\.exe/i.test(p.name || "")) || null;

  const missingLinks = [];
  if (traceData.mojoEvents.length === 0) missingLinks.push("renderer_to_browser_mojo_trace_missing");
  if (traceData.frameEvents.length === 0) missingLinks.push("frame_or_routing_metadata_missing");
  if (netlogData.requests.length === 0) missingLinks.push("request_id_not_observed_in_netlog");
  if (!sockets.some((row) => networkService && row.owningPid === networkService.pid)) missingLinks.push("network_service_socket_binding_missing");

  return {
    ipc_chain: [
      "renderer -> browser_main -> network_service -> language_server",
      "renderer -> browser_main -> node_service -> language_server"
    ],
    first_semantic_boundary: {
      pid: 0,
      layer: "unknown",
      signal_type: "unknown",
      evidence: [],
    },
    true_origin_pid: 0,
    true_runtime_pid: networkService?.pid || 0,
    network_service_role: netlogData.requests.length > 0 ? "unknown" : "transport_only",
    confidence: netlogData.requests.length > 0 ? 0.62 : 0.38,
    missing_links: missingLinks,
    observed_processes: {
      renderer,
      browserMain,
      nodeService,
      networkService,
      languageServer,
    },
    frame_hints: frameHints,
    request_hints: requestHints,
    socket_hints: socketHints,
  };
}

const runDir = process.argv[2];
if (!runDir) {
  throw new Error("Usage: node scripts/scratch/normalize-windsurf-native-capture.mjs <run-dir>");
}

const metaPath = path.join(runDir, "launch-meta.json");
const meta = readJson(metaPath);
const processSnapshots = readJsonLines(meta.artifacts.processSnapshots);
const tcpSnapshots = readJsonLines(meta.artifacts.tcpSnapshots);
const chromiumTracePath = meta?.artifacts?.chromiumTrace || "";
const chromiumNetlogPath = meta?.artifacts?.chromiumNetlog || "";
const traceData = chromiumTracePath ? extractTraceEvents(chromiumTracePath) : { rawEventCount: 0, frameEvents: [], requestEvents: [], mojoEvents: [] };
const netlogData = chromiumNetlogPath ? extractNetlog(chromiumNetlogPath) : { constants: null, events: [], requests: [], sockets: [] };
const processes = buildProcessTable(processSnapshots);
const interestingPids = new Set(processes.map((process) => process.pid));
const sockets = buildSocketTable(tcpSnapshots, interestingPids);
const joins = correlate(processes, traceData, netlogData, sockets);

ensureDir(runDir);
fs.writeFileSync(path.join(runDir, "frames.json"), JSON.stringify(traceData.frameEvents, null, 2));
fs.writeFileSync(path.join(runDir, "requests.json"), JSON.stringify(netlogData.requests, null, 2));
fs.writeFileSync(path.join(runDir, "sockets.json"), JSON.stringify(sockets, null, 2));
fs.writeFileSync(path.join(runDir, "joins.json"), JSON.stringify(joins, null, 2));

console.log(JSON.stringify({
  runDir,
  outputs: {
    frames: path.join(runDir, "frames.json"),
    requests: path.join(runDir, "requests.json"),
    sockets: path.join(runDir, "sockets.json"),
    joins: path.join(runDir, "joins.json"),
  },
  summary: {
    rawTraceEvents: traceData.rawEventCount,
    frameEvents: traceData.frameEvents.length,
    requestEvents: netlogData.requests.length,
    socketRows: sockets.length,
    trueRuntimePid: joins.true_runtime_pid,
    missingLinks: joins.missing_links,
  },
}, null, 2));
