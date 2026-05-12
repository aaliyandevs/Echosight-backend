import crypto from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config";
import { getDb } from "../db/mongo";
import { asyncHandler, sendError, sendOk, zodToFieldErrors } from "../http/api";
import { createRateLimiter } from "../middleware/rateLimit";

export const authRouter = Router();

const authLimiter = createRateLimiter({
  max: 30,
  scope: "auth",
  windowMs: env.RATE_LIMIT_WINDOW_MS,
});

const credentialsSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80).optional(),
});

const loginSchema = credentialsSchema.pick({ email: true, password: true });
const refreshSchema = z.object({ refreshToken: z.string().min(32) });

type AuthUser = {
  user_id: string;
  email: string;
  name: string | null;
  password_hash: string;
  password_salt: string;
  created_at: Date;
  updated_at: Date;
};

const getJwtSecret = (): string => {
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required for auth endpoints");
  }
  return env.JWT_SECRET;
};

const hashPassword = (password: string, salt = crypto.randomBytes(16).toString("hex")) => {
  const hash = crypto.pbkdf2Sync(password, salt, 120_000, 64, "sha512").toString("hex");
  return { hash, salt };
};

const verifyPassword = (password: string, user: AuthUser): boolean => {
  const { hash } = hashPassword(password, user.password_salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.password_hash, "hex"));
};

const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

const issueTokenPair = async (user: Pick<AuthUser, "user_id" | "email" | "name">) => {
  const accessToken = jwt.sign(
    { sub: user.user_id, email: user.email, name: user.name },
    getJwtSecret(),
    { expiresIn: env.JWT_ACCESS_TOKEN_TTL_SECONDS }
  );
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.JWT_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await getDb().collection("refresh_tokens").insertOne({
    token_hash: sha256(refreshToken),
    user_id: user.user_id,
    created_at: now,
    expires_at: expiresAt,
    revoked_at: null,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: env.JWT_ACCESS_TOKEN_TTL_SECONDS,
    tokenType: "Bearer",
    user: {
      user_id: user.user_id,
      email: user.email,
      name: user.name,
    },
  };
};

authRouter.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "Some information is missing or invalid.", {
        code: "INVALID_INPUT",
        fields: zodToFieldErrors(parsed.error),
      });
      return;
    }

    const db = getDb();
    const existing = await db.collection<AuthUser>("users").findOne({ email: parsed.data.email });
    if (existing) {
      sendError(res, 409, "An account already exists for this email.", {
        code: "ACCOUNT_EXISTS",
      });
      return;
    }

    const userId = crypto.randomUUID();
    const now = new Date();
    const password = hashPassword(parsed.data.password);
    const user: AuthUser = {
      user_id: userId,
      email: parsed.data.email,
      name: parsed.data.name?.trim() ?? null,
      password_hash: password.hash,
      password_salt: password.salt,
      created_at: now,
      updated_at: now,
    };

    await db.collection<AuthUser>("users").insertOne(user);
    sendOk(res, await issueTokenPair(user), "registered", 201);
  })
);

authRouter.post(
  "/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "Some information is missing or invalid.", {
        code: "INVALID_INPUT",
        fields: zodToFieldErrors(parsed.error),
      });
      return;
    }

    const user = await getDb().collection<AuthUser>("users").findOne({ email: parsed.data.email });
    if (!user || !verifyPassword(parsed.data.password, user)) {
      sendError(res, 401, "Email or password is incorrect.", {
        code: "INVALID_CREDENTIALS",
      });
      return;
    }

    sendOk(res, await issueTokenPair(user), "authenticated");
  })
);

authRouter.post(
  "/refresh",
  authLimiter,
  asyncHandler(async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "Refresh token is missing or invalid.", {
        code: "INVALID_INPUT",
        fields: zodToFieldErrors(parsed.error),
      });
      return;
    }

    const db = getDb();
    const tokenHash = sha256(parsed.data.refreshToken);
    const stored = await db.collection("refresh_tokens").findOne({
      token_hash: tokenHash,
      revoked_at: null,
      expires_at: { $gt: new Date() },
    });

    if (!stored) {
      sendError(res, 401, "Your session has expired. Please sign in again.", {
        code: "REFRESH_INVALID",
      });
      return;
    }

    await db.collection("refresh_tokens").updateOne(
      { token_hash: tokenHash },
      { $set: { revoked_at: new Date() } }
    );

    const user = await db.collection<AuthUser>("users").findOne({ user_id: stored.user_id });
    if (!user) {
      sendError(res, 401, "Your account could not be found. Please sign in again.", {
        code: "USER_NOT_FOUND",
      });
      return;
    }

    sendOk(res, await issueTokenPair(user), "refreshed");
  })
);

authRouter.post(
  "/logout",
  authLimiter,
  asyncHandler(async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (parsed.success) {
      await getDb().collection("refresh_tokens").updateOne(
        { token_hash: sha256(parsed.data.refreshToken) },
        { $set: { revoked_at: new Date() } }
      );
    }

    sendOk(res, null, "logged out");
  })
);
