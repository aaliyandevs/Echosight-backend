import assert from "node:assert/strict";
import test from "node:test";
import {
  parseYamnetClassMap,
  prepareYamnetWaveform,
} from "../src/services/sound/sound-classifier";

test("YAMNet class map loads the expected AudioSet labels", () => {
  const labels = parseYamnetClassMap("assets/yamnet_class_map.csv");

  assert.equal(labels.length, 521);
  assert.equal(labels[0], "Speech");
  assert.equal(labels[1], "Child speech, kid speaking");
  assert.ok(labels.includes("Siren"));
});

test("YAMNet waveform preparation pads short chunks for first model frame", () => {
  const mobileChunk = new Float32Array(11_200);
  mobileChunk[0] = 0.25;

  const prepared = prepareYamnetWaveform(mobileChunk);

  assert.equal(prepared.length, 15_600);
  assert.equal(prepared[0], 0.25);
  assert.equal(prepared[11_200], 0);
});
