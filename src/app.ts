import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";
import { corsOrigins, env } from "./config";
import { sendError, zodToFieldErrors } from "./http/api";
import { requireUserId } from "./middleware/auth";
import { createRateLimiter } from "./middleware/rateLimit";
import { attachRequestId } from "./middleware/requestId";
import { detectSoundRouter } from "./routes/detect-sound";
import { healthRouter } from "./routes/health";
import { v1Router } from "./routes/v1";

export const createApp = () => {
  const app = express();
  const allowAnyOrigin = corsOrigins.includes("*");

  morgan.token("request_id", (req) => (req as express.Request).requestId ?? "-");

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (allowAnyOrigin || !origin || corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("CORS blocked for this origin"));
      },
    })
  );
  app.use(attachRequestId);
  app.use(express.json({ limit: env.REQUEST_BODY_LIMIT }));
  app.use(morgan(":method :url :status :response-time ms req_id=:request_id"));

  app.use(healthRouter);
  app.use(detectSoundRouter);
  app.use(
    "/v1",
    requireUserId,
    createRateLimiter({
      max: env.RATE_LIMIT_READ_MAX,
      scope: "api-read",
      windowMs: env.RATE_LIMIT_WINDOW_MS,
    }),
    v1Router
  );

  app.get("/", (_req, res) => {
    res.status(200).json({
      ok: true,
      message: "Welcome to the Echosight API!",
      status: "Running"
    });
  });

  app.use((_req, res) => {
    sendError(res, 404, "We couldn't find that endpoint.", {
      code: "NOT_FOUND",
      hint: "Please check the URL and try again.",
    });
  });

  app.use((error: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error.message === "CORS blocked for this origin") {
      sendError(res, 403, "This request is not allowed from your current app origin.", {
        code: "FORBIDDEN",
        hint: "Please contact support if this app domain should be allowed.",
        request_id: req.requestId ?? null,
      });
      return;
    }

    if (error instanceof ZodError) {
      sendError(res, 400, "Some information is missing or invalid.", {
        code: "INVALID_INPUT",
        hint: "Please review your input and try again.",
        fields: zodToFieldErrors(error),
        request_id: req.requestId ?? null,
      });
      return;
    }

    sendError(res, 500, "Something went wrong on our side. Please try again.", {
      code: "INTERNAL_ERROR",
      request_id: req.requestId ?? null,
    });
  });

  return app;
};
