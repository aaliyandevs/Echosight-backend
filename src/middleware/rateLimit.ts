import { NextFunction, Request, Response } from "express";
import { sendError } from "../http/api";

type RateLimiterOptions = {
  max: number;
  scope: string;
  windowMs: number;
};

type Bucket = {
  count: number;
  resetAtMs: number;
};

const buckets = new Map<string, Bucket>();
const CLEANUP_THRESHOLD = 5_000;

const getClientKey = (req: Request, scope: string): string => {
  const userPart = req.userId ?? "anonymous";
  const ipPart = req.ip ?? "unknown-ip";
  return `${scope}:${userPart}:${ipPart}`;
};

export const createRateLimiter = (options: RateLimiterOptions) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();

    if (buckets.size > CLEANUP_THRESHOLD) {
      for (const [bucketKey, bucketValue] of buckets.entries()) {
        if (now >= bucketValue.resetAtMs) {
          buckets.delete(bucketKey);
        }
      }
    }

    const key = getClientKey(req, options.scope);
    const current = buckets.get(key);

    let bucket = current;
    if (!bucket || now >= bucket.resetAtMs) {
      bucket = {
        count: 0,
        resetAtMs: now + options.windowMs,
      };
      buckets.set(key, bucket);
    }

    if (bucket.count >= options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAtMs - now) / 1000));
      res.setHeader("Retry-After", retryAfter.toString());
      sendError(
        res,
        429,
        "You're sending requests too quickly. Please try again shortly.",
        {
          code: "RATE_LIMITED",
          hint: "Wait a few seconds before retrying.",
          retry_after_seconds: retryAfter,
        }
      );
      return;
    }

    bucket.count += 1;
    const remaining = Math.max(0, options.max - bucket.count);
    const resetAfter = Math.max(0, Math.ceil((bucket.resetAtMs - now) / 1000));

    res.setHeader("X-RateLimit-Limit", options.max.toString());
    res.setHeader("X-RateLimit-Remaining", remaining.toString());
    res.setHeader("X-RateLimit-Reset", resetAfter.toString());

    next();
  };
};
