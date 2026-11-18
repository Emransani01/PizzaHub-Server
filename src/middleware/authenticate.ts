import type { RequestHandler } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { ApiError } from "../lib/api-error.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { findUserById } from "../lib/user-repository.js";

/**
 * Verifies the Bearer JWT (signature, issuer, audience, expiry) and then loads
 * the account from MongoDB so role, block and subscription changes take effect
 * immediately instead of waiting for the token to expire.
 */
export const authenticate: RequestHandler = asyncHandler(
  async (req, _res, next) => {
    const header = req.headers.authorization ?? "";
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
