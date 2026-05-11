import { z } from "zod";
import { CHANNELS, DIRECTIONS, PLATFORMS, PRIORITY_LEVELS } from "./constants";

export const hapticSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(["normal", "strong", "critical"]).default("strong"),
  intensity_scale: z.number().min(0.5).max(1).default(1),
  repeat_count: z.number().int().min(1).max(6).default(3),
  repeat_interval_ms: z.number().int().min(150).max(3000).default(500),
  emergency_repeat_until_ack: z.boolean().default(true),
});

export const alertProfileSchema = z.object({
  monitored_sounds: z.array(z.string()).default([]),
  priority_overrides: z.record(z.enum(PRIORITY_LEVELS)).default({}),
  haptic_patterns: z.record(z.string()).default({}),
  haptic_settings: hapticSettingsSchema.default({
    enabled: true,
    mode: "strong",
    intensity_scale: 1,
    repeat_count: 3,
    repeat_interval_ms: 500,
    emergency_repeat_until_ack: true,
  }),
  sensitivity: z.number().min(0).max(1).default(0.5),
});

export const soundEventSchema = z.object({
  device_id: z.string().min(1),
  label: z.string().min(1),
  confidence: z.number().min(0).max(1),
  priority: z.enum(PRIORITY_LEVELS),
  direction: z.enum(DIRECTIONS).default("unknown"),
  ts: z.coerce.date(),
  meta: z
    .object({
      latency_ms: z.number().int().min(0).optional(),
      app_version: z.string().optional(),
    })
    .optional(),
});

export const soundEventBatchSchema = z.object({
  events: z.array(soundEventSchema).min(1),
});

export const deviceRegisterSchema = z.object({
  device_id: z.string().min(1),
  platform: z.enum(PLATFORMS),
  device_model: z.string().min(1),
  os_version: z.string().min(1),
  app_version: z.string().min(1),
});

export const modelVersionSchema = z.object({
  platform: z.enum(PLATFORMS),
  channel: z.enum(CHANNELS).default("stable"),
  version: z.number().int().min(1),
  model_name: z.string().min(1),
  download_url: z.string().url(),
  checksum_sha256: z.string().min(1),
  min_app_version: z.string().optional(),
});

export const feedbackSchema = z.object({
  type: z.enum(["false_alert", "missed_alert", "general"]),
  device_id: z.string().optional(),
  label: z.string().optional(),
  note: z.string().optional(),
  event_ts: z.coerce.date().optional(),
});

export const aiClassifySchema = z.object({
  hint: z.string().optional(),
  device_id: z.string().optional(),
});

export const detectSoundRequestSchema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().optional(),
  speechHint: z.string().max(500).optional(),
});

export const userNameProfileSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(80, "Name is too long"),
});

export const listEventsQuerySchema = z.object({
  from_ts: z.coerce.date().optional(),
  to_ts: z.coerce.date().optional(),
  cursor: z.coerce.date().optional(),
  device_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export const latestModelQuerySchema = z.object({
  platform: z.enum(PLATFORMS),
  channel: z.enum(CHANNELS).default("stable"),
});
