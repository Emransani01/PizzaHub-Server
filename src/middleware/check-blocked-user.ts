import type { RequestHandler } from "express";
import { ApiError } from "../lib/api-error.js";

/**
 * Runs after `authenticate`. The user document was re-read from MongoDB, so a
 * block applied a second ago is already visible here.
 */
export const checkBlockedUser: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(ApiError.unauthorized());
    return;
  }

  if (req.user.isBlocked) {
    next(
      ApiError.forbidden(
        "This account has been blocked by an administrator.",
      ),
    );
    return;
  }

  next();
};
