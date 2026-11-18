import type { ErrorRequestHandler, NextFunction } from "express";
import { ZodError } from "zod";
import { ApiError } from "../lib/api-error.js";
import { formatIssues } from "./validate-request.js";

interface MongoDuplicateKeyError {
  code?: number;
  keyValue?: Record<string, unknown>;
}

export const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next: NextFunction,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.status).json({
      message: error.message,
      code: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      message: "The request contains invalid data.",
      code: "VALIDATION_ERROR",
      details: formatIssues(error),
    });
    return;
  }

  const duplicate = error as MongoDuplicateKeyError;
  if (duplicate?.code === 11000) {
    res.status(409).json({
      message: "A record with these details already exists.",
      code: "CONFLICT",
    });
    return;
  }

  if (isBodyParserError(error)) {
    res.status(400).json({
      message: "The request body could not be parsed.",
      code: "BAD_REQUEST",
    });
    return;
  }

  if (isMulterError(error)) {
    res.status(422).json({
      message: error.message,
      code: "VALIDATION_ERROR",
    });
    return;
  }

  console.error("[api] Unhandled error:", error);

  res.status(500).json({
    message:
      process.env.NODE_ENV === "production"
        ? "Internal server error."
        : error instanceof Error
          ? error.message
          : "Internal server error.",
    code: "INTERNAL_ERROR",
  });
};

function isBodyParserError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    "status" in error &&
    (error as { status?: number }).status === 400
  );
}

function isMulterError(error: unknown): error is Error & { name: string } {
  return (
    error instanceof Error &&
    error.name === "MulterError"
  );
}
