import { MongoClient, type Db } from "mongodb";
import { env } from "../config/environment.js";

let client: MongoClient | null = null;
let database: Db | null = null;

/**
 * The Better Auth adapters need a synchronous handle on the database, so the
 * client is created lazily (the MongoClient constructor does not open a socket)
 * and connected explicitly during startup.
 */
export function getMongoClient(): MongoClient {
  if (!client) {
    client = new MongoClient(env.mongodbUri, {
      serverSelectionTimeoutMS: 10_000,
    });
  }
  return client;
}

export function getDb(): Db {
  if (!database) {
    database = getMongoClient().db();
  }
  return database;
}

export async function connectMongo(): Promise<void> {
  await getMongoClient().connect();
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    database = null;
  }
}

export async function ensureUserIndexes(): Promise<void> {
  const users = getDb().collection("users");
  await users.createIndex({ email: 1 }, { unique: true });
  await users.createIndex({ role: 1 });
  await users.createIndex({ isBlocked: 1 });
}
