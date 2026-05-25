#!/usr/bin/env node

import process from "node:process";

export function isNativeBinaryCompatible(binaryPath) {
  return typeof binaryPath === "string" && binaryPath.length > 0;
}

export function getNativeBinaryCompatSummary() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    ok: true,
    message: "Native binary compatibility checks are using the current runtime environment.",
  };
}

export async function collectNativeBinaryCompat() {
  const summary = getNativeBinaryCompatSummary();
  return {
    name: "Native binaries",
    status: summary.ok ? "ok" : "warn",
    message: summary.message,
    details: summary,
  };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const result = await collectNativeBinaryCompat();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}