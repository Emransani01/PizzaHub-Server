import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  authorizationFor,
  clearDatabase,
  createTestUser,
} from "./helpers.js";

const app = createApp();

function itemPayload(overrides: Record<string, unknown> = {}) {
  return {
    itemName: "Margherita Pizza",
    category: "Classic Pizzas",
    description: "San Marzano tomato, mozzarella and basil on a thin crust.",
    price: 12.99,
    location: "Naples, FL",
    images: ["https://images.pizzahub.test/margherita.jpg"],
    ...overrides,
  };
}

async function createItem(
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post("/api/menu-items")
    .set("Authorization", token)
    .send(itemPayload(overrides));
}

describe("menu items", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it("creates vendor items as pending and hides them from the public list", async () => {
    const vendor = await createTestUser({ role: "vendor", businessName: "Napoli" });
    const vendorAuth = await authorizationFor(vendor);

    const created = await createItem(vendorAuth);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("pending");
    expect(created.body.vendorId).toBe(vendor.id);

    const list = await request(app).get("/api/menu-items");
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(0);
    expect(list.body.total).toBe(0);
  });

  it("never allows a free vendor more than three approved and available items", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);

    const itemIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const created = await createItem(vendorAuth, {
        itemName: `Free Plan Item ${index + 1}`,
      });
      expect(created.status).toBe(201);
      itemIds.push(created.body.id);
    }

    for (const id of itemIds.slice(0, 3)) {
      const approved = await request(app)
        .patch(`/api/menu-items/${id}/status`)
        .set("Authorization", adminAuth)
        .send({ status: "approved" });
      expect(approved.status).toBe(200);
      expect(approved.body.status).toBe("approved");
    }

    const fourth = await request(app)
      .patch(`/api/menu-items/${itemIds[3]}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" });

    expect(fourth.status).toBe(409);
    expect(fourth.body.message).toContain("at most 3");

    const stored = await request(app)
      .get(`/api/menu-items/${itemIds[3]}`)
      .set("Authorization", adminAuth);
    expect(stored.body.status).toBe("pending");
  });

  it("does not count unavailable items against the free plan limit", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);

    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const created = await createItem(vendorAuth, {
        itemName: `Mixed Item ${index + 1}`,
        isAvailable: index < 3,
      });
      ids.push(created.body.id);
    }

    for (const id of ids.slice(0, 3)) {
      const approved = await request(app)
        .patch(`/api/menu-items/${id}/status`)
        .set("Authorization", adminAuth)
        .send({ status: "approved" });
      expect(approved.status).toBe(200);
    }

    // The vendor now has three approved items, but only two are active, so a
    // fourth item may be approved once it is marked unavailable.
    const unavailable = await request(app)
      .patch(`/api/menu-items/${ids[3]}`)
      .set("Authorization", vendorAuth)
      .send({ isAvailable: false });
    expect(unavailable.status).toBe(200);

    const approved = await request(app)
      .patch(`/api/menu-items/${ids[3]}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" });
    expect(approved.status).toBe(200);
  });

  it("allows Premium vendors to exceed the free plan limit", async () => {
    const vendor = await createTestUser({
      role: "vendor",
      subscriptionPlan: "premium",
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const admin = await createTestUser({ role: "admin" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);

    for (let index = 0; index < 5; index += 1) {
      const created = await createItem(vendorAuth, {
        itemName: `Premium Item ${index + 1}`,
      });
      const approved = await request(app)
        .patch(`/api/menu-items/${created.body.id}/status`)
        .set("Authorization", adminAuth)
        .send({ status: "approved" });
      expect(approved.status).toBe(200);
    }

    const listed = await request(app)
      .get("/api/menu-items")
      .query({ limit: 24, sort: "newest" });
    expect(listed.body.total).toBe(5);
  });

  it("sends an approved item back to review when the vendor edits it", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);

    const created = await createItem(vendorAuth);
    await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" })
      .expect(200);

    const updated = await request(app)
      .patch(`/api/menu-items/${created.body.id}`)
      .set("Authorization", vendorAuth)
      .send({ price: 15.5 });

    expect(updated.status).toBe(200);
    expect(updated.body.price).toBe(15.5);
    expect(updated.body.status).toBe("pending");

    const publicList = await request(app).get("/api/menu-items");
    expect(publicList.body.total).toBe(0);
  });

  it("keeps availability-only edits approved", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });

    const created = await createItem(await authorizationFor(vendor));
    await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", await authorizationFor(admin))
      .send({ status: "approved" })
      .expect(200);

    const updated = await request(app)
      .patch(`/api/menu-items/${created.body.id}`)
      .set("Authorization", await authorizationFor(vendor))
      .send({ isAvailable: false });

    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe("approved");
    expect(updated.body.isAvailable).toBe(false);
  });

  it("rejects overlapping price filters that are not supported and invalid input", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const vendorAuth = await authorizationFor(vendor);

    const badCategory = await createItem(vendorAuth, {
      category: "Pizza With Everything",
    });
    expect(badCategory.status).toBe(422);

    const badPrice = await createItem(vendorAuth, { price: -5 });
    expect(badPrice.status).toBe(422);

    const badImages = await createItem(vendorAuth, { images: [] });
    expect(badImages.status).toBe(422);
  });

  it("filters the public catalogue by category, location and search", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);

    const classic = await createItem(vendorAuth, {
      itemName: "Classic Cheese",
      category: "Classic Pizzas",
      location: "Naples, FL",
      price: 9.99,
    });
    const veggie = await createItem(vendorAuth, {
      itemName: "Garden Veggie",
      category: "Vegetarian Pizzas",
      location: "Bonita Springs, FL",
      price: 17.5,
    });

    for (const id of [classic.body.id, veggie.body.id]) {
      await request(app)
        .patch(`/api/menu-items/${id}/status`)
        .set("Authorization", adminAuth)
        .send({ status: "approved" })
        .expect(200);
    }

    const byCategory = await request(app)
      .get("/api/menu-items")
      .query({ category: "Vegetarian Pizzas" });
    expect(byCategory.body.total).toBe(1);
    expect(byCategory.body.items[0].itemName).toBe("Garden Veggie");

    const byLocation = await request(app)
      .get("/api/menu-items")
      .query({ location: "Naples, FL" });
    expect(byLocation.body.total).toBe(1);

    const bySearch = await request(app)
      .get("/api/menu-items")
      .query({ search: "garden" });
    expect(bySearch.body.total).toBe(1);

    const byPrice = await request(app)
      .get("/api/menu-items")
      .query({ sort: "price_asc" });
    expect(byPrice.body.items[0].itemName).toBe("Classic Cheese");
  });
});
