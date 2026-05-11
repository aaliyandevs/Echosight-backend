import express from "express";
import { env } from "../config";
import {
  asyncHandler,
  sendError,
  sendOk,
  zodToFieldErrors,
} from "../http/api";
import { requireUserId } from "../middleware/auth";
import { createRateLimiter } from "../middleware/rateLimit";
import { detectSoundService } from "../services/sound/detect-sound-service";
import { detectSoundRequestSchema } from "../validators";

export const detectSoundRouter = express.Router();

const detectLimiter = createRateLimiter({
  max: env.DETECT_SOUND_RATE_LIMIT_MAX,
  scope: "detect-sound",
  windowMs: env.RATE_LIMIT_WINDOW_MS,
});

detectSoundRouter.post(
  "/detect-sound",
  requireUserId,
  detectLimiter,
  express.raw({
    type: ["application/octet-stream", "audio/wav", "audio/x-wav"],
    limit: env.REQUEST_BODY_LIMIT,
  }),
  asyncHandler(async (req, res) => {
    let audioBuffer: Buffer | null = null;
    let speechHint: string | undefined;

    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      audioBuffer = req.body;
    } else {
      const parsed = detectSoundRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "Some information is missing or invalid.", {
          code: "INVALID_INPUT",
          hint: "Send audioBase64 or audio binary data.",
          fields: zodToFieldErrors(parsed.error),
        });
        return;
      }

      try {
        audioBuffer = Buffer.from(parsed.data.audioBase64, "base64");
      } catch {
        sendError(res, 400, "Audio data is not valid base64.", {
          code: "INVALID_AUDIO_DATA",
          hint: "Please send a valid base64-encoded WAV chunk.",
        });
        return;
      }

      if (audioBuffer.length === 0) {
        sendError(res, 400, "Audio chunk is empty.", {
          code: "EMPTY_AUDIO",
          hint: "Please send at least 500ms of audio.",
        });
        return;
      }

      speechHint = parsed.data.speechHint;
    }

    const result = await detectSoundService.detect({
      userId: req.userId as string,
      audioBuffer,
      mimeType: req.header("content-type") ?? undefined,
      speechHint,
    });

    sendOk(res, result);
  })
);

