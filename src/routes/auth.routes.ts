import type { RequestHandler } from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { getAuth } from "../lib/auth.js";
import { asyncHandler } from "../lib/async-handler.js";
import { ApiError } from "../lib/api-error.js";
import { env } from "../config/environment.js";
import { signAccessToken } from "../lib/jwt.js";
import { findUserById } from "../lib/user-repository.js";
import { buildProfile } from "../modules/users/user.service.js";

let nodeHandler: ReturnType<typeof toNodeHandler> | null = null;

/** Better Auth's own routes, mounted at /api/auth/*. */
export const authHandler: RequestHandler = (req, res, next) => {
  if (!nodeHandler) {
    nodeHandler = toNodeHandler(getAuth());
  }
  void nodeHandler(req, res).catch(next);
};

/**
 * Exchanges the HttpOnly Better Auth session cookie for a short-lived JWT.
 * The browser keeps the token in memory only; the cookie remains the source of
 * truth for refreshing it.
 */
export const issueTokenHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    const session = await getAuth().api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user?.id) {
      throw ApiError.unauthorized("Sign in to continue.");
    }

    const user = await findUserById(session.user.id);

    if (!user) {
      throw ApiError.unauthorized("This account no longer exists.");
    }

    if (user.isBlocked) {
      throw ApiError.forbidden(
        "This account has been blocked by an administrator.",
      );
    }

    const token = await signAccessToken({ sub: user.id, role: user.role });

    res.status(200).json({
      token,
      expiresIn: env.jwtExpiresIn,
      user: buildProfile(user),
    });
  },
);
