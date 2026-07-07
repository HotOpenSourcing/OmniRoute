import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { assembleStandalone } = await import("../../scripts/build/assembleStandalone.mjs");

/**
 * Phase-3 build-perf optimization: assembleStandalone is now async so the
 * parallel copy fan-out (Promise.all) actually waits for completion before
 * downstream build steps run. These tests guard against regressions where
 * a future refactor would silently drop the await (re-introducing the race)
 * or remove the includeDocs opt-out (re-adding the 68 MB unconditional copy).
 */

async function withTempDir(fn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omniroute-assemble-standalone-"));
  try {
    await fn(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function scaffoldStandaloneInput(rootDir) {
  // Build the minimum a Next.js standalone output needs so assembleStandalone
  // doesn't bail at "standalone dir not found". Just server.js + package.json
  // + a token static/ tree; we don't need a real Next manifest for these tests.
  const distDir = path.join(rootDir, ".build", "next");
  const standaloneDir = path.join(distDir, "standalone");
  await fs.mkdir(path.join(standaloneDir, ".next", "server"), { recursive: true });
  await fs.mkdir(path.join(distDir, "static"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "public"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "docs"), { recursive: true });

  await fs.writeFile(path.join(standaloneDir, "server.js"), "// stub server\n");
  await fs.writeFile(
    path.join(standaloneDir, "package.json"),
    JSON.stringify({ name: "stub", type: "module", dependencies: {} })
  );
  await fs.writeFile(path.join(standaloneDir, ".next", "required-server-files.json"), "{}");
  await fs.writeFile(path.join(distDir, "static", "asset.txt"), "static-asset");
  await fs.writeFile(path.join(rootDir, "public", "index.html"), "<html/>");
  await fs.writeFile(path.join(rootDir, "docs", "README.md"), "# docs");

  return { distDir, standaloneDir };
}

test("assembleStandalone returns a Promise (async signature)", async () => {
  // Critical: a future refactor that drops `async` would silently reintroduce
  // the race with the parallel copy fan-out. The return type check + timing
  // pattern below would catch that.
  await withTempDir(async (tempDir) => {
    const { distDir, standaloneDir } = await scaffoldStandaloneInput(tempDir);
    const outDir = path.join(tempDir, "out");

    const result = assembleStandalone({
      distDir,
      outDir,
      projectRoot: tempDir,
      copyNatives: false,
      includeDocs: false,
    });
    assert.equal(
      typeof result?.then,
      "function",
      "assembleStandalone must return a Promise (async) so callers can await the parallel copy fan-out"
    );
    await result;
    // outDir should now exist with server.js copied over
    assert.equal(
      await fs.stat(path.join(outDir, "server.js")).then(() => true, () => false),
      true
    );
  });
});

test("assembleStandalone defaults to includeDocs=true (copies docs/ to standalone)", async () => {
  // Hard rule: never silently break the docs/ shipping contract. Default
  // behaviour must keep docs/ in the assembled bundle.
  await withTempDir(async (tempDir) => {
    const { distDir, standaloneDir } = await scaffoldStandaloneInput(tempDir);
    const outDir = path.join(tempDir, "out");

    await assembleStandalone({
      distDir,
      outDir,
      projectRoot: tempDir,
      copyNatives: false,
      // includeDocs intentionally omitted — must default to true
    });

    const docsCopied = await fs
      .stat(path.join(outDir, "docs", "README.md"))
      .then(() => true, () => false);
    assert.equal(docsCopied, true, "docs/ must be copied when includeDocs is not set");
  });
});

test("assembleStandalone skips docs/ when includeDocs=false", async () => {
  // Build perf: opt-out for CI smoke, image layer tests, Electron — saves ~68 MB.
  await withTempDir(async (tempDir) => {
    const { distDir, standaloneDir } = await scaffoldStandaloneInput(tempDir);
    const outDir = path.join(tempDir, "out");

    await assembleStandalone({
      distDir,
      outDir,
      projectRoot: tempDir,
      copyNatives: false,
      includeDocs: false,
    });

    const docsCopied = await fs
      .stat(path.join(outDir, "docs"))
      .then(() => true, () => false);
    assert.equal(
      docsCopied,
      false,
      "docs/ must be skipped when includeDocs=false (build perf opt-out)"
    );

    // But static + public must still be copied — includeDocs is the only knob.
    const staticCopied = await fs
      .stat(path.join(outDir, ".build", "next", "static", "asset.txt"))
      .then(() => true, () => false);
    assert.equal(staticCopied, true, "static/ must still be copied even when docs is skipped");

    const publicCopied = await fs
      .stat(path.join(outDir, "public", "index.html"))
      .then(() => true, () => false);
    assert.equal(publicCopied, true, "public/ must still be copied even when docs is skipped");
  });
});

test("assembleStandalone copies static and public in parallel (Promise.all, same output)", async () => {
  // The Promise.all-based copyStaticAndPublic must produce the same output as
  // the previous sequential implementation — both copies land at their
  // destinations regardless of which finishes first.
  await withTempDir(async (tempDir) => {
    const { distDir, standaloneDir } = await scaffoldStandaloneInput(tempDir);
    const outDir = path.join(tempDir, "out");

    await assembleStandalone({
      distDir,
      outDir,
      projectRoot: tempDir,
      copyNatives: false,
      includeDocs: false,
    });

    const staticContent = await fs.readFile(
      path.join(outDir, ".build", "next", "static", "asset.txt"),
      "utf8"
    );
    const publicContent = await fs.readFile(path.join(outDir, "public", "index.html"), "utf8");
    assert.equal(staticContent, "static-asset");
    assert.equal(publicContent, "<html/>");
  });
});
