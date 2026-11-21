import { getDb, getMongoClient } from "./mongo.js";

interface HelloResponse {
  logicalSessionTimeoutMinutes?: number;
  setName?: string;
  msg?: string;
}

/**
 * Checkout creates one group document plus every order line in a single
 * MongoDB transaction. Fail startup rather than serving requests against a
 * topology that cannot guarantee that boundary.
 */
export async function assertTransactionsSupported(): Promise<void> {
  const hello = (await getMongoClient()
    .db()
    .admin()
    .command({ hello: 1 })) as HelloResponse;

  const isReplicaSet = typeof hello.setName === "string";
  const isMongos = hello.msg === "isdbgrid";
  if (
    typeof hello.logicalSessionTimeoutMinutes !== "number" ||
    (!isReplicaSet && !isMongos)
  ) {
    throw new Error(
      "[db] MongoDB transactions are required for checkout. " +
        "Connect to a replica set or sharded cluster (MongoDB Atlas M0+ is supported).",
    );
  }

  const session = getMongoClient().startSession();
  try {
    // A read-only transaction proves sessions, snapshot reads and commit are
    // available without writing probe data to any collection.
    await session.withTransaction(
      async () => {
        await getDb().collection("users").findOne({}, { session });
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      },
    );
  } catch (error) {
    throw new Error(
      "[db] MongoDB transaction probe failed. Checkout cannot run safely.",
      { cause: error },
    );
  } finally {
    await session.endSession();
  }
}
