import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

/** Parses req.body with the schema and replaces it with the parsed value. */
export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    // A ZodError thrown here is turned into a 400 by the error handler.
    req.body = schema.parse(req.body ?? {});
    next();
  };
}
