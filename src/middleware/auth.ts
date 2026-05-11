import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config";
import { sendError } from "../http/api";

export const requireUserId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (env.AUTH_MODE === "jwt") {
    const authHeader = req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      sendError(res, 401, "Please sign in to continue.", {
        code: "AUTH_REQUIRED",
        hint: "A valid Bearer token is required.",
      });
      return;
    }

    const token = authHeader.slice("Bearer ".length).trim();

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET as string);
      const userId =
        typeof decoded === "string"
          ? decoded
          : ((decoded.sub as string | undefined) ??
            (decoded.user_id as string | undefined) ??
            (decoded.uid as string | undefined));

      if (!userId) {
        sendError(res, 401, "We couldn't verify your sign-in session.", {
          code: "AUTH_INVALID",
          hint: "Please sign in again.",
        });
        return;
      }

      req.userId = userId;
      next();
      return;
    } catch {
      sendError(res, 401, "Your session has expired or is invalid.", {
        code: "AUTH_INVALID",
        hint: "Please sign in again.",
      });
      return;
    }
  }

  const userId = req.header("X-User-Id");

  if (!userId) {
    sendError(res, 401, "Please sign in to continue.", {
      code: "AUTH_REQUIRED",
      hint: "User identity header is required.",
    });
    return;
  }

  req.userId = userId;
  next();
};
