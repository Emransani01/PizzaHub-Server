import { Types } from "mongoose";
import type Stripe from "stripe";
import { env } from "../../config/environment.js";
import { ApiError } from "../../lib/api-error.js";
import {
  customerIdFrom,
  getStripe,
  invoiceSubscriptionId,
  subscriptionPeriodEnd,
} from "../../integrations/stripe/stripe.client.js";
import {
  findUserByStripeCustomerId,
  updateUser,
} from "../../lib/user-repository.js";
import type { AppUser } from "../../types/index.js";
import { isPremiumActive } from "../menu-items/menu-item.service.js";
import { TransactionModel } from "../transactions/transaction.model.js";

export async function getSubscriptionStatus(user: AppUser) {
  return {
    plan: user.subscriptionPlan,
    premiumActive: isPremiumActive(user),
    expiresAt: user.subscriptionExpiresAt?.toISOString() ?? null,
    freePlanActiveItemLimit: env.freePlanActiveItemLimit,
    stripeConfigured: env.stripe.enabled,
    priceConfigured: Boolean(env.stripe.premiumPriceId),
  };
}

export async function createCheckoutSession(user: AppUser) {
  if (user.role !== "vendor") {
    throw ApiError.forbidden("Only vendor accounts can subscribe to Premium.");
  }

  if (isPremiumActive(user)) {
    throw ApiError.conflict("Your Premium subscription is already active.");
  }

  if (!env.stripe.enabled) {
    throw ApiError.unavailable(
      "Stripe is not configured. Add STRIPE_SECRET_KEY and STRIPE_PREMIUM_PRICE_ID to the server environment.",
    );
  }

  const stripe = getStripe();

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.businessName ?? user.name,
      metadata: { vendorId: user.id },
    });
    customerId = customer.id;
    await updateUser(user.id, { stripeCustomerId: customerId });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: env.stripe.premiumPriceId, quantity: 1 }],
    success_url: `${env.clientUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.clientUrl}/payment-cancel`,
    client_reference_id: user.id,
    metadata: { vendorId: user.id },
    subscription_data: { metadata: { vendorId: user.id } },
  });

  if (!session.url) {
    throw new ApiError(502, "Stripe did not return a checkout URL.", {
      code: "STRIPE_ERROR",
    });
  }

  await TransactionModel.create({
    vendorId: new Types.ObjectId(user.id),
    plan: "premium",
    amount: (session.amount_total ?? 0) / 100,
    currency: (session.currency ?? "usd").toUpperCase(),
    status: "pending",
    stripeSessionId: session.id,
    stripeSubscriptionId: null,
    stripeInvoiceId: null,
    paidAt: null,
  });

  return { url: session.url, sessionId: session.id };
}

export async function getCheckoutStatus(
  user: AppUser,
  sessionId: string,
) {
  const transaction = await TransactionModel.findOne({
    stripeSessionId: sessionId,
  });

  if (!transaction) {
    throw ApiError.notFound("Checkout session not found.");
  }

  if (transaction.vendorId.toString() !== user.id) {
    throw ApiError.forbidden("This checkout session belongs to another vendor.");
  }

  return {
    sessionId,
    status: transaction.status,
    plan: transaction.plan,
    amount: transaction.amount,
    currency: transaction.currency,
    paidAt: transaction.paidAt?.toISOString() ?? null,
  };
}

async function activatePremium(
  vendorId: string,
  options: {
    customerId?: string | null;
    subscriptionId?: string | null;
    periodEnd?: Date | null;
  } = {},
): Promise<void> {
  await updateUser(vendorId, {
    subscriptionPlan: "premium",
    subscriptionExpiresAt: options.periodEnd ?? null,
    ...(options.customerId ? { stripeCustomerId: options.customerId } : {}),
  });
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "subscription") return;

  const vendorId = session.metadata?.vendorId ?? session.client_reference_id ?? null;
  if (!vendorId) return;

  const existing = await TransactionModel.findOne({
    stripeSessionId: session.id,
  });

  // Idempotency: a replay of the same event must not re-apply the upgrade.
  if (existing?.status === "paid") return;

  const stripe = getStripe();
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;

  let periodEnd: Date | null = null;
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    periodEnd = subscriptionPeriodEnd(subscription);
  }

  const customerId = customerIdFrom(session.customer);

  await TransactionModel.findOneAndUpdate(
    { stripeSessionId: session.id },
    {
      $set: {
        vendorId: new Types.ObjectId(vendorId),
        plan: "premium",
        amount: (session.amount_total ?? 0) / 100,
        currency: (session.currency ?? "usd").toUpperCase(),
        status: "paid",
        stripeSubscriptionId: subscriptionId,
        paidAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  await activatePremium(vendorId, {
    customerId,
    subscriptionId,
    periodEnd,
  });
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId = customerIdFrom(invoice.customer);
  if (!customerId) return;

  const user = await findUserByStripeCustomerId(customerId);
  if (!user) return;

  const subscriptionId = invoiceSubscriptionId(invoice);
  let periodEnd: Date | null = null;

  if (subscriptionId) {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    periodEnd = subscriptionPeriodEnd(subscription);
  }

  await activatePremium(user.id, { customerId, subscriptionId, periodEnd });
}

async function handleInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  await TransactionModel.updateMany(
    { stripeSubscriptionId: subscriptionId, status: "pending" },
    { $set: { status: "failed" } },
  );
}

async function handleSubscriptionChanged(
  subscription: Stripe.Subscription,
  deleted: boolean,
): Promise<void> {
  const customerId = customerIdFrom(subscription.customer);
  if (!customerId) return;

  const user = await findUserByStripeCustomerId(customerId);
  if (!user) return;

  const active =
    !deleted &&
    (subscription.status === "active" || subscription.status === "trialing");

  await updateUser(user.id, {
    subscriptionPlan: active ? "premium" : "free",
    subscriptionExpiresAt: active ? subscriptionPeriodEnd(subscription) : null,
  });
}

/**
 * Verifies the Stripe signature on the raw request body, then applies the
 * resulting subscription change. Premium is only ever granted from here.
 */
export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string | undefined,
): Promise<{ received: true }> {
  if (!env.stripe.webhookEnabled) {
    throw ApiError.unavailable(
      "Stripe webhooks are not configured. Add STRIPE_WEBHOOK_SECRET to the server environment.",
    );
  }

  if (!signature) {
    throw ApiError.badRequest("Missing Stripe signature header.");
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      env.stripe.webhookSecret,
    );
  } catch {
    throw ApiError.badRequest("Invalid Stripe webhook signature.");
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session,
      );
      break;
    case "invoice.paid":
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_failed":
      await handleInvoiceFailed(event.data.object as Stripe.Invoice);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionChanged(
        event.data.object as Stripe.Subscription,
        false,
      );
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionChanged(
        event.data.object as Stripe.Subscription,
        true,
      );
      break;
    default:
      break;
  }

  return { received: true };
}
