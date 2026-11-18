import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { env } from "../config/environment.js";
import { getDb, getMongoClient } from "./mongo.js";

/**
 * Better Auth only enforces a minimum length, so the stronger rule from the
 * project brief (at least one uppercase and one lowercase letter) is checked
 * before the account is created. The same rule is mirrored in the client form.
 */
const passwordPolicy = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/sign-up/email") return;

  const body = ctx.body as { password?: unknown } | undefined;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!/^(?=.*[a-z])(?=.*[A-Z]).{6,}$/.test(password)) {
    throw new APIError("BAD_REQUEST", {
      message:
        "Password must be at least 6 characters long and include an uppercase and a lowercase letter.",
    });
  }
});

/**
 * Better Auth is created lazily so importing this module never opens a database
 * connection. Tests and scripts can therefore import it safely.
 *
 * The adapter runs with `transaction: false` because a single-node Atlas dev
 * cluster (and mongodb-memory-server) may not support multi-document
 * transactions.
 */
function createAuth() {
  return betterAuth({
    appName: "PizzaHub",
    baseURL: env.betterAuthUrl,
    basePath: "/api/auth",
    secret: env.betterAuthSecret,
    database: mongodbAdapter(getDb(), {
      client: getMongoClient(),
      usePlural: true,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
      autoSignIn: true,
    },
    hooks: {
      before: passwordPolicy,
    },
    socialProviders: env.google.enabled
      ? {
          google: {
            clientId: env.google.clientId,
            clientSecret: env.google.clientSecret,
          },
        }
      : {},
    // Every business field is `input: false`, so a public sign-up request can
    // never choose its own role, subscription plan or blocked state.
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "customer", input: false },
        isBlocked: { type: "boolean", defaultValue: false, input: false },
        roleOnboarded: { type: "boolean", defaultValue: false, input: false },
        businessName: { type: "string", required: false, input: false },
        subscriptionPlan: {
          type: "string",
          defaultValue: "free",
          input: false,
        },
        subscriptionExpiresAt: { type: "date", required: false, input: false },
        stripeCustomerId: { type: "string", required: false, input: false },
        favorites: { type: "string[]", defaultValue: [], input: false },
      },
    },
    trustedOrigins: [env.clientUrl],
    advanced: {
      database: { generateId: false },
    },
  });
}

export type PizzaHubAuth = ReturnType<typeof createAuth>;

let authInstance: PizzaHubAuth | null = null;

export function getAuth(): PizzaHubAuth {
  if (!authInstance) {
    authInstance = createAuth();
  }
  return authInstance;
}
