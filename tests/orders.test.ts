import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { OrderModel } from "../src/modules/orders/order.model.js";
import {
  authorizationFor,
  clearDatabase,
  createTestUser,
  futureDate,
} from "./helpers.js";

const app = createApp();

async function seedApprovedItem() {
  const vendor = await createTestUser({ role: "vendor", businessName: "Napoli" });
  const admin = await createTestUser({ role: "admin" });
  const vendorAuth = await authorizationFor(vendor);
  const adminAuth = await authorizationFor(admin);

  const created = await request(app)
    .post("/api/menu-items")
    .set("Authorization", vendorAuth)
    .send({
      itemName: "Pepperoni Pizza",
      category: "Meat Lovers",
      description: "Loaded pepperoni on a stone-baked crust with aged cheese.",
      price: 14.99,
      location: "Naples, FL",
      images: ["https://images.pizzahub.test/pepperoni.jpg"],
    })
    .expect(201);

  await request(app)
    .patch(`/api/menu-items/${created.body.id}/status`)
    .set("Authorization", adminAuth)
    .send({ status: "approved" })
    .expect(200);

  return { vendor, admin, itemId: created.body.id as string };
}

function orderPayload(itemId: string, overrides: Record<string, unknown> = {}) {
  return {
    itemId,
    deliveryDate: futureDate(3),
    deliveryAddress: "120 Gulf Shore Blvd, Naples, FL 34102",
    message: "Please ring the bell twice.",
    ...overrides,
  };
}

describe("orders", () => {
  beforeEach(async () => {
    await clearDatabase();
    await OrderModel.syncIndexes();
  });

  it("lets a customer place an order without any payment step", async () => {
    const { itemId } = await seedApprovedItem();
    const customer = await createTestUser({ role: "customer" });

    const response = await request(app)
      .post("/api/orders")
      .set("Authorization", await authorizationFor(customer))
      .send(orderPayload(itemId));

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("pending");
    expect(response.body.statusHistory).toHaveLength(1);
    expect(response.body.statusHistory[0].status).toBe("pending");
    expect(response.body.itemName).toBe("Pepperoni Pizza");
  });

  it("blocks vendors and admins from placing orders", async () => {
    const { itemId, vendor, admin } = await seedApprovedItem();

    const asVendor = await request(app)
      .post("/api/orders")
      .set("Authorization", await authorizationFor(vendor))
      .send(orderPayload(itemId));
    expect(asVendor.status).toBe(403);

    const asAdmin = await request(app)
      .post("/api/orders")
      .set("Authorization", await authorizationFor(admin))
      .send(orderPayload(itemId));
    expect(asAdmin.status).toBe(403);
  });

  it("rejects a second active order for the same item and date", async () => {
    const { itemId } = await seedApprovedItem();
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);

    await request(app).post("/api/orders").set("Authorization", auth).send(orderPayload(itemId)).expect(201);

    const duplicate = await request(app)
      .post("/api/orders")
      .set("Authorization", auth)
      .send(orderPayload(itemId));

    expect(duplicate.status).toBe(409);
  });

  it("prevents concurrent duplicate active orders for the same item and date at the database level", async () => {
    const { itemId } = await seedApprovedItem();
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);
    const payload = orderPayload(itemId);

    const [a, b] = await Promise.all([
      request(app).post("/api/orders").set("Authorization", auth).send(payload),
      request(app).post("/api/orders").set("Authorization", auth).send(payload),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const count = await OrderModel.countDocuments({
      itemId,
      deliveryDate: new Date(`${payload.deliveryDate}T00:00:00.000Z`),
    });
    expect(count).toBe(1);
  });

  it("rejects past delivery dates and unknown items", async () => {
    const { itemId } = await seedApprovedItem();
    const customer = await createTestUser({ role: "customer" });
    const auth = await authorizationFor(customer);

    const past = await request(app)
      .post("/api/orders")
      .set("Authorization", auth)
      .send(orderPayload(itemId, { deliveryDate: "2020-01-01" }));
    expect(past.status).toBe(422);

    const missing = await request(app)
      .post("/api/orders")
      .set("Authorization", auth)
      .send(orderPayload("64b7f1f1f1f1f1f1f1f1f1f1"));
    expect(missing.status).toBe(404);
  });

  it("records the vendor decision in the order timeline", async () => {
    const { itemId, vendor } = await seedApprovedItem();
    const customer = await createTestUser({ role: "customer" });

    const order = await request(app)
      .post("/api/orders")
      .set("Authorization", await authorizationFor(customer))
      .send(orderPayload(itemId))
      .expect(201);

    const accepted = await request(app)
      .patch(`/api/orders/${order.body.id}/status`)
      .set("Authorization", await authorizationFor(vendor))
      .send({ status: "accepted", note: "In the oven" });

    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("accepted");
    expect(accepted.body.statusHistory).toHaveLength(2);
    expect(accepted.body.statusHistory[1].changedByRole).toBe("vendor");
    expect(accepted.body.statusHistory[1].note).toBe("In the oven");

    const secondVendor = await createTestUser({ role: "vendor" });
    const foreign = await request(app)
      .patch(`/api/orders/${order.body.id}/status`)
      .set("Authorization", await authorizationFor(secondVendor))
      .send({ status: "rejected" });
    expect(foreign.status).toBe(403);
  });

  it("only allows a customer to cancel their own pending order", async () => {
    const { itemId } = await seedApprovedItem();
    const owner = await createTestUser({ role: "customer" });
    const stranger = await createTestUser({ role: "customer" });

    const order = await request(app)
      .post("/api/orders")
      .set("Authorization", await authorizationFor(owner))
      .send(orderPayload(itemId))
      .expect(201);

    const strangerCancel = await request(app)
      .patch(`/api/orders/${order.body.id}/status`)
      .set("Authorization", await authorizationFor(stranger))
      .send({ status: "cancelled" });
    expect(strangerCancel.status).toBe(403);

    const ownerAccept = await request(app)
      .patch(`/api/orders/${order.body.id}/status`)
      .set("Authorization", await authorizationFor(owner))
      .send({ status: "accepted" });
    expect(ownerAccept.status).toBe(403);

    const cancelled = await request(app)
      .patch(`/api/orders/${order.body.id}/status`)
      .set("Authorization", await authorizationFor(owner))
      .send({ status: "cancelled" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
  });

  it("prevents administrators from changing order statuses", async () => {
    const { itemId, admin } = await seedApprovedItem();
    const customer = await createTestUser({ role: "customer" });

    const order = await request(app)
      .post("/api/orders")
      .set("Authorization", await authorizationFor(customer))
      .send(orderPayload(itemId))
      .expect(201);

    const response = await request(app)
      .patch(`/api/orders/${order.body.id}/status`)
      .set("Authorization", await authorizationFor(admin))
      .send({ status: "accepted" });

    expect(response.status).toBe(403);
  });

  it("scopes order lists to the authenticated party", async () => {
    const { itemId, vendor } = await seedApprovedItem();
    const customer = await createTestUser({ role: "customer" });
    const otherVendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });

    await request(app)
      .post("/api/orders")
      .set("Authorization", await authorizationFor(customer))
      .send(orderPayload(itemId))
      .expect(201);

    const customerList = await request(app)
      .get("/api/orders")
      .set("Authorization", await authorizationFor(customer));
    expect(customerList.body.total).toBe(1);

    const vendorList = await request(app)
      .get("/api/orders")
      .set("Authorization", await authorizationFor(vendor));
    expect(vendorList.body.total).toBe(1);

    const otherVendorList = await request(app)
      .get("/api/orders")
      .set("Authorization", await authorizationFor(otherVendor));
    expect(otherVendorList.body.total).toBe(0);

    // Admins moderate the platform but do not read individual order details.
    const adminList = await request(app)
      .get("/api/orders")
      .set("Authorization", await authorizationFor(admin));
    expect(adminList.body.total).toBe(1);
  });
});
