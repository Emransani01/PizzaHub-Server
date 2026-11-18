import mongoose from "mongoose";
import { env } from "./environment.js";
import {
  closeMongo,
  connectMongo,
  ensureUserIndexes,
} from "../lib/mongo.js";

export async function connectDatabase(): Promise<void> {
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
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  await closeMongo();
}
