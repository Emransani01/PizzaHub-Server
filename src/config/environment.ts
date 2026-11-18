import "dotenv/config";

const raw = (name: string): string => (process.env[name] ?? "").trim();

const nodeEnv = raw("NODE_ENV") || "development";
const isProduction = nodeEnv === "production";
const isTest = nodeEnv === "test";

function parsePort(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function required(name: string, hint: string, testFallback = ""): string {
  const value = raw(name);
  if (value) return value;
  if (isTest) return testFallback || `test-${name.toLowerCase()}-value`;
  throw new Error(
    `Missing required environment variable "${name}".\n` +
      `${hint}\n` +
      `Create server/.env from server/.env.example and fill it in before starting the API.`,
  );
}

function optional(name: string, fallback = ""): string {
  return raw(name) || fallback;
}

const clientUrl = withoutTrailingSlash(
  optional("CLIENT_URL", "http://localhost:3000"),
);

const googleClientId = optional("GOOGLE_CLIENT_ID");
const googleClientSecret = optional("GOOGLE_CLIENT_SECRET");
const stripeSecretKey = optional("STRIPE_SECRET_KEY");
const stripeWebhookSecret = optional("STRIPE_WEBHOOK_SECRET");
const stripePremiumPriceId = optional("STRIPE_PREMIUM_PRICE_ID");
const imgbbApiKey = optional("IMGBB_API_KEY");

export const env = {
  nodeEnv,
  isProduction,
  isTest,
  port: parsePort(raw("PORT"), 5000),
  mongodbUri: required(
    "MONGODB_URI",
    "Paste the MongoDB Atlas connection string, including the database name.",
    "mongodb://127.0.0.1:27017/pizzahub-test",
  ),
  clientUrl,
  betterAuthUrl: withoutTrailingSlash(
    optional("BETTER_AUTH_URL", clientUrl),
  ),
  betterAuthSecret: required(
    "BETTER_AUTH_SECRET",
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
  ),
  jwtSecret: required(
    "JWT_SECRET",
    'Generate a separate secret with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
  ),
  jwtExpiresIn: optional("JWT_EXPIRES_IN", "15m"),
  jwtIssuer: "pizzahub-api",
  jwtAudience: "pizzahub-client",
  google: {
    clientId: googleClientId,
    clientSecret: googleClientSecret,
    enabled: Boolean(googleClientId && googleClientSecret),
  },
  stripe: {
    secretKey: stripeSecretKey,
    webhookSecret: stripeWebhookSecret,
    premiumPriceId: stripePremiumPriceId,
    enabled: Boolean(stripeSecretKey && stripePremiumPriceId),
    webhookEnabled: Boolean(stripeSecretKey && stripeWebhookSecret),
  },
  imgbb: {
    apiKey: imgbbApiKey,
    enabled: Boolean(imgbbApiKey),
  },
  admin: {
    name: optional("ADMIN_NAME", "PizzaHub Admin"),
    email: optional("ADMIN_EMAIL"),
    password: optional("ADMIN_PASSWORD"),
  },
  freePlanActiveItemLimit: 3,
  uploadMaxBytes: 4 * 1024 * 1024,
} as const;

export type Env = typeof env;
