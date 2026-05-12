import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB_NAME: z.string().min(1).default("echosight"),
  CORS_ORIGINS: z.string().default("*"),
  REQUEST_BODY_LIMIT: z.string().default("1mb"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_READ_MAX: z.coerce.number().int().positive().default(180),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().positive().default(60),
  DETECT_SOUND_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(240),
  AUTH_MODE: z.enum(["header", "jwt"]).default("header"),
  JWT_SECRET: z.string().min(16).optional(),
  JWT_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  AI_PROVIDER: z.enum(["mock", "openai", "disabled"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  WEBRTC_STUN_URLS: z.string().default("stun:stun.l.google.com:19302"),
  WEBRTC_TURN_URLS: z.string().optional(),
  WEBRTC_TURN_USERNAME: z.string().optional(),
  WEBRTC_TURN_CREDENTIAL: z.string().optional(),
  SOUND_CLASSIFIER_MODE: z.enum(["mock", "yamnet"]).default("mock"),
  YAMNET_MODEL_URL: z
    .string()
    .default("https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1"),
  YAMNET_CLASS_MAP_PATH: z.string().optional(),
  STT_MODE: z.enum(["mock", "whisper_cpp", "disabled"]).default("mock"),
  WHISPER_CPP_COMMAND: z.string().optional(),
  STT_EXEC_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
  SPEECH_STT_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  USER_NAME_CACHE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  ALERT_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
}).superRefine((value, ctx) => {
  if (value.AUTH_MODE === "jwt" && !value.JWT_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message: "JWT_SECRET is required when AUTH_MODE=jwt",
    });
  }

  if (value.MONGODB_URI.includes("<db_password>")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MONGODB_URI"],
      message: "Please replace <db_password> with your real MongoDB password in backend/.env",
    });
  }
});

const parsedEnv = envSchema.safeParse(process.env);

const fallbackEnv: z.infer<typeof envSchema> = {
  NODE_ENV: "development",
  PORT: 8000,
  MONGODB_URI: "",
  MONGODB_DB_NAME: "echosight",
  CORS_ORIGINS: "*",
  REQUEST_BODY_LIMIT: "1mb",
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_READ_MAX: 180,
  RATE_LIMIT_WRITE_MAX: 60,
  DETECT_SOUND_RATE_LIMIT_MAX: 240,
  AUTH_MODE: "header",
  JWT_SECRET: undefined,
  JWT_ACCESS_TOKEN_TTL_SECONDS: 900,
  JWT_REFRESH_TOKEN_TTL_DAYS: 30,
  AI_PROVIDER: "mock",
  OPENAI_API_KEY: undefined,
  WEBRTC_STUN_URLS: "stun:stun.l.google.com:19302",
  WEBRTC_TURN_URLS: undefined,
  WEBRTC_TURN_USERNAME: undefined,
  WEBRTC_TURN_CREDENTIAL: undefined,
  SOUND_CLASSIFIER_MODE: "mock",
  YAMNET_MODEL_URL: "https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1",
  YAMNET_CLASS_MAP_PATH: undefined,
  STT_MODE: "mock",
  WHISPER_CPP_COMMAND: undefined,
  STT_EXEC_TIMEOUT_MS: 12_000,
  SPEECH_STT_MIN_CONFIDENCE: 0.6,
  USER_NAME_CACHE_TTL_MS: 60_000,
  ALERT_MIN_CONFIDENCE: 0.7,
};

export const env = parsedEnv.success ? parsedEnv.data : fallbackEnv;

export const configValidation = parsedEnv.success
  ? { ok: true as const, message: "" }
  : {
      ok: false as const,
      message: [
        "Configuration error in backend/.env.",
        ...parsedEnv.error.issues.map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "env";
          return `- ${path}: ${issue.message}`;
        }),
      ].join("\n"),
    };

export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((item) => item.trim())
  .filter(Boolean);
