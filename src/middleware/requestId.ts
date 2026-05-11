import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";

export const attachRequestId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const incoming = req.header("X-Request-Id");
  const requestId = incoming && incoming.trim().length > 0 ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
};

