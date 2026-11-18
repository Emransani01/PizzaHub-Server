import type { RequestHandler } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { ApiError } from "../../lib/api-error.js";
import { validatedParams } from "../../middleware/validate-request.js";
import {
  createCheckoutSession,
  getCheckoutStatus,
  getSubscriptionStatus,
  handleStripeWebhook,
} from "./subscription.service.js";

export const checkoutSessionParamSchema = z.object({
  sessionId: z.string().trim().min(1),
});

export const getStatusHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    res.status(200).json(await getSubscriptionStatus(req.user));
  },
);

export const createCheckoutHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    res.status(201).json(await createCheckoutSession(req.user));
  },
);

export const getCheckoutStatusHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { sessionId } = validatedParams<
      z.infer<typeof checkoutSessionParamSchema>
    >(req);
    res.status(200).json(await getCheckoutStatus(req.user, sessionId));
  },
);

export const webhookHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(
          typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
        );

    const result = await handleStripeWebhook(
      rawBody,
      typeof signature === "string" ? signature : undefined,
    );

    res.status(200).json(result);
  },
);
