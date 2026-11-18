/**
 * Test bootstrap.
 *
 * `mongodb-memory-server` boots a real MongoDB process, so the suites exercise
 * genuine Mongoose and driver queries rather than mocks. Environment variables
 * are assigned before any application module is imported, because
 * `config/environment.ts` reads them at module-evaluation time.
 */
import { afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-0123456789";
process.env.JWT_SECRET = "test-jwt-secret-0123456789abcdef";
process.env.JWT_EXPIRES_IN = "15m";
process.env.STRIPE_SECRET_KEY = "sk_test_pizzahub_local_only";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_pizzahub_local_only";
process.env.STRIPE_PREMIUM_PRICE_ID = "price_test_premium";

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri("pizzahub_test");

const { connectDatabase, disconnectDatabase } = await import(
  "../src/config/database.js"
);

await connectDatabase();

afterAll(async () => {
  await disconnectDatabase();
  await mongod.stop();
});
