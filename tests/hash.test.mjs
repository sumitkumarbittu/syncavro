import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

test("normalized content creates a stable duplicate key", () => {
  const normalize = (value) => value.trim().replace(/\r\n/g, "\n");
  const hash = (value) => createHash("sha256").update(normalize(value)).digest("hex");
  assert.equal(hash("hello\r\nworld  "), hash("hello\nworld"));
  assert.equal(hash("hello").length, 64);
});

test("broadcast numbers are exactly four digits", () => {
  const valid = (value) => /^\d{4}$/.test(value);
  assert.equal(valid("0001"), true);
  assert.equal(valid("1234"), true);
  assert.equal(valid("123"), false);
  assert.equal(valid("12a4"), false);
});
