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
  findUserById,
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

function isStripeResourceMissingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "resource_missing"
  );
}

/**
 * Webhook objects are untrusted until their signature is verified, and even
 * then different Stripe events carry different shapes. Check the Stripe object
 * discriminator before treating a payload as a session, invoice, or subscription.
 */
function asStripeObject<T>(value: unknown, object: string): T | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as { id?: unknown; object?: unknown };
  if (typeof candidate.id !== "string" || candidate.object !== object) {
    return null;
  }

  return value as T;
}

function checkoutSessionFrom(value: unknown): Stripe.Checkout.Session | null {
  return asStripeObject<Stripe.Checkout.Session>(value, "checkout.session");
}

function invoiceFrom(value: unknown): Stripe.Invoice | null {
  return asStripeObject<Stripe.Invoice>(value, "invoice");
}

function subscriptionFrom(value: unknown): Stripe.Subscription | null {
  return asStripeObject<Stripe.Subscription>(value, "subscription");
}

function logIgnoredCheckout(sessionId: string, reason: string): void {
  console.info("[stripe-webhook] ignored checkout session", { sessionId, reason });
}

function logIgnoredEvent(type: string): void {
  console.info("[stripe-webhook] ignored event with an invalid object", { type });
}

async function getOrCreateStripeCustomer(
  user: AppUser,
  stripe: Stripe,
): Promise<string> {
  let customerId = user.stripeCustomerId;

  if (customerId) {
    try {
      const existingCustomer = await stripe.customers.retrieve(customerId);

      if ("deleted" in existingCustomer && existingCustomer.deleted) {
        customerId = null;
      }
    } catch (error) {
      if (isStripeResourceMissingError(error)) {
        customerId = null;
      } else {
        throw error;
      }
    }
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.businessName ?? user.name,
      metadata: { vendorId: user.id },
    });

    customerId = customer.id;

    await updateUser(user.id, {
      stripeCustomerId: customerId,
    });
  }

  return customerId;
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

  const customerId = await getOrCreateStripeCustomer(user, stripe);

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

export async function getCheckoutStatus(user: AppUser, sessionId: string) {
  const transaction = await TransactionModel.findOne({
    stripeSessionId: sessionId,
  });

  if (!transaction) {
    throw ApiError.notFound("Checkout session not found.");
  }

  if (transaction.vendorId.toString() !== user.id) {
    throw ApiError.forbidden(
      "This checkout session belongs to another vendor.",
    );
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

/**
 * Both `checkout.session.completed` and
 * `checkout.session.async_payment_succeeded` go through this handler. A session
 * only counts as a successful payment when Stripe reports `paid`; an unpaid or
 * pending session must never grant Premium.
 */
async function handlePaidCheckoutSession(value: unknown): Promise<void> {
  const session = checkoutSessionFrom(value);
  if (!session) {
    logIgnoredEvent("checkout.session");
    return;
  }

  if (session.mode !== "subscription") return;

  if (session.payment_status !== "paid") {
    logIgnoredCheckout(
      session.id,
      `payment_status=${session.payment_status ?? "missing"}`,
    );
    return;
  }

  const rawVendorId =
    session.metadata?.vendorId ?? session.client_reference_id ?? null;
  const vendorId = typeof rawVendorId === "string" ? rawVendorId.trim() : "";
  if (!vendorId) {
    logIgnoredCheckout(session.id, "missing vendor owner");
    return;
  }

  const vendor = await findUserById(vendorId);
  if (!vendor || vendor.role !== "vendor") {
    logIgnoredCheckout(session.id, "vendor owner not found");
    return;
  }

  const existing = await TransactionModel.findOne({
    stripeSessionId: session.id,
  });

  // A session must stay tied to the vendor it was created for.
  if (existing && existing.vendorId.toString() !== vendor.id) {
    logIgnoredCheckout(session.id, "vendor owner mismatch");
    return;
  }

  const customerId = customerIdFrom(session.customer);
  if (
    customerId &&
    vendor.stripeCustomerId &&
    customerId !== vendor.stripeCustomerId
  ) {
    logIgnoredCheckout(session.id, "customer mismatch");
    return;
  }

  // Idempotency: a replay of the same event must not re-apply the upgrade.
  // This check happens before any Stripe read or user update, so replayed and
  // related events cannot extend the subscription again or duplicate a payment.
  if (existing?.status === "paid") return;

  const stripe = getStripe();
  const sessionSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);
  const subscriptionId =
    sessionSubscriptionId ?? existing?.stripeSubscriptionId ?? null;

  let periodEnd: Date | null = null;
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    periodEnd = subscriptionPeriodEnd(subscription);
  }

  await TransactionModel.findOneAndUpdate(
    { stripeSessionId: session.id },
    {
      $set: {
        vendorId: new Types.ObjectId(vendor.id),
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

  await activatePremium(vendor.id, {
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
    const subscription =
      await getStripe().subscriptions.retrieve(subscriptionId);
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

async function handleCheckoutExpired(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "subscription") return;

  // Only the matching pending transaction may transition; paid records stay paid.
  // Idempotent: repeated events become a no-op after the first state change.
  await TransactionModel.findOneAndUpdate(
    { stripeSessionId: session.id, status: "pending" },
    { $set: { status: "expired" } },
  );
}

async function handleCheckoutAsyncPaymentFailed(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "subscription") return;

  await TransactionModel.findOneAndUpdate(
    { stripeSessionId: session.id, status: "pending" },
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
    case "checkout.session.async_payment_succeeded": {
      await handlePaidCheckoutSession(event.data.object);
      break;
    }
    case "checkout.session.expired": {
      const session = checkoutSessionFrom(event.data.object);
      if (session) await handleCheckoutExpired(session);
      else logIgnoredEvent(event.type);
      break;
    }
    case "checkout.session.async_payment_failed": {
      const session = checkoutSessionFrom(event.data.object);
      if (session) await handleCheckoutAsyncPaymentFailed(session);
      else logIgnoredEvent(event.type);
      break;
    }
    case "invoice.paid": {
      const invoice = invoiceFrom(event.data.object);
      if (invoice) await handleInvoicePaid(invoice);
      else logIgnoredEvent(event.type);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = invoiceFrom(event.data.object);
      if (invoice) await handleInvoiceFailed(invoice);
      else logIgnoredEvent(event.type);
      break;
    }
    case "customer.subscription.updated": {
      const subscription = subscriptionFrom(event.data.object);
      if (subscription) await handleSubscriptionChanged(subscription, false);
      else logIgnoredEvent(event.type);
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = subscriptionFrom(event.data.object);
      if (subscription) await handleSubscriptionChanged(subscription, true);
      else logIgnoredEvent(event.type);
      break;
    }
    default:
      break;
  }

  return { received: true };
}
