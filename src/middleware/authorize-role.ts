import type { RequestHandler } from "express";
import { ApiError } from "../lib/api-error.js";
import type { UserRole } from "../types/index.js";

/**
 * Role gate for protected routes. Must be mounted after `authenticate`.
 * Returns 403 (never 404) so a wrong-role caller cannot probe existence.
 */
export function authorizeRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(
        ApiError.forbidden(
          `This action requires one of the following roles: ${roles.join(", ")}.`,
        ),
      );
      return;
    }

    next();
  };
}
