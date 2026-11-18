import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { env } from "../config/environment.js";
import { getDb, getMongoClient } from "./mongo.js";

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
