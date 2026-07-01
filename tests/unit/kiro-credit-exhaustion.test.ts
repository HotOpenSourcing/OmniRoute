import assert from "node:assert";
import { describe, test } from "node:test";
import { isCreditsExhausted } from "../../open-sse/services/accountFallback.ts";

describe("Kiro Credit Exhaustion Detection", () => {
  test("detects 'Insufficient Balance'", () => {
    const errorText = "Error: Insufficient Balance - please add credits to your account";
    assert.strictEqual(isCreditsExhausted(errorText), true);
  });

  test("detects 'Quota Exhausted'", () => {
    const errorText = "Quota Exhausted - you have reached your monthly limit";
    assert.strictEqual(isCreditsExhausted(errorText), true);
  });

  test("detects 'providers.No Credits'", () => {
    const errorText = "providers.No Credits available for this request";
    assert.strictEqual(isCreditsExhausted(errorText), true);
  });

  test("detects 'You have reached the limit'", () => {
    const errorText = "You have reached the limit for this billing period";
    assert.strictEqual(isCreditsExhausted(errorText), true);
  });

  test("case insensitive detection", () => {
    assert.strictEqual(isCreditsExhausted("INSUFFICIENT BALANCE"), true);
    assert.strictEqual(isCreditsExhausted("QuOtA eXhAuStEd"), true);
    assert.strictEqual(isCreditsExhausted("PROVIDERS.NO CREDITS"), true);
    assert.strictEqual(isCreditsExhausted("YOU HAVE REACHED THE LIMIT"), true);
  });

  test("detects AWS CodeWhisperer/Kiro quota patterns", () => {
    assert.strictEqual(isCreditsExhausted("Kiro API error (402): usage limit exceeded"), true);
    assert.strictEqual(isCreditsExhausted("ThrottlingException: quota exceeded"), true);
    assert.strictEqual(isCreditsExhausted("Request failed: limit exceeded"), true);
  });

  test("does not detect unrelated errors", () => {
    assert.strictEqual(isCreditsExhausted("Network timeout"), false);
    assert.strictEqual(isCreditsExhausted("Invalid API key"), false);
    assert.strictEqual(isCreditsExhausted("Server error 500"), false);
  });
});
