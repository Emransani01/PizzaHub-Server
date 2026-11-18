import "dotenv/config";

import { app } from "./app.js";
import { connectDatabase } from "./config/database.js";
import { env } from "./config/environment.js";

const startServer = async (): Promise<void> => {
  try {
    await connectDatabase();

    app.listen(env.port, () => {
      console.log(`PizzaHub server running on port ${env.port}`);
    });
  } catch (error) {
    console.error("Failed to start PizzaHub server:", error);
    process.exit(1);
  }
};

void startServer();
