import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError, z } from "zod";
import type { ApiError } from "@lms/shared";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";

function send(res: Response, status: number, body: ApiError) {
  res.status(status).json(body);
}

export function notFoundHandler(_req: Request, res: Response) {
  send(res, 404, { error: { code: "not_found", message: "Route not found" } });
}

// Express recognises error handlers by their four arguments.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return send(res, err.status, {
      error: { code: err.code, message: err.message, fields: err.fields, details: err.details },
    });
  }

  if (err instanceof ZodError) {
    const { fieldErrors } = z.flattenError(err);
    return send(res, 400, {
      error: {
        code: "validation_error",
        message: "Please check the highlighted fields",
        fields: fieldErrors as Record<string, string[]>,
      },
    });
  }

  if (err instanceof SyntaxError && "body" in err) {
    return send(res, 400, { error: { code: "bad_json", message: "Request body is not valid JSON" } });
  }

  // Body-parser: too large, wrong encoding... These carry their own 4xx status.
  if (typeof err === "object" && err && "type" in err && "status" in err && typeof err.status === "number" && err.status < 500) {
    if (err.type === "entity.too.large") {
      return send(res, 413, { error: { code: "too_large", message: "That request is too large" } });
    }
    return send(res, err.status, { error: { code: "bad_request", message: "The request couldn't be read" } });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // A malformed id (e.g. /orders/123) can't match anything: same as not found.
    if (err.code === "P2023") {
      return send(res, 404, { error: { code: "not_found", message: "Not found" } });
    }
    if (err.code === "P2002") {
      return send(res, 409, { error: { code: "conflict", message: "This record already exists" } });
    }
    if (err.code === "P2025") {
      return send(res, 404, { error: { code: "not_found", message: "Not found" } });
    }
  }

  // Values Prisma can't use at all (e.g. an impossible date that slipped past validation).
  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.warn({ path: req.path }, "request reached the database with invalid values");
    return send(res, 400, { error: { code: "bad_request", message: "Some values in the request aren't valid" } });
  }

  if (process.env.API_LOG) console.error("UNHANDLED", err);
  logger.error({ err, path: req.path }, "unhandled error");
  send(res, 500, { error: { code: "internal_error", message: "Something went wrong" } });
}
