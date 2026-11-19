export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>,
    /** Extra data for the client, e.g. duplicate candidates. */
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, fields?: Record<string, string[]>) =>
  new AppError(400, "bad_request", message, fields);
export const unauthorized = (message = "Please sign in again") =>
  new AppError(401, "unauthorized", message);
export const forbidden = (message = "You don't have permission to do this") =>
  new AppError(403, "forbidden", message);
export const notFound = (message = "Not found") => new AppError(404, "not_found", message);
export const conflict = (message: string, fields?: Record<string, string[]>) =>
  new AppError(409, "conflict", message, fields);
export const tooManyRequests = (message = "Too many attempts. Try again later.") =>
  new AppError(429, "rate_limited", message);
