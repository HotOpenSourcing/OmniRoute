#!/usr/bin/env node

import process from "node:process";

export function formatPostinstallMessage(message, prefix = "[postinstall]") {
  return `${prefix} ${message}`;
}

export function logPostinstall(message) {
  process.stderr.write(`${formatPostinstallMessage(message)}\n`);
}

export function warnPostinstall(message) {
  process.stderr.write(`${formatPostinstallMessage(message, "[postinstall:warn]")}\n`);
}

export function errorPostinstall(message) {
  process.stderr.write(`${formatPostinstallMessage(message, "[postinstall:error]")}\n`);
}
