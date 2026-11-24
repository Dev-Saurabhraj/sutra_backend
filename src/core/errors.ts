/** One error type for the whole API. The error handler turns it into `{ error: { code, message, details } }`. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new AppError(400, code, message, details);
  }
  static unauthorized(message = "Please log in again") {
    return new AppError(401, "UNAUTHORIZED", message);
  }
  static forbidden(message = "You cannot do this") {
    return new AppError(403, "FORBIDDEN", message);
  }
  static notFound(what: string) {
    return new AppError(404, "NOT_FOUND", `${what} not found`);
  }
  static conflict(code: string, message: string) {
    return new AppError(409, code, message);
  }
  static tooMany(message = "Too many attempts. Please wait and try again.") {
    return new AppError(429, "TOO_MANY_REQUESTS", message);
  }
}
