import type {} from "./types/express.js";
import cors from "cors";
import express, { type RequestHandler } from "express";
import { env } from "./config/environment.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authHandler, issueTokenHandler } from "./routes/auth.routes.js";
import configRoutes from "./modules/config/config.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import favoriteRoutes from "./modules/favorites/favorite.routes.js";
import menuItemRoutes from "./modules/menu-items/menu-item.routes.js";
import orderRoutes from "./modules/orders/order.routes.js";
import subscriptionRoutes from "./modules/subscriptions/subscription.routes.js";
import { webhookHandler } from "./modules/subscriptions/subscription.controller.js";
import transactionRoutes from "./modules/transactions/transaction.routes.js";
import uploadRoutes from "./modules/uploads/upload.routes.js";
import userRoutes from "./modules/users/user.routes.js";

const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ message: "Route not found.", code: "NOT_FOUND" });
};

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    cors({
      origin: env.clientUrl,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  });

  app.use("/api/config", configRoutes);

  // The JWT endpoint must be registered before the Better Auth catch-all.
  app.get("/api/auth/token", issueTokenHandler);

  // Better Auth reads its own request body, so it is mounted before express.json().
  app.all("/api/auth/*splat", authHandler);

  // Stripe requires the raw, unparsed body for signature verification.
  app.post(
    "/api/subscriptions/webhook",
    express.raw({ type: "application/json" }),
    webhookHandler,
  );

  app.use(express.json({ limit: "1mb" }));

  app.use("/api/users", userRoutes);
  app.use("/api/menu-items", menuItemRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/favorites", favoriteRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/uploads", uploadRoutes);
  app.use("/api/subscriptions", subscriptionRoutes);
  app.use("/api/transactions", transactionRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
export default app;
