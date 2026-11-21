import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { QUOTE_TOKEN_TTL_MS } from "../src/lib/quote-token.js";
import { signQuoteToken } from "../src/lib/quote-token.js";
import { MenuItemModel } from "../src/modules/menu-items/menu-item.model.js";
import { CheckoutGroupModel } from "../src/modules/orders/checkout-group.model.js";
import { OrderModel } from "../src/modules/orders/order.model.js";
import {
  authorizationFor,
  clearDatabase,
  createTestUser,
  futureDate,
} from "./helpers.js";

const app = createApp();
const DELIVERY_DATE = futureDate(4);
const DELIVERY_ADDRESS = "120 Gulf Shore Blvd, Naples, FL 34102";

interface SeededItem {
  itemId: string;
  price: number;
  vendorId: string;
}

async function seedApprovedItem(
  itemName: string,
  businessName: string,
  price: number,
): Promise<SeededItem> {
  const vendor = await createTestUser({ role: "vendor", businessName });
  const admin = await createTestUser({ role: "admin" });

  const created = await request(app)
    .post("/api/menu-items")
    .set("Authorization", await authorizationFor(vendor))
    .send({
      itemName,
      category: "Classic Pizzas",
      description: "Stone-baked pizza with tomato sauce and mozzarella.",
      price,
      location: "Naples, FL",
      images: ["https://images.pizzahub.test/item.jpg"],
    })
    .expect(201);

  await request(app)
    .patch(`/api/menu-items/${created.body.id}/status`)
    .set("Authorization", await authorizationFor(admin))
    .send({ status: "approved" })
    .expect(200);

  return {
    itemId: created.body.id as string,
    price: created.body.price as number,
    vendorId: vendor.id,
  };
}

function quoteBody(
  items: {
    itemId: string;
    quantity: number;
    expectedUnitPrice?: number;
    acknowledgedUnitPrice?: number;
  }[],
) {
  return { items };
}

function checkoutBody(input: {
  checkoutGroupId: string;
  items: { itemId: string; quantity: number }[];
  quoteToken: string;
  deliveryDate?: string;
  deliveryAddress?: string;
  message?: string;
}) {
  return {
    checkoutGroupId: input.checkoutGroupId,
    items: input.items,
    quoteToken: input.quoteToken,
    deliveryDate: input.deliveryDate ?? DELIVERY_DATE,
    deliveryAddress: input.deliveryAddress ?? DELIVERY_ADDRESS,
    message: input.message ?? "Leave at the front desk.",
  };
}

async function requestQuote(
  customerToken: string,
  items: {
    itemId: string;
    quantity: number;
    expectedUnitPrice?: number;
    acknowledgedUnitPrice?: number;
  }[],
) {
  const response = await request(app)
    .post("/api/orders/quote")
    .set("Authorization", customerToken)
    .send(quoteBody(items));
  expect(response.status).toBe(200);
  return response.body;
}

describe("cart quote and checkout", () => {
  beforeEach(async () => {
    await clearDatabase();
    await OrderModel.syncIndexes();
    await CheckoutGroupModel.syncIndexes();
  });

  it("quotes database prices and issues a ten-minute token", async () => {
    const item = await seedApprovedItem("Margherita Pizza", "Napoli", 12.5);
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);

    const response = await request(app)
      .post("/api/orders/quote")
      .set("Authorization", auth)
      .send(quoteBody([{ itemId: item.itemId, quantity: 2 }]));

    expect(response.status).toBe(200);
    expect(response.body.canCheckout).toBe(true);
    expect(response.body.issues).toEqual([]);
    expect(response.body.lines[0]).toMatchObject({
      itemId: item.itemId,
      quantity: 2,
      unitPrice: 12.5,
      lineTotal: 25,
    });
    expect(response.body.subtotal).toBe(25);
    expect(response.body.total).toBe(25);
    expect(typeof response.body.quoteToken).toBe("string");
    expect(response.body.items).toEqual(response.body.lines);

    const lifetime =
      new Date(response.body.quoteExpiresAt).getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(QUOTE_TOKEN_TTL_MS - 5_000);
    expect(lifetime).toBeLessThanOrEqual(QUOTE_TOKEN_TTL_MS);
  });

  it("never exposes metadata or money for an unavailable cart item", async () => {
    const visible = await seedApprovedItem("Public Pizza", "Napoli", 10);
    const hidden = await seedApprovedItem("Secret Truffle Calzone", "Napoli", 99);
    const admin = await createTestUser({ role: "admin" });
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);

    await request(app)
      .patch(`/api/menu-items/${hidden.itemId}/status`)
      .set("Authorization", await authorizationFor(admin))
      .send({ status: "inactive" })
      .expect(200);

    const response = await request(app)
      .post("/api/orders/quote")
      .set("Authorization", auth)
      .send(
        quoteBody([
          { itemId: visible.itemId, quantity: 1 },
          { itemId: hidden.itemId, quantity: 2 },
        ]),
      );

    expect(response.status).toBe(200);
    expect(response.body.canCheckout).toBe(false);
    expect(response.body.quoteToken).toBeNull();
    expect(response.body.issues).toEqual([
      expect.objectContaining({
        itemId: hidden.itemId,
        code: "UNAVAILABLE",
      }),
    ]);
    expect(response.body.issues[0].message).not.toContain("Secret Truffle");
    expect(
      response.body.lines.find(
        (line: { itemId: string }) => line.itemId === hidden.itemId,
      ),
    ).toMatchObject({
      itemId: hidden.itemId,
      itemName: null,
      quantity: 2,
      unitPrice: 0,
      lineTotal: 0,
    });
    expect(response.body.subtotal).toBe(10);
    expect(response.body.total).toBe(10);
    expect(JSON.stringify(response.body)).not.toContain("Secret Truffle");
  });

  it("requires an explicit, server-verified acknowledgement of a changed price", async () => {
    const item = await seedApprovedItem("Pepperoni Pizza", "Napoli", 14.99);
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);

    const stale = await request(app)
      .post("/api/orders/quote")
      .set("Authorization", auth)
      .send(
        quoteBody([
          {
            itemId: item.itemId,
            quantity: 1,
            expectedUnitPrice: 10,
          },
        ]),
      );

    expect(stale.status).toBe(200);
    expect(stale.body.canCheckout).toBe(false);
    expect(stale.body.quoteToken).toBeNull();
    expect(stale.body.quoteExpiresAt).toBeNull();
    expect(stale.body.subtotal).toBe(14.99);
    expect(stale.body.total).toBe(14.99);
    expect(stale.body.issues).toEqual([
      expect.objectContaining({
        itemId: item.itemId,
        code: "PRICE_CHANGED",
        expectedUnitPrice: 10,
        currentUnitPrice: 14.99,
      }),
    ]);

    // Echoing an arbitrary "new" price is not proof that the customer saw the
    // authoritative price; the server compares it with the database.
    const wrongAcknowledgement = await requestQuote(auth, [
      {
        itemId: item.itemId,
        quantity: 1,
        expectedUnitPrice: 10,
        acknowledgedUnitPrice: 12,
      },
    ]);
    expect(wrongAcknowledgement.canCheckout).toBe(false);
    expect(wrongAcknowledgement.quoteToken).toBeNull();
    expect(wrongAcknowledgement.issues).toEqual([
      expect.objectContaining({
        code: "PRICE_CHANGED",
        currentUnitPrice: 14.99,
      }),
    ]);

    // Only the exact database price clears the acknowledgement gate. The
    // acceptance is signed into the quote token and checked at checkout.
    const acknowledged = await requestQuote(auth, [
      {
        itemId: item.itemId,
        quantity: 1,
        expectedUnitPrice: 10,
        acknowledgedUnitPrice: 14.99,
      },
    ]);
    expect(acknowledged.canCheckout).toBe(true);
    expect(acknowledged.quoteToken).toBeTruthy();

    const checkout = await request(app)
      .post("/api/orders/checkout")
      .set("Authorization", auth)
      .send(
        checkoutBody({
          checkoutGroupId: randomUUID(),
          items: [{ itemId: item.itemId, quantity: 1 }],
          quoteToken: acknowledged.quoteToken,
        }),
      );
    expect(checkout.status).toBe(201);
  });

  it("atomically creates one order per line in a multi-vendor cart", async () => {
    const pizza = await seedApprovedItem("Veggie Pizza", "Green Oven", 13.25);
    const dessert = await seedApprovedItem("Tiramisu", "Sweet Slice", 6.75);
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);
    const checkoutGroupId = randomUUID();

    const quote = await requestQuote(auth, [
      { itemId: pizza.itemId, quantity: 2 },
      { itemId: dessert.itemId, quantity: 3 },
    ]);

    const response = await request(app)
      .post("/api/orders/checkout")
      .set("Authorization", auth)
      .send(
        checkoutBody({
          checkoutGroupId,
          items: [
            { itemId: pizza.itemId, quantity: 2 },
            { itemId: dessert.itemId, quantity: 3 },
          ],
          quoteToken: quote.quoteToken,
        }),
      );

    expect(response.status).toBe(201);
    expect(response.body.replayed).toBe(false);
    expect(response.body.orders).toHaveLength(2);
    expect(response.body.orders.map((order: { itemId: string }) => order.itemId)).toEqual(
      expect.arrayContaining([pizza.itemId, dessert.itemId]),
    );
    expect(response.body.orders.every((order: { checkoutGroupId: string }) =>
      order.checkoutGroupId === checkoutGroupId)).toBe(true);
    expect(response.body.summary).toMatchObject({
      itemCount: 2,
      totalQuantity: 5,
      subtotal: 46.75,
      total: 46.75,
      deliveryDate: DELIVERY_DATE,
    });

    const group = await CheckoutGroupModel.findOne({ checkoutGroupId });
    expect(group).not.toBeNull();
    expect(group?.orderIds).toHaveLength(2);
    expect(group?.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await OrderModel.countDocuments({ checkoutGroupId })).toBe(2);
  });

  it("replays an identical checkout without creating duplicate orders", async () => {
    const item = await seedApprovedItem("Four Cheese Pizza", "Napoli", 15.5);
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);
    const checkoutGroupId = randomUUID();
    const body = checkoutBody({
      checkoutGroupId,
      items: [{ itemId: item.itemId, quantity: 2 }],
      quoteToken: (
        await requestQuote(auth, [{ itemId: item.itemId, quantity: 2 }])
      ).quoteToken,
    });

    const first = await request(app)
      .post("/api/orders/checkout")
      .set("Authorization", auth)
      .send(body);
    const second = await request(app)
      .post("/api/orders/checkout")
      .set("Authorization", auth)
      .send(body);

    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.orders.map((order: { id: string }) => order.id)).toEqual(
      first.body.orders.map((order: { id: string }) => order.id),
    );
    expect(await OrderModel.countDocuments({ checkoutGroupId })).toBe(1);
    expect(await CheckoutGroupModel.countDocuments({ checkoutGroupId })).toBe(1);
  });

  it("replays an identical checkout after its delivery date and quote have expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const item = await seedApprovedItem("Replay Pizza", "Napoli", 12);
      const customer = await createTestUser({ role: "customer" });
      const auth = await authorizationFor(customer);
      const checkoutGroupId = randomUUID();
      const deliveryDate = futureDate(0);
      const body = checkoutBody({
        checkoutGroupId,
        items: [{ itemId: item.itemId, quantity: 1 }],
        quoteToken: (
          await requestQuote(auth, [{ itemId: item.itemId, quantity: 1 }])
        ).quoteToken,
        deliveryDate,
      });

      const first = await request(app)
        .post("/api/orders/checkout")
        .set("Authorization", auth)
        .send(body);
      expect(first.status).toBe(201);

      // Move beyond both the delivery date and the ten-minute quote lifetime.
      // Replay is resolved before those checks, so the original orders are
      // returned without creating duplicates.
      vi.setSystemTime(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000));
      // The access token expires too; only the checkout identity matters.
      const replayAuth = await authorizationFor(customer);
      const replay = await request(app)
        .post("/api/orders/checkout")
        .set("Authorization", replayAuth)
        .send(body);

      expect(replay.status).toBe(200);
      expect(replay.body.replayed).toBe(true);
      expect(replay.body.orders.map((order: { id: string }) => order.id)).toEqual(
        first.body.orders.map((order: { id: string }) => order.id),
      );
      expect(await OrderModel.countDocuments({ checkoutGroupId })).toBe(1);
      expect(await CheckoutGroupModel.countDocuments({ checkoutGroupId })).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a new checkout with a past delivery date", async () => {
    const item = await seedApprovedItem("Yesterday Pizza", "Napoli", 11);
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);
    const quote = await requestQuote(auth, [
      { itemId: item.itemId, quantity: 1 },
    ]);

    const response = await request(app)
      .post("/api/orders/checkout")
      .set("Authorization", auth)
      .send(
        checkoutBody({
          checkoutGroupId: randomUUID(),
          items: [{ itemId: item.itemId, quantity: 1 }],
          quoteToken: quote.quoteToken,
          deliveryDate: futureDate(-1),
        }),
      );

    expect(response.status).toBe(422);
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("rejects reuse of a checkout id for a different request", async () => {
    const item = await seedApprovedItem("Hawaiian Pizza", "Napoli", 14);
    const otherItem = await seedApprovedItem("Pineapple Pizza", "Napoli", 13);
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);
    const checkoutGroupId = randomUUID();
    const quote = await requestQuote(auth, [
      { itemId: item.itemId, quantity: 1 },
    ]);
    const original = checkoutBody({
      checkoutGroupId,
      items: [{ itemId: item.itemId, quantity: 1 }],
      quoteToken: quote.quoteToken,
    });

    await request(app)
      .post("/api/orders/checkout")
      .set("Authorization", auth)
      .send(original)
      .expect(201);

    const conflicting = await request(app)
      .post("/api/orders/checkout")
      .set("Authorization", auth)
      .send({
        ...original,
        deliveryAddress: "999 Different Street, Naples, FL 34102",
      });

    expect(conflicting.status).toBe(409);
    expect(conflicting.body.code).toBe("CHECKOUT_GROUP_CONFLICT");

    const differentCartQuote = await requestQuote(auth, [
      { itemId: otherItem.itemId, quantity: 1 },
    ]);
    const differentCart = await request(app)
      .post("/api/orders/checkout")
      .set("Authorization", auth)
      .send(
        checkoutBody({
          checkoutGroupId,
          items: [{ itemId: otherItem.itemId, quantity: 1 }],
          quoteToken: differentCartQuote.quoteToken,
        }),
      );
    expect(differentCart.status).toBe(409);
    expect(differentCart.body.code).toBe("CHECKOUT_GROUP_CONFLICT");
    expect(await OrderModel.countDocuments({ checkoutGroupId })).toBe(1);
  });

  it("rolls back the group and all lines when one line conflicts with an active order", async () => {
    const pizza = await seedApprovedItem("BBQ Chicken Pizza", "Napoli", 16);
    const dessert = await seedApprovedItem("Brownie", "Sweet Slice", 5.5);
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);
    const checkoutGroupId = randomUUID();

    // A legacy POST /orders line owns the active slot for the dessert.
    await request(app)
      .post("/api/orders")
      .set("Authorization", auth)
      .send({
        itemId: dessert.itemId,
        deliveryDate: DELIVERY_DATE,
        deliveryAddress: DELIVERY_ADDRESS,
      })
      .expect(201);

    const quote = await requestQuote(auth, [
      { itemId: pizza.itemId, quantity: 1 },
      { itemId: dessert.itemId, quantity: 1 },
    ]);
    const response = await request(app)
      .post("/api/orders/checkout")
      .set("Authorization", auth)
      .send(
        checkoutBody({
          checkoutGroupId,
          items: [
            { itemId: pizza.itemId, quantity: 1 },
            { itemId: dessert.itemId, quantity: 1 },
          ],
          quoteToken: quote.quoteToken,
        }),
      );

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ACTIVE_ORDER_EXISTS");
    expect(await CheckoutGroupModel.countDocuments({ checkoutGroupId })).toBe(0);
    expect(await OrderModel.countDocuments({ checkoutGroupId })).toBe(0);
    // The pizza line was inserted before the conflicting dessert line and must
    // have been rolled back with the rest of the transaction.
    expect(await OrderModel.countDocuments({ itemId: pizza.itemId })).toBe(0);
  });

  it("rejects a token that does not match the submitted cart", async () => {
    const first = await seedApprovedItem("Classic Cheese", "Napoli", 11);
    const second = await seedApprovedItem("Garlic Knots", "Napoli", 4.5);
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);
    const quote = await requestQuote(auth, [
      { itemId: first.itemId, quantity: 1 },
    ]);

    const response = await request(app)
      .post("/api/orders/checkout")
      .set("Authorization", auth)
      .send(
        checkoutBody({
          checkoutGroupId: randomUUID(),
          items: [{ itemId: second.itemId, quantity: 1 }],
          quoteToken: quote.quoteToken,
        }),
      );

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("QUOTE_INVALID");
    expect(response.body.details.requiresFreshQuote).toBe(true);
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("rejects expired quote tokens", async () => {
    const item = await seedApprovedItem("Pepperoni Pizza", "Napoli", 14.99);
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);
    const expiredToken = await signQuoteToken(
      customer.id,
      [{ itemId: item.itemId, quantity: 1, unitPrice: item.price }],
      { expiresIn: Math.floor(Date.now() / 1000) - 60 },
    );

    const response = await request(app)
      .post("/api/orders/checkout")
      .set("Authorization", auth)
      .send(
        checkoutBody({
          checkoutGroupId: randomUUID(),
          items: [{ itemId: item.itemId, quantity: 1 }],
          quoteToken: expiredToken,
        }),
      );

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("QUOTE_EXPIRED");
    expect(response.body.details.requiresFreshQuote).toBe(true);
  });

  it("rejects a signed quote when the database price changes before checkout", async () => {
    const item = await seedApprovedItem("White Pizza", "Napoli", 13);
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);
    const quote = await requestQuote(auth, [
      { itemId: item.itemId, quantity: 1 },
    ]);

    await MenuItemModel.findByIdAndUpdate(item.itemId, { price: 15.5 });

    const response = await request(app)
      .post("/api/orders/checkout")
      .set("Authorization", auth)
      .send(
        checkoutBody({
          checkoutGroupId: randomUUID(),
          items: [{ itemId: item.itemId, quantity: 1 }],
          quoteToken: quote.quoteToken,
        }),
      );

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PRICE_CHANGED");
    expect(response.body.details.requiresFreshQuote).toBe(true);
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("reports unavailable and missing cart lines before issuing a token", async () => {
    const item = await seedApprovedItem("Marinara Pizza", "Napoli", 10.5);
    const admin = await createTestUser({ role: "admin" });
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);

    await request(app)
      .patch(`/api/menu-items/${item.itemId}/status`)
      .set("Authorization", await authorizationFor(admin))
      .send({ status: "inactive" })
      .expect(200);

    const response = await request(app)
      .post("/api/orders/quote")
      .set("Authorization", auth)
      .send(
        quoteBody([
          { itemId: item.itemId, quantity: 1 },
          {
            itemId: "64b7f1f1f1f1f1f1f1f1f1f1",
            quantity: 1,
          },
        ]),
      );

    expect(response.status).toBe(200);
    expect(response.body.canCheckout).toBe(false);
    expect(response.body.quoteToken).toBeNull();
    expect(response.body.issues.map((issue: { code: string }) => issue.code)).toEqual(
      expect.arrayContaining(["UNAVAILABLE", "MISSING"]),
    );
  });
});
