import assert from "node:assert/strict";
import test from "node:test";
import { isNameInTranscript } from "../src/services/sound/name-matcher";

test("isNameInTranscript detects direct name mention", () => {
  const detected = isNameInTranscript("Shayan please come here", "Shayan");
  assert.equal(detected, true);
});

test("isNameInTranscript handles simple fuzzy misspelling", () => {
  const detected = isNameInTranscript("Shayon are you there", "Shayan");
  assert.equal(detected, true);
});

test("isNameInTranscript returns false when name is absent", () => {
  const detected = isNameInTranscript("Someone called Ahmed", "Shayan");
  assert.equal(detected, false);
});

