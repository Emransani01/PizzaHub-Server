import type { RequestHandler } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { ApiError } from "../lib/api-error.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { findUserById } from "../lib/user-repository.js";

/**
 * Attaches `req.user` when a valid Bearer token is supplied, and continues
 * anonymously when no token is present. A malformed or expired token is still
 * rejected so a broken client cannot silently lose its privileges.
 */
export const optionalAuthenticate: RequestHandler = asyncHandler(
  async (req, _res, next) => {
    const header = req.headers.authorization;

    if (!header) {
      next();
      return;
    }

    const [scheme, token] = header.split(" ");
    if (!token || scheme.toLowerCase() !== "bearer") {
      throw ApiError.unauthorized("A Bearer access token is required.");
    }

    const payload = await verifyAccessToken(token);
    const user = await findUserById(payload.sub);
    if (!user) {
      throw ApiError.unauthorized("This account no longer exists.");
    }

    req.user = user;
    next();
  },
);
