export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    message: string,
    options: { code?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = options.code ?? defaultCode(status);
    this.details = options.details;
  }

  static unauthorized(message = "Authentication required."): ApiError {
    return new ApiError(401, message, { code: "UNAUTHORIZED" });
  }

  static forbidden(message = "You do not have access to this resource."): ApiError {
    return new ApiError(403, message, { code: "FORBIDDEN" });
  }

  static notFound(message = "Resource not found."): ApiError {
    return new ApiError(404, message, { code: "NOT_FOUND" });
  }

  static badRequest(message = "Invalid request."): ApiError {
    return new ApiError(400, message, { code: "BAD_REQUEST" });
  }

  static conflict(message = "Request conflicts with the current state."): ApiError {
    return new ApiError(409, message, { code: "CONFLICT" });
  }

  static unprocessable(message = "Validation failed.", details?: unknown): ApiError {
    return new ApiError(422, message, { code: "VALIDATION_ERROR", details });
  }

  static unavailable(message = "Service is not configured."): ApiError {
    return new ApiError(503, message, { code: "SERVICE_UNAVAILABLE" });
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "VALIDATION_ERROR";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return "INTERNAL_ERROR";
  }
}
