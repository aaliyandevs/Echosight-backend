import assert from "node:assert/strict";
import test from "node:test";
import {
  alertProfileSchema,
  detectSoundRequestSchema,
  latestModelQuerySchema,
  listEventsQuerySchema,
  modelVersionSchema,
  soundEventBatchSchema,
  userNameProfileSchema,
} from "../src/validators";

test("alertProfileSchema accepts a valid profile payload", () => {
    const parsed = alertProfileSchema.parse({
      monitored_sounds: ["siren", "doorbell"],
      priority_overrides: { siren: "emergency" },
      haptic_patterns: { siren: "long_pulse" },
      sensitivity: 0.7,
    });

    assert.equal(parsed.sensitivity, 0.7);
    assert.equal(parsed.priority_overrides.siren, "emergency");
});

test("alertProfileSchema rejects invalid sensitivity values", () => {
    const result = alertProfileSchema.safeParse({
      sensitivity: 1.2,
    });

    assert.equal(result.success, false);
});

test("soundEventBatchSchema accepts valid batch event payload", () => {
    const parsed = soundEventBatchSchema.parse({
      events: [
        {
          device_id: "pixel-8",
          label: "siren",
          confidence: 0.95,
          priority: "emergency",
          direction: "front_left",
          ts: "2026-04-03T10:30:00.000Z",
          meta: {
            latency_ms: 180,
            app_version: "0.1.0",
          },
        },
      ],
    });

    assert.equal(parsed.events.length, 1);
    assert.equal(parsed.events[0]?.device_id, "pixel-8");
});

test("soundEventBatchSchema rejects empty event batches", () => {
    const result = soundEventBatchSchema.safeParse({
      events: [],
    });

    assert.equal(result.success, false);
});

test("listEventsQuerySchema applies default limit and parses cursor", () => {
    const parsed = listEventsQuerySchema.parse({
      cursor: "2026-04-03T10:30:00.000Z",
    });

    assert.equal(parsed.limit, 50);
    assert.ok(parsed.cursor instanceof Date);
});

test("latestModelQuerySchema accepts valid latest model query", () => {
    const parsed = latestModelQuerySchema.parse({
      platform: "android",
      channel: "stable",
    });

    assert.equal(parsed.platform, "android");
});

test("modelVersionSchema rejects invalid model payload", () => {
    const result = modelVersionSchema.safeParse({
      platform: "android",
      channel: "stable",
      version: 1,
      model_name: "yamnet-lite",
      download_url: "not-a-url",
      checksum_sha256: "abc",
    });

    assert.equal(result.success, false);
});

test("detectSoundRequestSchema accepts base64 audio payload", () => {
  const parsed = detectSoundRequestSchema.parse({
    audioBase64: Buffer.from("fake").toString("base64"),
    speechHint: "Shayan",
  });

  assert.equal(typeof parsed.audioBase64, "string");
});

test("userNameProfileSchema validates name field", () => {
  const parsed = userNameProfileSchema.parse({
    name: "Shayan",
  });
  assert.equal(parsed.name, "Shayan");
});
