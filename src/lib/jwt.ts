import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/environment.js";
import { ApiError } from "./api-error.js";
import type { UserRole } from "../types/index.js";

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

const secret = () => new TextEncoder().encode(env.jwtSecret);

export async function signAccessToken(
  payload: AccessTokenPayload,
): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.sub)
    .setIssuer(env.jwtIssuer)
    .setAudience(env.jwtAudience)
    .setIssuedAt()
    .setExpirationTime(env.jwtExpiresIn)
    .sign(secret());
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
      algorithms: ["HS256"],
    });

    const sub = payload.sub;
    const role = payload.role;

    if (typeof sub !== "string" || sub.length === 0) {
      throw ApiError.unauthorized("Token is missing a subject.");
    }
    if (role !== "customer" && role !== "vendor" && role !== "admin") {
      throw ApiError.unauthorized("Token has an invalid role.");
    }

    return { sub, role };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw ApiError.unauthorized("Invalid or expired token.");
  }
}
