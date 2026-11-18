import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { getStripe } from "../src/integrations/stripe/stripe.client.js";
import { updateUser } from "../src/lib/user-repository.js";
import {
  authorizationFor,
  clearDatabase,
  createTestUser,
} from "./helpers.js";

const app = createApp();

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

function signedWebhook(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const signature = getStripe().webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  return { payload, signature };
}

function subscriptionEvent(
  type: string,
  status: string,
  customer: string,
  periodEnd: number,
) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: "event",
    type,
    data: {
      object: {
        id: "sub_test_123",
        object: "subscription",
        customer,
        status,
        items: {
          object: "list",
          data: [{ id: "si_1", current_period_end: periodEnd }],
        },
      },
    },
  };
}

describe("vendor premium subscriptions", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it("refuses checkout for non-vendor accounts", async () => {
    const customer = await createTestUser({ role: "customer" });

    const response = await request(app)
      .post("/api/subscriptions/checkout")
      .set("Authorization", await authorizationFor(customer))
      .send({});

    expect(response.status).toBe(403);
  });

  it("reports a free plan and the server-side item limit", async () => {
    const vendor = await createTestUser({ role: "vendor" });

    const response = await request(app)
      .get("/api/subscriptions/status")
      .set("Authorization", await authorizationFor(vendor));

    expect(response.status).toBe(200);
    expect(response.body.plan).toBe("free");
    expect(response.body.premiumActive).toBe(false);
    expect(response.body.freePlanActiveItemLimit).toBe(3);
  });

  it("rejects webhook payloads with a missing or invalid signature", async () => {
    const event = subscriptionEvent(
      "customer.subscription.updated",
      "active",
      "cus_x",
      1_900_000_000,
    );

    const missing = await request(app)
      .post("/api/subscriptions/webhook")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(event));
    expect(missing.status).toBe(400);

    const invalid = await request(app)
      .post("/api/subscriptions/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=deadbeef")
      .send(JSON.stringify(event));
    expect(invalid.status).toBe(400);
  });

  it("activates Premium only from a verified webhook event", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    await updateUser(vendor.id, { stripeCustomerId: "cus_active_1" });

    const periodEnd = 1_900_000_000;
    const event = subscriptionEvent(
      "customer.subscription.updated",
      "active",
      "cus_active_1",
      periodEnd,
    );
    const { payload, signature } = signedWebhook(event);

    const response = await request(app)
      .post("/api/subscriptions/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);

    const status = await request(app)
      .get("/api/subscriptions/status")
      .set("Authorization", await authorizationFor(vendor));

    expect(status.body.plan).toBe("premium");
    expect(status.body.premiumActive).toBe(true);
    expect(status.body.expiresAt).toBe(
      new Date(periodEnd * 1000).toISOString(),
    );
  });

  it("downgrades the vendor when the subscription is deleted", async () => {
    const vendor = await createTestUser({
      role: "vendor",
      subscriptionPlan: "premium",
      subscriptionExpiresAt: new Date(Date.now() + 86_400_000),
    });
    await updateUser(vendor.id, { stripeCustomerId: "cus_deleted_1" });

    const event = subscriptionEvent(
      "customer.subscription.deleted",
      "canceled",
      "cus_deleted_1",
      1_900_000_000,
    );
    const { payload, signature } = signedWebhook(event);

    await request(app)
      .post("/api/subscriptions/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload)
      .expect(200);

    const status = await request(app)
      .get("/api/subscriptions/status")
      .set("Authorization", await authorizationFor(vendor));

    expect(status.body.plan).toBe("free");
    expect(status.body.premiumActive).toBe(false);
    expect(status.body.expiresAt).toBeNull();
  });

  it("ignores webhooks for customers that do not belong to a vendor", async () => {
    const event = subscriptionEvent(
      "customer.subscription.updated",
      "active",
      "cus_unknown",
      1_900_000_000,
    );
    const { payload, signature } = signedWebhook(event);

    const response = await request(app)
      .post("/api/subscriptions/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);

    expect(response.status).toBe(200);
  });
});
