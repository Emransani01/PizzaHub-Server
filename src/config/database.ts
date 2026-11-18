import mongoose from "mongoose";
import { env } from "./environment.js";
import { closeMongo, connectMongo, ensureUserIndexes } from "../lib/mongo.js";

let databaseConnection: Promise<void> | null = null;

export function connectDatabase(): Promise<void> {
  if (databaseConnection) {
    return databaseConnection;
  }

  databaseConnection = (async () => {
    if (!env.mongodbUri) {
      throw new Error("MONGODB_URI is not configured.");
    }

    await mongoose.connect(env.mongodbUri);
    await connectMongo();

    try {
      await ensureUserIndexes();
    } catch (error) {
      console.warn(
        "[db] Could not create user indexes. This usually means duplicate emails already exist.",
        error,
      );
    }
  })().catch((error: unknown) => {
    databaseConnection = null;
    throw error;
  });

  return databaseConnection;
}

export async function disconnectDatabase(): Promise<void> {
  databaseConnection = null;
  await mongoose.disconnect();
  await closeMongo();
}
