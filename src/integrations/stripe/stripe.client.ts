import Stripe from "stripe";
import { env } from "../../config/environment.js";
import { ApiError } from "../../lib/api-error.js";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!env.stripe.secretKey) {
    throw ApiError.unavailable(
      "Stripe is not configured. Add STRIPE_SECRET_KEY to the server environment.",
    );
  }
  if (!client) {
    client = new Stripe(env.stripe.secretKey);
  }
  return client;
}

/**
 * Newer Stripe API versions moved `current_period_end` onto the subscription
 * item, so read both shapes rather than assuming one.
 */
export function subscriptionPeriodEnd(
  subscription: Stripe.Subscription,
): Date | null {
  const itemEnd = subscription.items?.data?.[0]?.current_period_end;
  const legacyEnd = (
    subscription as unknown as { current_period_end?: number }
  ).current_period_end;

  const seconds =
    typeof itemEnd === "number"
      ? itemEnd
      : typeof legacyEnd === "number"
        ? legacyEnd
        : null;

  return seconds ? new Date(seconds * 1000) : null;
}

export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const direct = (
    invoice as unknown as { subscription?: string | { id?: string } }
  ).subscription;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object" && direct.id) return direct.id;

  const parent = (
    invoice as unknown as {
      parent?: { subscription_details?: { subscription?: string } };
    }
  ).parent;

  return parent?.subscription_details?.subscription ?? null;
}

export function customerIdFrom(
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}
