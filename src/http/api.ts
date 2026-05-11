import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

export type FieldError = {
  field: string;
  message: string;
};

export type ErrorDetails = {
  code?: string;
  hint?: string;
  fields?: FieldError[];
  retry_after_seconds?: number;
  request_id?: string | null;
};

const defaultCode = (statusCode: number): string => {
  if (statusCode === 400) return "INVALID_INPUT";
  if (statusCode === 401) return "AUTH_REQUIRED";
  if (statusCode === 403) return "FORBIDDEN";
  if (statusCode === 404) return "NOT_FOUND";
  if (statusCode === 409) return "CONFLICT";
  if (statusCode === 429) return "RATE_LIMITED";
  return "REQUEST_FAILED";
};

export const sendOk = (
  res: Response,
  data: unknown = null,
  message = "success",
  statusCode = 200
) => {
  return res.status(statusCode).json({
    ok: true,
    message,
    data,
  });
};

export const sendError = (
  res: Response,
  statusCode: number,
  message: string,
  details?: ErrorDetails
) => {
  const code = details?.code ?? defaultCode(statusCode);
  return res.status(statusCode).json({
    ok: false,
    message,
    errors: {
      code,
      hint: details?.hint ?? null,
      fields: details?.fields ?? [],
      retry_after_seconds: details?.retry_after_seconds ?? null,
      request_id: details?.request_id ?? null,
    },
  });
};

export const zodToFieldErrors = (error: ZodError): FieldError[] => {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "body",
    message: issue.message,
  }));
};

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
