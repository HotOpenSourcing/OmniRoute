import test from "node:test";
import assert from "node:assert/strict";

import {
  WINDSURF_FRAME_MAGIC_ERROR,
  WINDSURF_FRAME_MAGIC_GZIP,
  decodeWindsurfFrame,
  encodeWindsurfFrame,
  splitWindsurfFrames,
} from "../../open-sse/utils/windsurfProtocol.ts";

test("Windsurf protocol encodes and decodes gzip frames", () => {
  const payload = new TextEncoder().encode("hello windsurf");
  const frame = encodeWindsurfFrame(payload, { compress: true });
  const decoded = decodeWindsurfFrame(frame);

  assert.equal(decoded.magic, WINDSURF_FRAME_MAGIC_GZIP);
  assert.equal(decoded.compressed, true);
  assert.equal(new TextDecoder().decode(decoded.payload), "hello windsurf");
});

test("Windsurf protocol preserves raw error frames", () => {
  const payload = new TextEncoder().encode('{"error":"boom"}');
  const frame = encodeWindsurfFrame(payload, {
    magic: WINDSURF_FRAME_MAGIC_ERROR,
    compress: false,
  });
  const decoded = decodeWindsurfFrame(frame);

  assert.equal(decoded.magic, WINDSURF_FRAME_MAGIC_ERROR);
  assert.equal(decoded.compressed, false);
  assert.equal(new TextDecoder().decode(decoded.payload), '{"error":"boom"}');
});

test("Windsurf protocol rejects oversized and truncated frames", () => {
  const payload = new Uint8Array([1, 2, 3]);
  const frame = encodeWindsurfFrame(payload);
  const truncated = frame.subarray(0, frame.length - 1);

  assert.throws(() => decodeWindsurfFrame(truncated), /length does not match/);
  assert.throws(() => decodeWindsurfFrame(frame, { maxFrameBytes: 1 }), /exceeds limit/);
});

test("Windsurf protocol can split multiple frames from a buffer", () => {
  const first = encodeWindsurfFrame(new TextEncoder().encode("one"));
  const second = encodeWindsurfFrame(new TextEncoder().encode("two"));
  const joined = new Uint8Array(first.length + second.length + 2);
  joined.set(first, 0);
  joined.set(second, first.length);
  joined.set([0xaa, 0xbb], first.length + second.length);

  const split = splitWindsurfFrames(joined);
  assert.equal(split.frames.length, 2);
  assert.deepEqual(Array.from(split.remainder), [0xaa, 0xbb]);
});
