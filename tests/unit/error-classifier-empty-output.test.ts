import test from "node:test";
import assert from "node:assert/strict";

const { classifyProviderError, PROVIDER_ERROR_TYPES, isEmptyOutputError } =
  await import("../../open-sse/services/errorClassifier.ts");

test("isEmptyOutputError: detects Freebuff empty-output signal", () => {
  const msg = "model output error: model output must contain either output text or tool calls";
  assert.equal(isEmptyOutputError(msg), true);
});

test("isEmptyOutputError: detects variation with 'these cannot both be empty'", () => {
  const msg =
    "model output error: model output must contain either output text or tool calls, these cannot both be empty";
  assert.equal(isEmptyOutputError(msg), true);
});

test("isEmptyOutputError: detects variation with 'please try again'", () => {
  const msg =
    "model output error: model output must contain either output text or tool calls, these cannot both be empty, please try again";
  assert.equal(isEmptyOutputError(msg), true);
});

test("isEmptyOutputError: returns false for unrelated error", () => {
  const msg = "rate limit exceeded";
  assert.equal(isEmptyOutputError(msg), false);
});

test("classifyProviderError: 200 + empty-output message => EMPTY_OUTPUT", () => {
  const body = JSON.stringify({
    error: { message: "model output must contain either output text or tool calls" },
  });
  const result = classifyProviderError(200, body);
  assert.equal(result, PROVIDER_ERROR_TYPES.EMPTY_OUTPUT);
});

test("classifyProviderError: 502 + empty-output message => EMPTY_OUTPUT", () => {
  const body =
    "model output error: model output must contain either output text or tool calls, these cannot both be empty";
  const result = classifyProviderError(502, body);
  assert.equal(result, PROVIDER_ERROR_TYPES.EMPTY_OUTPUT);
});

test("classifyProviderError: 500 + empty-output in JSON error.message => EMPTY_OUTPUT", () => {
  const body = JSON.stringify({
    error: {
      message:
        "model output must contain either output text or tool calls, these cannot both be empty, please try again",
    },
  });
  const result = classifyProviderError(500, body);
  assert.equal(result, PROVIDER_ERROR_TYPES.EMPTY_OUTPUT);
});

test("classifyProviderError: 400 + empty-output message => EMPTY_OUTPUT", () => {
  const body = "model output error: model output must contain either output text or tool calls";
  const result = classifyProviderError(400, body);
  assert.equal(result, PROVIDER_ERROR_TYPES.EMPTY_OUTPUT);
});

test("classifyProviderError: status 200 + non-empty-output error => other classification", () => {
  const body = JSON.stringify({ error: { message: "invalid request" } });
  const result = classifyProviderError(200, body);
  assert.notEqual(result, PROVIDER_ERROR_TYPES.EMPTY_OUTPUT);
});
