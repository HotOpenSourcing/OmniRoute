import fs from "node:fs";
import path from "node:path";
import net from "node:net";

const captureRoot = "C:/Users/amine/OmniRoute/artifacts/windsurf-native";
const runDir = path.join(captureRoot, `57330-capture-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(runDir, { recursive: true });

const outPath = path.join(runDir, "port-57330-http-capture.jsonl");
const metaPath = path.join(runDir, "meta.json");

const paths = ["/", "/json/version", "/json/list", "/json", "/health", "/status"];

function writeLine(obj) {
  fs.appendFileSync(outPath, `${JSON.stringify(obj)}\n`);
}

function probePath(requestPath) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const socket = net.createConnection({ host: "127.0.0.1", port: 57330 });
    let response = "";
    let settled = false;

    function finish(payload) {
      if (settled) return;
      settled = true;
      writeLine({ startedAt, path: requestPath, ...payload });
      resolve();
    }

    socket.setTimeout(3000);
    socket.on("connect", () => {
      socket.write(`GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1:57330\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("timeout", () => {
      socket.destroy();
      finish({ outcome: "timeout", responsePreview: response.slice(0, 1000) });
    });
    socket.on("error", (error) => {
      finish({ outcome: "transport_error", error: error.message, responsePreview: response.slice(0, 1000) });
    });
    socket.on("close", (hadError) => {
      finish({ outcome: hadError ? "closed_with_error" : "closed", responsePreview: response.slice(0, 2000) });
    });
  });
}

async function waitForPort() {
  while (true) {
    const open = await new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port: 57330 });
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        try { socket.destroy(); } catch {}
        resolve(value);
      };
      socket.setTimeout(500);
      socket.on("connect", () => finish(true));
      socket.on("timeout", () => finish(false));
      socket.on("error", () => finish(false));
    });

    if (open) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  fs.writeFileSync(metaPath, JSON.stringify({ startedAt: new Date().toISOString(), runDir, outPath, paths }, null, 2));
  await waitForPort();
  writeLine({ event: "port_open_detected", at: new Date().toISOString() });
  for (const p of paths) {
    await probePath(p);
  }
  fs.writeFileSync(metaPath, JSON.stringify({ startedAt: JSON.parse(fs.readFileSync(metaPath, "utf8")).startedAt, finishedAt: new Date().toISOString(), runDir, outPath, paths }, null, 2));
  console.log(JSON.stringify({ runDir, outPath }, null, 2));
}

main().catch((error) => {
  fs.appendFileSync(outPath, `${JSON.stringify({ event: "fatal", at: new Date().toISOString(), error: error.message })}\n`);
  process.exit(1);
});
