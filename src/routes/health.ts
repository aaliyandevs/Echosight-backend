import { Router } from "express";
import { sendError, sendOk } from "../http/api";
import { pingMongo } from "../db/mongo";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  sendOk(
    res,
    {
      service: "echosight-backend",
      uptime_seconds: Math.round(process.uptime()),
      now: new Date().toISOString(),
    },
    "EchoSight backend is healthy"
  );
});

healthRouter.get("/ready", async (_req, res) => {
  const mongoOk = await pingMongo();
  if (!mongoOk) {
    sendError(res, 503, "Service is still starting up. Please try again shortly.", {
      code: "SERVICE_UNAVAILABLE",
      hint: "Database connection is not ready yet.",
    });
    return;
  }

  sendOk(
    res,
    {
      mongo: "up",
    },
    "Service is ready"
  );
});
