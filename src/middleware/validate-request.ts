import type { RequestHandler } from "express";
import { ZodError, type ZodType } from "zod";
import { ApiError } from "../lib/api-error.js";

export interface RequestSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export function formatIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "request",
    message: issue.message,
  }));
}

/**
 * Parses and sanitises the request with Zod. Parsed values are exposed through
 * `req.validated` so controllers never read raw client input.
 */
export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      const validated: NonNullable<typeof req.validated> = {};

      if (schemas.params) {
        validated.params = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        validated.query = schemas.query.parse(req.query ?? {});
      }
      if (schemas.body) {
        validated.body = schemas.body.parse(req.body ?? {});
      }

      req.validated = validated;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          ApiError.unprocessable(
            "The request contains invalid data.",
            formatIssues(error),
          ),
        );
        return;
      }
      next(error);
    }
  };
}

export function validatedBody<T>(req: { validated?: { body?: unknown } }): T {
  return req.validated?.body as T;
}

export function validatedQuery<T>(req: { validated?: { query?: unknown } }): T {
  return req.validated?.query as T;
}

export function validatedParams<T>(req: { validated?: { params?: unknown } }): T {
  return req.validated?.params as T;
}
