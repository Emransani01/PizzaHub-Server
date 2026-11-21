import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("only lets customers order approved and available items", async () => {
    const vendor = await createTestUser({ role: "vendor", businessName: "Napoli" });
    const admin = await createTestUser({ role: "admin" });
    const customer = await createTestUser({ role: "customer" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);
    const customerAuth = await authorizationFor(customer);

    async function createNamedItem(itemName: string): Promise<string> {
      const created = await request(app)
        .post("/api/menu-items")
        .set("Authorization", vendorAuth)
        .send({
          itemName,
          category: "Classic Pizzas",
          description: "A properly described pizza for status tests.",
          price: 11.5,
          location: "Naples, FL",
          images: ["https://images.pizzahub.test/status.jpg"],
        })
        .expect(201);
      return created.body.id as string;
    }

    const pendingId = await createNamedItem("Pending Pizza");
    const rejectedId = await createNamedItem("Rejected Pizza");
    const inactiveId = await createNamedItem("Inactive Pizza");
    const firstClassInactiveId = await createNamedItem("Stored Inactive Pizza");
    const activeId = await createNamedItem("Active Pizza");

    await request(app)
      .patch(`/api/menu-items/${rejectedId}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "rejected", reason: "Not this time." })
      .expect(200);

    for (const id of [inactiveId, activeId]) {
      await request(app)
        .patch(`/api/menu-items/${id}/status`)
        .set("Authorization", adminAuth)
        .send({ status: "approved" })
        .expect(200);
    }

    await request(app)
      .patch(`/api/menu-items/${inactiveId}`)
      .set("Authorization", vendorAuth)
      .send({ isAvailable: false })
      .expect(200);

    await request(app)
      .patch(`/api/menu-items/${firstClassInactiveId}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "inactive" })
      .expect(200);

    for (const id of [
      pendingId,
      rejectedId,
      inactiveId,
      firstClassInactiveId,
    ]) {
      const blocked = await request(app)
        .post("/api/orders")
        .set("Authorization", customerAuth)
        .send(orderPayload(id));
      expect(blocked.status).toBe(409);
      expect(blocked.body.message).toContain("not currently available");
    }

    const allowed = await request(app)
      .post("/api/orders")
      .set("Authorization", customerAuth)
      .send(orderPayload(activeId));
    expect(allowed.status).toBe(201);
    expect(allowed.body.itemName).toBe("Active Pizza");
  });

  it("returns 404 for an unknown order id", async () => {
    const { vendor } = await seedApprovedItem();

    const response = await request(app)
      .patch("/api/orders/64b7f1f1f1f1f1f1f1f1f1f1")
      .set("Authorization", await authorizationFor(vendor))
      .send({ status: "accepted" });

    expect(response.status).toBe(404);
  });

  it("allows only one of two concurrent customer-cancel and vendor-accept requests", async () => {
    const { itemId, vendor } = await seedApprovedItem();
    const customer = await createTestUser({ role: "customer" });
    const order = await request(app)
      .post("/api/orders")
      .set("Authorization", await authorizationFor(customer))
      .send(orderPayload(itemId))
      .expect(201);

    const [cancelled, accepted] = await Promise.all([
      request(app)
        .patch(`/api/orders/${order.body.id}/status`)
        .set("Authorization", await authorizationFor(customer))
        .send({ status: "cancelled" }),
      request(app)
        .patch(`/api/orders/${order.body.id}/status`)
        .set("Authorization", await authorizationFor(vendor))
        .send({ status: "accepted", note: "In the oven" }),
    ]);

    expect([cancelled.status, accepted.status].sort()).toEqual([200, 409]);

    const stored = await OrderModel.findById(order.body.id);
    expect(stored).not.toBeNull();
    expect(stored?.status).toMatch(/^(accepted|cancelled)$/);
    expect(stored?.statusHistory).toHaveLength(2);
    expect(stored?.statusHistory.filter((entry) => entry.status !== "pending")).toHaveLength(1);

    const loser = cancelled.status === 409 ? cancelled : accepted;
    expect(loser.body.message).toContain("already");
    expect(loser.body.message).toContain("another request");
  });

  it("does not accept two concurrent identical vendor decisions", async () => {
    const { itemId, vendor } = await seedApprovedItem();
    const customer = await createTestUser({ role: "customer" });
    const order = await request(app)
      .post("/api/orders")
      .set("Authorization", await authorizationFor(customer))
      .send(orderPayload(itemId))
      .expect(201);

    const vendorAuth = await authorizationFor(vendor);
    const [first, second] = await Promise.all([
      request(app)
        .patch(`/api/orders/${order.body.id}/status`)
        .set("Authorization", vendorAuth)
        .send({ status: "accepted" }),
      request(app)
        .patch(`/api/orders/${order.body.id}/status`)
        .set("Authorization", vendorAuth)
        .send({ status: "accepted" }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const stored = await OrderModel.findById(order.body.id);
    expect(stored?.status).toBe("accepted");
    expect(stored?.statusHistory).toHaveLength(2);
    expect(stored?.statusHistory.filter((entry) => entry.status === "accepted")).toHaveLength(1);
  });

  it("keeps activeOrderKey on acceptance and releases it on rejection or cancellation", async () => {
    const { itemId, vendor } = await seedApprovedItem();
    const vendorAuth = await authorizationFor(vendor);
    const customer = await createTestUser({ role: "customer" });
    const customerAuth = await authorizationFor(customer);

    let sequence = 0;
    async function placeOrder() {
      const payload = orderPayload(itemId, {
        deliveryDate: futureDate(3 + sequence),
      });
      sequence += 1;
      const response = await request(app)
        .post("/api/orders")
        .set("Authorization", customerAuth)
        .send(payload)
        .expect(201);
      return { id: response.body.id as string, payload };
    }

    const accepted = await placeOrder();
    await request(app)
      .patch(`/api/orders/${accepted.id}/status`)
      .set("Authorization", vendorAuth)
      .send({ status: "accepted" })
      .expect(200);
    expect((await OrderModel.findById(accepted.id))?.activeOrderKey).toBeTruthy();
    await request(app)
      .post("/api/orders")
      .set("Authorization", customerAuth)
      .send(accepted.payload)
      .expect(409);

    for (const status of ["rejected", "cancelled"] as const) {
      const current = await placeOrder();
      const auth = status === "rejected" ? vendorAuth : customerAuth;
      await request(app)
        .patch(`/api/orders/${current.id}/status`)
        .set("Authorization", auth)
        .send({ status })
        .expect(200);
      expect((await OrderModel.findById(current.id))?.activeOrderKey).toBeNull();
      await request(app)
        .post("/api/orders")
        .set("Authorization", customerAuth)
        .send(current.payload)
        .expect(201);
    }
  });

  it("distinguishes a deleted order from a concurrent state change on a lost conditional update", async () => {
    const { itemId, vendor } = await seedApprovedItem();
    const customer = await createTestUser({ role: "customer" });
    const order = await request(app)
      .post("/api/orders")
      .set("Authorization", await authorizationFor(customer))
      .send(orderPayload(itemId))
      .expect(201);

    const realFindById = OrderModel.findById.bind(OrderModel);
    let findByIdCalls = 0;
    const findByIdSpy = vi.spyOn(OrderModel, "findById").mockImplementation(
      ((id: Parameters<typeof OrderModel.findById>[0]) => {
        findByIdCalls += 1;
        if (findByIdCalls === 2) {
          return { select: () => ({ lean: async () => null }) } as never;
        }
        return realFindById(id);
      }) as never,
    );
    const updateSpy = vi
      .spyOn(OrderModel, "findOneAndUpdate")
      .mockResolvedValueOnce(null as never);

    try {
      const response = await request(app)
        .patch(`/api/orders/${order.body.id}/status`)
        .set("Authorization", await authorizationFor(vendor))
        .send({ status: "accepted" });
      expect(response.status).toBe(404);
      expect(findByIdCalls).toBe(2);
    } finally {
      findByIdSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });
});
