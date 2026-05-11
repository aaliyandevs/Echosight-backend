import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { createServer, Server } from "node:http";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

type JsonRecord = Record<string, unknown>;

type HttpResult = {
  status: number;
  json: JsonRecord;
};

const normalizeMongoUri = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("mongodb://") || trimmed.startsWith("mongodb+srv://")) {
    return trimmed;
  }

  return `mongodb://${trimmed}`;
};

const createSilentWavBase64 = (sampleRate = 16_000, durationMs = 600): string => {
  const sampleCount = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, 4, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, 4, "ascii");
  buffer.write("fmt ", 12, 4, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, 4, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  return buffer.toString("base64");
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
};

test(
  "API integration with MongoDB",
  {
    timeout: 180_000,
  },
  async () => {
  const useExternalMongo = process.env.INTEGRATION_USE_EXTERNAL_MONGO === "1";
  const externalMongoUri = useExternalMongo
    ? normalizeMongoUri(process.env.INTEGRATION_MONGODB_URI)
    : undefined;
  let managedMongod: MongoMemoryServer | null = null;
  let mongoUri = externalMongoUri;

  if (!mongoUri) {
    console.log("[integration] starting mongodb-memory-server...");
    managedMongod = await withTimeout(
      MongoMemoryServer.create({
        binary: {
          version: "7.0.14",
        },
      }),
      120_000,
      "Timed out while starting mongodb-memory-server. Set INTEGRATION_MONGODB_URI to use an existing Mongo instance."
    );
    mongoUri = managedMongod.getUri();
    console.log("[integration] mongodb-memory-server ready");
  }

  process.env.NODE_ENV = "test";
  process.env.PORT = "8000";
  process.env.MONGODB_URI = mongoUri;
  process.env.MONGODB_DB_NAME = "echosight_test";
  process.env.CORS_ORIGINS = "*";
  process.env.REQUEST_BODY_LIMIT = "1mb";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  process.env.RATE_LIMIT_READ_MAX = "1000";
  process.env.RATE_LIMIT_WRITE_MAX = "1000";
  process.env.AUTH_MODE = "header";
  process.env.JWT_SECRET = "integration_test_secret_123456";
  process.env.AI_PROVIDER = "mock";
  process.env.OPENAI_API_KEY = "";
  process.env.SOUND_CLASSIFIER_MODE = "mock";
  process.env.STT_MODE = "mock";
  process.env.YAMNET_CLASS_MAP_PATH = "";
  process.env.WHISPER_CPP_COMMAND = "";

  const { env, configValidation } = await import("../src/config");
  if (!configValidation.ok) {
    if (managedMongod) {
      await managedMongod.stop();
    }
    throw new Error(configValidation.message);
  }
  if (!env.MONGODB_URI.startsWith("mongodb://") && !env.MONGODB_URI.startsWith("mongodb+srv://")) {
    if (managedMongod) {
      await managedMongod.stop();
    }
    throw new Error(`Invalid MONGODB_URI for integration tests: "${env.MONGODB_URI}"`);
  }

  const { connectToMongo, closeMongo } = await import("../src/db/mongo");
  const { createApp } = await import("../src/app");
  const app = createApp();

  let server: Server | null = null;

  const request = async (
    method: string,
    path: string,
    options?: {
      headers?: Record<string, string>;
      body?: JsonRecord;
    }
  ): Promise<HttpResult> => {
    if (!server) {
      throw new Error("Server not started");
    }
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const headers: Record<string, string> = {
      ...(options?.headers ?? {}),
    };
    if (options?.body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await withTimeout(
      fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
      }),
      15_000,
      `Timed out waiting for response to ${method} ${path}`
    ).catch((error) => {
      throw new Error(`Request failed for ${method} ${path}: ${(error as Error).message}`);
    });

    const text = await withTimeout(
      response.text(),
      10_000,
      `Timed out while reading response body for ${method} ${path}`
    );
    const json = text.length > 0 ? (JSON.parse(text) as JsonRecord) : {};

    return {
      status: response.status,
      json,
    };
  };

  try {
    console.log("[integration] connecting to Mongo...");
    await connectToMongo();
    console.log("[integration] connected to Mongo");

    await withTimeout(
      new Promise<void>((resolve) => {
        const httpServer = createServer(app);
        httpServer.listen(0, () => {
          server = httpServer;
          console.log("[integration] HTTP server listening");
          resolve();
        });
      }),
      15_000,
      "Timed out while starting integration HTTP server"
    );

    {
      const health = await request("GET", "/health");
      assert.equal(health.status, 200);
      assert.equal(health.json.ok, true);

      const ready = await request("GET", "/ready");
      assert.equal(ready.status, 200);
      assert.equal(ready.json.ok, true);
    }

    {
      const unauth = await request("GET", "/v1/profiles/me");
      assert.equal(unauth.status, 401);
      assert.equal(unauth.json.ok, false);
    }

    const authHeaders = {
      "X-User-Id": "integration-user",
    };

    {
      const getUser = await request("GET", "/v1/users/me", {
        headers: authHeaders,
      });
      assert.equal(getUser.status, 200);

      const setUser = await request("PUT", "/v1/users/me", {
        headers: authHeaders,
        body: {
          name: "Shayan",
        },
      });
      assert.equal(setUser.status, 200);
      assert.equal((setUser.json.data as JsonRecord).name, "Shayan");
    }

    {
      const profileDefault = await request("GET", "/v1/profiles/me", {
        headers: authHeaders,
      });
      assert.equal(profileDefault.status, 200);
      assert.equal(profileDefault.json.ok, true);

      const profileData = profileDefault.json.data as JsonRecord;
      assert.equal(profileData.user_id, "integration-user");
      assert.equal(profileData.sensitivity, 0.5);

      const profileUpdate = await request("PUT", "/v1/profiles/me", {
        headers: authHeaders,
        body: {
          monitored_sounds: ["siren", "doorbell"],
          priority_overrides: {
            siren: "emergency",
          },
          haptic_patterns: {
            siren: "long_pulse",
          },
          sensitivity: 0.72,
        },
      });
      assert.equal(profileUpdate.status, 200);
      const updatedData = profileUpdate.json.data as JsonRecord;
      assert.equal(updatedData.sensitivity, 0.72);
    }

    {
      const firstBatch = await request("POST", "/v1/events/batch", {
        headers: {
          ...authHeaders,
          "Idempotency-Key": "batch-001",
        },
        body: {
          events: [
            {
              device_id: "pixel-8",
              label: "siren",
              confidence: 0.96,
              priority: "emergency",
              direction: "front_left",
              ts: "2026-04-03T10:30:00.000Z",
            },
          ],
        },
      });
      assert.equal(firstBatch.status, 200);
      assert.equal((firstBatch.json.data as JsonRecord).inserted_count, 1);

      const replayBatch = await request("POST", "/v1/events/batch", {
        headers: {
          ...authHeaders,
          "Idempotency-Key": "batch-001",
        },
        body: {
          events: [
            {
              device_id: "pixel-8",
              label: "siren",
              confidence: 0.96,
              priority: "emergency",
              direction: "front_left",
              ts: "2026-04-03T10:30:00.000Z",
            },
          ],
        },
      });
      assert.equal(replayBatch.status, 200);
      assert.equal(
        (replayBatch.json.data as JsonRecord).idempotent_replay,
        true
      );

      const secondBatch = await request("POST", "/v1/events/batch", {
        headers: authHeaders,
        body: {
          events: [
            {
              device_id: "pixel-8",
              label: "car_horn",
              confidence: 0.91,
              priority: "high",
              direction: "right",
              ts: "2026-04-03T10:20:00.000Z",
            },
          ],
        },
      });
      assert.equal(secondBatch.status, 200);

      const page1 = await request(
        "GET",
        "/v1/events?device_id=pixel-8&limit=1",
        {
          headers: authHeaders,
        }
      );
      assert.equal(page1.status, 200);

      const page1Data = page1.json.data as JsonRecord;
      assert.equal(page1Data.has_more, true);
      const nextCursor = page1Data.next_cursor as string;
      assert.equal(typeof nextCursor, "string");

      const page2 = await request(
        "GET",
        `/v1/events?device_id=pixel-8&limit=1&cursor=${encodeURIComponent(
          nextCursor
        )}`,
        {
          headers: authHeaders,
        }
      );
      assert.equal(page2.status, 200);
      const page2Data = page2.json.data as JsonRecord;
      const page2Items = page2Data.items as unknown[];
      assert.equal(page2Items.length, 1);
    }

    {
      const createModel = await request("POST", "/v1/models", {
        headers: authHeaders,
        body: {
          platform: "android",
          channel: "stable",
          version: 99,
          model_name: "yamnet-v2-q8",
          download_url: "https://example.com/yamnet-v2-q8.tflite",
          checksum_sha256: "abc123",
          min_app_version: "0.1.0",
        },
      });
      assert.equal(createModel.status, 201);

      const latestModel = await request(
        "GET",
        "/v1/models/latest?platform=android&channel=stable",
        {
          headers: authHeaders,
        }
      );
      assert.equal(latestModel.status, 200);
      const latestData = latestModel.json.data as JsonRecord;
      assert.equal(latestData.version, 99);
    }

    {
      const deviceRegister = await request("POST", "/v1/devices/register", {
        headers: authHeaders,
        body: {
          device_id: "pixel-8",
          platform: "android",
          device_model: "Google Pixel 8",
          os_version: "15",
          app_version: "0.1.0",
        },
      });
      assert.equal(deviceRegister.status, 200);

      const feedback = await request("POST", "/v1/feedback", {
        headers: authHeaders,
        body: {
          type: "false_alert",
          device_id: "pixel-8",
          label: "siren",
          note: "Integration test feedback",
          event_ts: "2026-04-03T10:30:00.000Z",
        },
      });
      assert.equal(feedback.status, 200);

      const aiClassify = await request("POST", "/v1/ai/classify", {
        headers: authHeaders,
        body: {
          hint: "traffic noise",
          device_id: "pixel-8",
        },
      });
      assert.equal(aiClassify.status, 200);
      const aiData = aiClassify.json.data as JsonRecord;
      assert.equal(aiData.provider, "mock");

      const detectSound = await request("POST", "/detect-sound", {
        headers: authHeaders,
        body: {
          audioBase64: createSilentWavBase64(),
          speechHint: "Shayan please answer",
        },
      });
      assert.equal(detectSound.status, 200);
      assert.equal(detectSound.json.ok, true);
    }
  } finally {
    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
    }
    await closeMongo();
    if (managedMongod) {
      await managedMongod.stop();
    }
  }
  }
);
