/**
 * Cursor Protobuf Encoder/Decoder
 * Implements ConnectRPC protobuf wire format for Cursor API
 *
 * Schema Version: reverse-engineered from Cursor client traffic.
 * If Cursor updates their protocol, unknown field warnings will appear
 * in the logs — update the FIELD map and bump the version below.
 */

import { v4 as uuidv4 } from "uuid";
import zlib from "zlib";

const DEBUG = process.env.CURSOR_PROTOBUF_DEBUG === "1";
const log = (tag, ...args) => DEBUG && console.log(`[PROTOBUF:${tag}]`, ...args);
const textDecoder = new TextDecoder();

/**
 * Schema version — bump when updating field definitions.
 * Logged in warnings to help correlate unknown fields with Cursor client versions.
 */
const PROTOBUF_SCHEMA_VERSION = "1.1.3";

const WIRE_TYPE = { VARINT: 0, FIXED64: 1, LEN: 2, FIXED32: 5 };
const ROLE = { USER: 1, ASSISTANT: 2 };
const UNIFIED_MODE = { CHAT: 1, AGENT: 2 };
const THINKING_LEVEL = { UNSPECIFIED: 0, MEDIUM: 1, HIGH: 2 };
const CLIENT_SIDE_TOOL_V2 = { MCP: 19 };

const FIELD = {
  REQUEST: 1,
  MESSAGES: 1,
  UNKNOWN_2: 2,
  INSTRUCTION: 3,
  UNKNOWN_4: 4,
  MODEL: 5,
  WEB_TOOL: 8,
  UNKNOWN_13: 13,
  CURSOR_SETTING: 15,
  UNKNOWN_19: 19,
  CONVERSATION_ID: 23,
  METADATA: 26,
  IS_AGENTIC: 27,
  SUPPORTED_TOOLS: 29,
  MESSAGE_IDS: 30,
  MCP_TOOLS: 34,
  LARGE_CONTEXT: 35,
  UNKNOWN_38: 38,
  UNIFIED_MODE: 46,
  UNKNOWN_47: 47,
  SHOULD_DISABLE_TOOLS: 48,
  THINKING_LEVEL: 49,
  UNKNOWN_51: 51,
  UNKNOWN_53: 53,
  UNIFIED_MODE_NAME: 54,
  MSG_CONTENT: 1,
  MSG_ROLE: 2,
  MSG_ID: 13,
  MSG_TOOL_RESULTS: 18,
  MSG_IS_AGENTIC: 29,
  MSG_UNIFIED_MODE: 47,
  MSG_SUPPORTED_TOOLS: 51,
  TOOL_RESULT_CALL_ID: 1,
  TOOL_RESULT_NAME: 2,
  TOOL_RESULT_INDEX: 3,
  TOOL_RESULT_RAW_ARGS: 5,
  TOOL_RESULT_RESULT: 8,
  TOOL_RESULT_TOOL_CALL: 11,
  TOOL_RESULT_MODEL_CALL_ID: 12,
  CLIENT_RESULT_TOOL: 1,
  CLIENT_RESULT_MCP_RESULT: 28,
  CLIENT_RESULT_TOOL_CALL_ID: 35,
  CLIENT_RESULT_MODEL_CALL_ID: 48,
  CLIENT_RESULT_TOOL_INDEX: 49,
  MCP_RESULT_SELECTED_TOOL: 1,
  MCP_RESULT_RESULT: 2,
  CLIENT_CALL_TOOL: 1,
  CLIENT_CALL_MCP_PARAMS: 27,
  CLIENT_CALL_TOOL_CALL_ID: 3,
  CLIENT_CALL_NAME: 9,
  CLIENT_CALL_RAW_ARGS: 10,
  CLIENT_CALL_TOOL_INDEX: 48,
  CLIENT_CALL_MODEL_CALL_ID: 49,
  MODEL_NAME: 1,
  MODEL_EMPTY: 4,
  INSTRUCTION_TEXT: 1,
  SETTING_PATH: 1,
  SETTING_UNKNOWN_3: 3,
  SETTING_UNKNOWN_6: 6,
  SETTING_UNKNOWN_8: 8,
  SETTING_UNKNOWN_9: 9,
  SETTING6_FIELD_1: 1,
  SETTING6_FIELD_2: 2,
  META_PLATFORM: 1,
  META_ARCH: 2,
  META_VERSION: 3,
  META_CWD: 4,
  META_TIMESTAMP: 5,
  MSGID_ID: 1,
  MSGID_SUMMARY: 2,
  MSGID_ROLE: 3,
  MCP_TOOL_NAME: 1,
  MCP_TOOL_DESC: 2,
  MCP_TOOL_PARAMS: 3,
  MCP_TOOL_SERVER: 4,
  TOOL_CALL: 1,
  RESPONSE: 2,
  TOOL_ID: 3,
  TOOL_NAME: 9,
  TOOL_RAW_ARGS: 10,
  TOOL_IS_LAST: 11,
  TOOL_IS_LAST_ALT: 15,
  TOOL_MCP_PARAMS: 27,
  MCP_TOOLS_LIST: 1,
  MCP_NESTED_NAME: 1,
  MCP_NESTED_PARAMS: 3,
  RESPONSE_TEXT: 1,
  THINKING: 25,
  THINKING_TEXT: 1,
};

const KNOWN_RESPONSE_FIELDS = new Set([
  FIELD.TOOL_CALL,
  FIELD.RESPONSE,
  FIELD.TOOL_ID,
  FIELD.TOOL_NAME,
  FIELD.TOOL_RAW_ARGS,
  FIELD.TOOL_IS_LAST,
  FIELD.TOOL_MCP_PARAMS,
  FIELD.RESPONSE_TEXT,
  FIELD.THINKING,
]);

export function encodeVarint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return new Uint8Array(bytes);
}

export function encodeField(fieldNum, wireType, value) {
  const tag = (fieldNum << 3) | wireType;
  const tagBytes = encodeVarint(tag);

  if (wireType === WIRE_TYPE.VARINT) {
    const valueBytes = encodeVarint(value);
    return concatArrays(tagBytes, valueBytes);
  }

  if (wireType === WIRE_TYPE.LEN) {
    const dataBytes =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value
          : Buffer.isBuffer(value)
            ? new Uint8Array(value)
            : new Uint8Array(0);

    const lengthBytes = encodeVarint(dataBytes.length);
    return concatArrays(tagBytes, lengthBytes, dataBytes);
  }

  return new Uint8Array(0);
}

function concatArrays(...arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export function wrapConnectRPCFrame(payload, compressed = false) {
  const rawPayload = payload instanceof Uint8Array ? Buffer.from(payload) : Buffer.from(payload || []);
  const body = compressed ? zlib.gzipSync(rawPayload) : rawPayload;
  const header = Buffer.alloc(5);
  header[0] = compressed ? 1 : 0;
  header.writeUInt32BE(body.length, 1);
  return new Uint8Array(Buffer.concat([header, body]));
}

function encodeMessageText(content) {
  return encodeField(FIELD.MSG_CONTENT, WIRE_TYPE.LEN, content || "");
}

function encodeMessageRole(role) {
  return encodeField(FIELD.MSG_ROLE, WIRE_TYPE.VARINT, role === "assistant" ? ROLE.ASSISTANT : ROLE.USER);
}

function encodeMessageId() {
  return encodeField(FIELD.MSG_ID, WIRE_TYPE.LEN, uuidv4());
}

function encodeConversationMessage(message) {
  const content = typeof message?.content === "string" ? message.content : "";
  return encodeField(
    FIELD.MESSAGES,
    WIRE_TYPE.LEN,
    concatArrays(encodeMessageText(content), encodeMessageRole(message?.role), encodeMessageId())
  );
}

function encodeInstruction(systemPrompt) {
  return systemPrompt
    ? encodeField(
        FIELD.INSTRUCTION,
        WIRE_TYPE.LEN,
        encodeField(FIELD.INSTRUCTION_TEXT, WIRE_TYPE.LEN, systemPrompt)
      )
    : new Uint8Array(0);
}

function encodeModel(model) {
  return encodeField(
    FIELD.MODEL,
    WIRE_TYPE.LEN,
    concatArrays(
      encodeField(FIELD.MODEL_NAME, WIRE_TYPE.LEN, model || "auto"),
      encodeField(FIELD.MODEL_EMPTY, WIRE_TYPE.LEN, new Uint8Array(0))
    )
  );
}

function encodeMetadata() {
  return encodeField(
    FIELD.METADATA,
    WIRE_TYPE.LEN,
    concatArrays(
      encodeField(FIELD.META_PLATFORM, WIRE_TYPE.LEN, process.platform),
      encodeField(FIELD.META_ARCH, WIRE_TYPE.LEN, process.arch),
      encodeField(FIELD.META_VERSION, WIRE_TYPE.LEN, PROTOBUF_SCHEMA_VERSION),
      encodeField(FIELD.META_CWD, WIRE_TYPE.LEN, process.cwd()),
      encodeField(FIELD.META_TIMESTAMP, WIRE_TYPE.LEN, String(Date.now()))
    )
  );
}

export function encodeCursorRequest({ messages = [], systemPrompt = "", model = "auto" } = {}) {
  const encodedMessages = messages.flatMap((message) => [...encodeConversationMessage(message)]);
  return concatArrays(
    encodeField(
      FIELD.REQUEST,
      WIRE_TYPE.LEN,
      concatArrays(
        new Uint8Array(encodedMessages),
        encodeInstruction(systemPrompt),
        encodeModel(model),
        encodeMetadata()
      )
    )
  );
}

export function decodeResponseText(buffer) {
  if (!buffer) return "";
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return textDecoder.decode(bytes);
}

export function parseCursorResponsePayload(payload) {
  return {
    text: decodeResponseText(payload),
    hasKnownFields: KNOWN_RESPONSE_FIELDS.size > 0,
  };
}
