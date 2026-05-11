import { Router } from "express";
import { ZodTypeAny, z } from "zod";
import { env } from "../config";
import { getDb } from "../db/mongo";
import { asyncHandler, sendError, sendOk, zodToFieldErrors } from "../http/api";
import { createRateLimiter } from "../middleware/rateLimit";
import {
  aiClassifySchema,
  alertProfileSchema,
  deviceRegisterSchema,
  feedbackSchema,
  latestModelQuerySchema,
  listEventsQuerySchema,
  modelVersionSchema,
  soundEventBatchSchema,
  userNameProfileSchema,
} from "../validators";

export const v1Router = Router();
const writeLimiter = createRateLimiter({
  max: env.RATE_LIMIT_WRITE_MAX,
  scope: "api-write",
  windowMs: env.RATE_LIMIT_WINDOW_MS,
});

const parseWithSchema = <T extends ZodTypeAny>(
  schema: T,
  payload: unknown,
  res: Parameters<typeof sendError>[0]
): z.infer<T> | null => {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    sendError(res, 400, "Some information is missing or invalid.", {
      code: "INVALID_INPUT",
      hint: "Please review your input and try again.",
      fields: zodToFieldErrors(parsed.error),
    });
    return null;
  }
  return parsed.data;
};

v1Router.get(
  "/users/me",
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const db = getDb();

    const fallbackUser = {
      user_id: userId,
      name: null,
      updated_at: new Date(),
    };

    const user = await db.collection("users").findOneAndUpdate(
      { user_id: userId },
      {
        $setOnInsert: {
          user_id: userId,
          name: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      },
      { upsert: true, returnDocument: "after", projection: { _id: 0 } }
    );

    sendOk(res, user ?? fallbackUser);
  })
);

v1Router.put(
  "/users/me",
  writeLimiter,
  asyncHandler(async (req, res) => {
    const parsed = parseWithSchema(userNameProfileSchema, req.body, res);
    if (!parsed) {
      return;
    }

    const userId = req.userId as string;
    const db = getDb();
    const now = new Date();

    const user = await db.collection("users").findOneAndUpdate(
      { user_id: userId },
      {
        $set: {
          user_id: userId,
          name: parsed.name.trim(),
          updated_at: now,
        },
        $setOnInsert: {
          created_at: now,
        },
      },
      { upsert: true, returnDocument: "after", projection: { _id: 0 } }
    );

    sendOk(res, user ?? { user_id: userId, name: parsed.name.trim(), updated_at: now });
  })
);

v1Router.get(
  "/profiles/me",
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const db = getDb();

    const fallbackProfile = {
      user_id: userId,
      monitored_sounds: [],
      priority_overrides: {},
      haptic_patterns: {
        emergency: "long_strong_repeat",
        high: "triple_strong_pulse",
        medium: "double_pulse",
        low: "single_pulse",
      },
      haptic_settings: {
        enabled: true,
        mode: "strong",
        intensity_scale: 1,
        repeat_count: 3,
        repeat_interval_ms: 500,
        emergency_repeat_until_ack: true,
      },
      sensitivity: 0.5,
      updated_at: new Date(),
    };

    const result = await db.collection("alert_profiles").findOneAndUpdate(
      { user_id: userId },
      { $setOnInsert: fallbackProfile },
      { upsert: true, returnDocument: "after", projection: { _id: 0 } }
    );
    const stored = result ?? fallbackProfile;
    const safeProfile = {
      ...fallbackProfile,
      ...stored,
      haptic_settings: {
        ...fallbackProfile.haptic_settings,
        ...(stored.haptic_settings ?? {}),
      },
      haptic_patterns: {
        ...fallbackProfile.haptic_patterns,
        ...(stored.haptic_patterns ?? {}),
      },
    };

    sendOk(res, safeProfile);
  })
);

v1Router.put(
  "/profiles/me",
  writeLimiter,
  asyncHandler(async (req, res) => {
    const parsed = parseWithSchema(alertProfileSchema, req.body, res);
    if (!parsed) {
      return;
    }

    const userId = req.userId as string;
    const db = getDb();
    const doc = {
      user_id: userId,
      ...parsed,
      updated_at: new Date(),
    };

    const updated = await db.collection("alert_profiles").findOneAndUpdate(
      { user_id: userId },
      { $set: doc },
      { upsert: true, returnDocument: "after", projection: { _id: 0 } }
    );

    sendOk(res, updated ?? doc);
  })
);

v1Router.post(
  "/events/batch",
  writeLimiter,
  asyncHandler(async (req, res) => {
    const parsed = parseWithSchema(soundEventBatchSchema, req.body, res);
    if (!parsed) {
      return;
    }

    const userId = req.userId as string;
    const db = getDb();
    const idempotencyKey = req.header("Idempotency-Key");
    const idempotencyRoute = "/v1/events/batch";

    if (idempotencyKey) {
      const existing = await db.collection("idempotency_keys").findOneAndUpdate(
        {
          user_id: userId,
          route: idempotencyRoute,
          key: idempotencyKey,
        },
        {
          $setOnInsert: {
            user_id: userId,
            route: idempotencyRoute,
            key: idempotencyKey,
            state: "pending",
            created_at: new Date(),
          },
        },
        {
          upsert: true,
          returnDocument: "before",
          projection: {
            _id: 0,
            response_data: 1,
            state: 1,
          },
        }
      );

      if (existing) {
        if (existing.response_data) {
          sendOk(
            res,
            {
              ...(existing.response_data as Record<string, unknown>),
              idempotent_replay: true,
            },
            "success"
          );
          return;
        }

        sendError(
          res,
          409,
          "A similar request is already being processed. Please wait a moment and retry.",
          {
            code: "REQUEST_IN_PROGRESS",
          }
        );
        return;
      }
    }

    const docs = parsed.events.map((event) => ({
      user_id: userId,
      ...event,
    }));

    if (docs.length > 0) {
      await db.collection("sound_events").insertMany(docs);
    }

    const responseData = { inserted_count: docs.length };
    if (idempotencyKey) {
      await db.collection("idempotency_keys").updateOne(
        {
          user_id: userId,
          route: idempotencyRoute,
          key: idempotencyKey,
        },
        {
          $set: {
            response_data: responseData,
            state: "done",
            updated_at: new Date(),
          },
        }
      );
    }

    sendOk(res, responseData);
  })
);

v1Router.get(
  "/events",
  asyncHandler(async (req, res) => {
    const parsedQuery = parseWithSchema(listEventsQuerySchema, req.query, res);
    if (!parsedQuery) {
      return;
    }

    const userId = req.userId as string;
    const db = getDb();
    const query: Record<string, unknown> = { user_id: userId };

    if (parsedQuery.device_id) {
      query.device_id = parsedQuery.device_id;
    }

    if (parsedQuery.from_ts || parsedQuery.to_ts) {
      const tsQuery: Record<string, Date> = {};
      if (parsedQuery.from_ts) {
        tsQuery.$gte = parsedQuery.from_ts;
      }
      if (parsedQuery.to_ts) {
        tsQuery.$lte = parsedQuery.to_ts;
      }
      if (parsedQuery.cursor) {
        tsQuery.$lt = parsedQuery.cursor;
      }
      query.ts = tsQuery;
    } else if (parsedQuery.cursor) {
      query.ts = { $lt: parsedQuery.cursor };
    }

    const items = await db
      .collection("sound_events")
      .find(query, { projection: { _id: 0 } })
      .sort({ ts: -1 })
      .limit(parsedQuery.limit)
      .toArray();

    const nextCursor =
      items.length === parsedQuery.limit
        ? (items[items.length - 1]?.ts ?? null)
        : null;

    sendOk(res, {
      items,
      next_cursor: nextCursor,
      has_more: Boolean(nextCursor),
    });
  })
);

v1Router.get(
  "/models/latest",
  asyncHandler(async (req, res) => {
    const parsedQuery = parseWithSchema(latestModelQuerySchema, req.query, res);
    if (!parsedQuery) {
      return;
    }

    const db = getDb();
    const latest = await db.collection("model_versions").findOne(
      { platform: parsedQuery.platform, channel: parsedQuery.channel },
      { sort: { version: -1 }, projection: { _id: 0 } }
    );

    if (!latest) {
      sendError(
        res,
        404,
        "No model update is available for this platform yet.",
        {
          code: "MODEL_NOT_AVAILABLE",
        }
      );
      return;
    }

    sendOk(res, latest);
  })
);

v1Router.post(
  "/models",
  writeLimiter,
  asyncHandler(async (req, res) => {
    const parsed = parseWithSchema(modelVersionSchema, req.body, res);
    if (!parsed) {
      return;
    }

    const db = getDb();
    const doc = {
      ...parsed,
      created_at: new Date(),
    };
    await db.collection("model_versions").insertOne(doc);
    sendOk(res, doc, "success", 201);
  })
);

v1Router.post(
  "/devices/register",
  writeLimiter,
  asyncHandler(async (req, res) => {
    const parsed = parseWithSchema(deviceRegisterSchema, req.body, res);
    if (!parsed) {
      return;
    }

    const userId = req.userId as string;
    const db = getDb();
    const doc = {
      user_id: userId,
      ...parsed,
      updated_at: new Date(),
    };

    const device = await db.collection("devices").findOneAndUpdate(
      { user_id: userId, device_id: parsed.device_id },
      { $set: doc },
      { upsert: true, returnDocument: "after", projection: { _id: 0 } }
    );

    sendOk(res, device ?? doc);
  })
);

v1Router.post(
  "/ai/classify",
  writeLimiter,
  asyncHandler(async (req, res) => {
    const parsed = parseWithSchema(aiClassifySchema, req.body, res);
    if (!parsed) {
      return;
    }

    if (env.AI_PROVIDER === "disabled") {
      sendError(
        res,
        503,
        "AI features are temporarily unavailable.",
        {
          code: "AI_UNAVAILABLE",
          hint: "Please try again later.",
        }
      );
      return;
    }

    if (env.AI_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
      sendError(
        res,
        503,
        "AI service is not configured yet.",
        {
          code: "AI_NOT_CONFIGURED",
          hint: "Switch to mock mode or add a valid AI key.",
        }
      );
      return;
    }

    const labels = [
      { label: "siren", priority: "emergency", confidence: 0.95 },
      { label: "car_horn", priority: "high", confidence: 0.91 },
      { label: "doorbell", priority: "medium", confidence: 0.89 },
      { label: "baby_cry", priority: "high", confidence: 0.93 },
      { label: "voice_calling_name", priority: "medium", confidence: 0.88 },
    ] as const;

    const seedBase = parsed.hint ?? parsed.device_id ?? "default";
    const seed = seedBase
      .split("")
      .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const item = labels[seed % labels.length];
    const directions = ["front", "left", "right", "back", "front_left"] as const;

    sendOk(res, {
      provider: env.AI_PROVIDER,
      device_id: parsed.device_id ?? null,
      hint: parsed.hint ?? null,
      result: {
        label: item.label,
        confidence: item.confidence,
        priority: item.priority,
        direction: directions[seed % directions.length],
        ts: new Date().toISOString(),
      },
      note:
        env.AI_PROVIDER === "mock"
          ? "Mock inference result for development; no API key required."
          : "API key detected; currently returning deterministic dev result.",
    });
  })
);

v1Router.post(
  "/feedback",
  writeLimiter,
  asyncHandler(async (req, res) => {
    const parsed = parseWithSchema(feedbackSchema, req.body, res);
    if (!parsed) {
      return;
    }

    const userId = req.userId as string;
    const db = getDb();
    const doc = {
      user_id: userId,
      ...parsed,
      created_at: new Date(),
    };
    await db.collection("feedback_reports").insertOne(doc);
    sendOk(res, null, "feedback accepted");
  })
);
