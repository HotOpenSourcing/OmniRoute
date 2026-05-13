#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

import { getNodeRuntimeSupport, getNodeRuntimeWarning } from "../bin/nodeRuntimeSupport.mjs";
import { logPostinstall, warnPostinstall, errorPostinstall } from "./postinstallSupport.mjs";

async function run() {
  const support = getNodeRuntimeSupport();
  if (!support.nodeCompatible) {
    const warning = getNodeRuntimeWarning() || `${support.nodeVersion} is outside supported policy.`;
    errorPostinstall(warning);
    errorPostinstall(`Supported range: ${support.supportedRange}`);
    process.exitCode = 1;
    return;
  }

  logPostinstall(`Node runtime ${support.nodeVersion} is supported.`);

  try {
    const { syncEnv } = await import("./sync-env.mjs");
    const result = await syncEnv({ quiet: true });
    const createdText = result.created ? "created .env" : "updated existing .env";
    logPostinstall(`Environment sync completed (${createdText}; added ${result.added} key(s)).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnPostinstall(`Environment sync skipped: ${message}`);
  }

  logPostinstall("If native modules fail after switching Node versions, run: npm rebuild better-sqlite3");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await run();
}
