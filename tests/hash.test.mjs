import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createMessageId } from "../src/lib/hash.js";

test("normalized content creates a stable integrity hash", () => {
  const normalize = (value) => value.trim().replace(/\r\n/g, "\n");
  const hash = (value) => createHash("sha256").update(normalize(value)).digest("hex");
  assert.equal(hash("hello\r\nworld  "), hash("hello\nworld"));
  assert.equal(hash("hello").length, 64);
});

test("separate send actions receive separate message IDs", () => {
  const first = createMessageId();
  const second = createMessageId();
  assert.notEqual(first, second);
  assert.match(first, /^[a-z0-9]+-[a-f0-9-]+$/);
});

test("broadcast numbers are exactly four digits", () => {
  const valid = (value) => /^\d{4}$/.test(value);
  assert.equal(valid("0001"), true);
  assert.equal(valid("1234"), true);
  assert.equal(valid("123"), false);
  assert.equal(valid("12a4"), false);
});
