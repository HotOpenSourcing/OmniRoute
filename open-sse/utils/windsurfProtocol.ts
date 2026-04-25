import { gunzipSync, gzipSync } from "node:zlib";

export const WINDSURF_FRAME_MAGIC_GZIP = 1;
export const WINDSURF_FRAME_MAGIC_ERROR = 3;
export const WINDSURF_DEFAULT_MAX_FRAME_BYTES = 16 << 20;

export type WindsurfDecodedFrame = {
  magic: number;
  payload: Uint8Array;
  compressed: boolean;
};

function toUint8Array(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export function encodeWindsurfFrame(
  payload: Uint8Array,
  options?: { magic?: number; compress?: boolean }
): Uint8Array {
  const compress = options?.compress ?? false;
  const magic = options?.magic ?? (compress ? WINDSURF_FRAME_MAGIC_GZIP : 0);
  const body = compress ? gzipSync(payload) : Buffer.from(payload);
  const frame = Buffer.allocUnsafe(5 + body.length);
  frame.writeUInt8(magic, 0);
  frame.writeUInt32BE(body.length, 1);
  Buffer.from(body).copy(frame, 5);
  return new Uint8Array(frame);
}

export function decodeWindsurfFrame(
  frame: Uint8Array,
  options?: { maxFrameBytes?: number }
): WindsurfDecodedFrame {
  const buffer = Buffer.from(frame);
  if (buffer.length < 5) {
    throw new Error("Windsurf frame is truncated.");
  }

  const magic = buffer.readUInt8(0);
  const length = buffer.readUInt32BE(1);
  const maxFrameBytes = options?.maxFrameBytes ?? WINDSURF_DEFAULT_MAX_FRAME_BYTES;

  if (length > maxFrameBytes) {
    throw new Error(`Windsurf frame exceeds limit: ${length} bytes.`);
  }

  if (buffer.length !== length + 5) {
    throw new Error("Windsurf frame length does not match payload size.");
  }

  const rawPayload = buffer.subarray(5);
  const compressed = magic === WINDSURF_FRAME_MAGIC_GZIP;
  const payload = compressed ? gunzipSync(rawPayload) : rawPayload;

  return {
    magic,
    compressed,
    payload: toUint8Array(payload),
  };
}

export function splitWindsurfFrames(
  chunk: Uint8Array,
  options?: { maxFrameBytes?: number }
): { frames: Uint8Array[]; remainder: Uint8Array } {
  const buffer = Buffer.from(chunk);
  const frames: Uint8Array[] = [];
  const maxFrameBytes = options?.maxFrameBytes ?? WINDSURF_DEFAULT_MAX_FRAME_BYTES;
  let offset = 0;

  while (offset + 5 <= buffer.length) {
    const payloadLength = buffer.readUInt32BE(offset + 1);
    if (payloadLength > maxFrameBytes) {
      throw new Error(`Windsurf frame exceeds limit: ${payloadLength} bytes.`);
    }

    const frameLength = payloadLength + 5;
    if (offset + frameLength > buffer.length) {
      break;
    }

    frames.push(new Uint8Array(buffer.subarray(offset, offset + frameLength)));
    offset += frameLength;
  }

  return {
    frames,
    remainder: new Uint8Array(buffer.subarray(offset)),
  };
}
