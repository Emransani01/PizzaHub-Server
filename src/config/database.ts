import mongoose from "mongoose";
import { env } from "./environment.js";
import { closeMongo, connectMongo, ensureUserIndexes } from "../lib/mongo.js";
import { assertTransactionsSupported } from "../lib/transaction.js";
import { ensureMenuItemIndexes } from "../modules/menu-items/menu-item.model.js";
import { ensureCheckoutGroupIndexes } from "../modules/orders/checkout-group.model.js";
import { OrderModel } from "../modules/orders/order.model.js";

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

    // Mandatory: startup must fail if the unique active-slot index cannot be
    // built, because the free-plan limit is not safe without it. Deliberately
    // outside the warning-only catch above.
    await ensureMenuItemIndexes();

    // Checkout relies on these indexes for the active-order rule, group replay
    // and group-level uniqueness. Never degrade to an unsafe duplicate path.
    await OrderModel.createIndexes();
    await ensureCheckoutGroupIndexes();

    // Cart checkout writes a group and all order lines in one transaction.
    // A standalone mongod cannot provide that boundary, so fail fast instead.
    await assertTransactionsSupported();
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
