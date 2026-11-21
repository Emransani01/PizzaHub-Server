import { Types } from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { updateUser } from "../src/lib/user-repository.js";
import {
  ensureMenuItemIndexes,
  MenuItemModel,
} from "../src/modules/menu-items/menu-item.model.js";
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

async function createPendingItem(
  token: string,
  itemName: string,
  isAvailable = true,
): Promise<string> {
  const created = await createItem(token, { itemName, isAvailable });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

function approveItem(adminAuth: string, itemId: string) {
  return request(app)
    .patch(`/api/menu-items/${itemId}/status`)
    .set("Authorization", adminAuth)
    .send({ status: "approved" });
}

async function countActive(vendorId: string): Promise<number> {
  return MenuItemModel.countDocuments({
    vendorId: new Types.ObjectId(vendorId),
    status: "approved",
    isAvailable: true,
  });
}

/** Simulates a pre-9.6 document that was paused via availability alone. */
async function persistLegacyPaused(itemId: string) {
  await MenuItemModel.findByIdAndUpdate(new Types.ObjectId(itemId), {
    $set: { status: "approved", isAvailable: false },
  });
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

  it("marks an approved item inactive when the vendor pauses availability", async () => {
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
    expect(updated.body.status).toBe("inactive");
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

    const combined = await request(app)
      .get("/api/menu-items")
      .query({
        category: "Vegetarian Pizzas",
        location: "Bonita Springs, FL",
        search: "garden",
        sort: "price_asc",
      });
    expect(combined.body.total).toBe(1);
    expect(combined.body.items[0].itemName).toBe("Garden Veggie");
  });

  it("returns 400 for a malformed menu id and 404 for a well-formed missing id", async () => {
    const malformed = await request(app).get("/api/menu-items/not-an-object-id");
    expect(malformed.status).toBe(400);
    expect(malformed.body.message).toContain("not valid");

    const missing = await request(app).get(
      "/api/menu-items/64b7f1f1f1f1f1f1f1f1f1f1",
    );
    expect(missing.status).toBe(404);
    expect(missing.body.message).toContain("not found");
  });

  it("treats an approved but unavailable item as inactive while preserving owner and admin review access", async () => {
    const vendor = await createTestUser({ role: "vendor", businessName: "Napoli" });
    const admin = await createTestUser({ role: "admin" });
    const customer = await createTestUser({ role: "customer" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);
    const customerAuth = await authorizationFor(customer);

    const created = await createItem(vendorAuth, {
      itemName: "Paused Margherita",
    });
    await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" })
      .expect(200);

    const paused = await request(app)
      .patch(`/api/menu-items/${created.body.id}`)
      .set("Authorization", vendorAuth)
      .send({ isAvailable: false });
    expect(paused.status).toBe(200);
    expect(paused.body.status).toBe("inactive");
    expect(paused.body.isAvailable).toBe(false);

    const publicList = await request(app).get("/api/menu-items");
    expect(publicList.body.total).toBe(0);

    const customerDetail = await request(app)
      .get(`/api/menu-items/${created.body.id}`)
      .set("Authorization", customerAuth);
    expect(customerDetail.status).toBe(404);

    for (const auth of [vendorAuth, adminAuth]) {
      const detail = await request(app)
        .get(`/api/menu-items/${created.body.id}`)
        .set("Authorization", auth);
      expect(detail.status).toBe(200);
      expect(detail.body.status).toBe("inactive");
      expect(detail.body.isAvailable).toBe(false);
    }

    const approvedList = await request(app)
      .get("/api/menu-items/admin")
      .query({ status: "approved" })
      .set("Authorization", adminAuth);
    expect(approvedList.status).toBe(200);
    expect(approvedList.body.items).toHaveLength(0);

    const inactiveList = await request(app)
      .get("/api/menu-items/admin")
      .query({ status: "inactive" })
      .set("Authorization", adminAuth);
    expect(inactiveList.status).toBe(200);
    expect(inactiveList.body.items).toEqual([
      expect.objectContaining({
        id: created.body.id,
        status: "inactive",
        isAvailable: false,
      }),
    ]);
  });

  it("never lets a vendor approve its own pending item", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);

    const created = await createItem(vendorAuth, {
      itemName: "Self Approval Attempt",
    });

    const attempt = await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", vendorAuth)
      .send({ status: "approved" });
    expect(attempt.status).toBe(403);

    const review = await request(app)
      .get(`/api/menu-items/${created.body.id}`)
      .set("Authorization", adminAuth);
    expect(review.status).toBe(200);
    expect(review.body.status).toBe("pending");

    const adminApprove = await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" });
    expect(adminApprove.status).toBe(200);
    expect(adminApprove.body.status).toBe("approved");
  });

  it("lets an admin reject a pending item with a reason and then re-approve it", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);

    const created = await createItem(vendorAuth, {
      itemName: "Review Me",
    });

    const rejected = await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "rejected", reason: "Please fix the description." });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("rejected");
    expect(rejected.body.rejectionReason).toBe("Please fix the description.");

    const publicList = await request(app).get("/api/menu-items");
    expect(publicList.body.total).toBe(0);

    const vendorView = await request(app)
      .get(`/api/menu-items/${created.body.id}`)
      .set("Authorization", vendorAuth);
    expect(vendorView.status).toBe(200);
    expect(vendorView.body.status).toBe("rejected");
    expect(vendorView.body.rejectionReason).toBe("Please fix the description.");

    const reapproved = await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" });
    expect(reapproved.status).toBe(200);
    expect(reapproved.body.status).toBe("approved");
    expect(reapproved.body.rejectionReason).toBeNull();
  });

  it("supports a first-class inactive status and reactivation", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);

    const created = await createItem(vendorAuth, {
      itemName: "First-Class Inactive Pizza",
    });
    await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" })
      .expect(200);

    const deactivated = await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "inactive" });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe("inactive");
    expect(deactivated.body.isAvailable).toBe(false);

    const publicWhileInactive = await request(app).get("/api/menu-items");
    expect(publicWhileInactive.body.total).toBe(0);

    const reactivated = await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.status).toBe("approved");
    expect(reactivated.body.isAvailable).toBe(true);

    const publicAfterReactivation = await request(app).get("/api/menu-items");
    expect(publicAfterReactivation.body.total).toBe(1);
  });

  it("reports separate approved and inactive dashboard counts", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);

    const active = await createItem(vendorAuth, { itemName: "Dashboard Active" });
    const inactive = await createItem(vendorAuth, {
      itemName: "Dashboard Inactive",
    });
    const legacy = await createItem(vendorAuth, {
      itemName: "Dashboard Legacy Inactive",
    });
    await createItem(vendorAuth, { itemName: "Dashboard Pending" });

    await request(app)
      .patch(`/api/menu-items/${active.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" })
      .expect(200);
    await request(app)
      .patch(`/api/menu-items/${inactive.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "inactive" })
      .expect(200);
    await request(app)
      .patch(`/api/menu-items/${legacy.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" })
      .expect(200);
    await persistLegacyPaused(legacy.body.id);

    const vendorOverview = await request(app)
      .get("/api/dashboard/overview")
      .set("Authorization", vendorAuth);
    expect(vendorOverview.status).toBe(200);
    expect(vendorOverview.body.stats).toMatchObject({
      totalItems: 4,
      activeItems: 1,
      approvedItems: 1,
      inactiveItems: 2,
      pendingItems: 1,
      rejectedItems: 0,
    });

    const adminOverview = await request(app)
      .get("/api/dashboard/overview")
      .set("Authorization", adminAuth);
    expect(adminOverview.status).toBe(200);
    expect(adminOverview.body.stats).toMatchObject({
      totalItems: 4,
      vendors: 1,
      customers: 0,
      approvedItems: 1,
      inactiveItems: 2,
      pendingItems: 1,
      rejectedItems: 0,
    });

    for (const stats of [
      vendorOverview.body.stats,
      adminOverview.body.stats,
    ]) {
      expect(
        stats.approvedItems +
          stats.inactiveItems +
          stats.pendingItems +
          stats.rejectedItems,
      ).toBe(stats.totalItems);
    }
  });

  it("reactivates a legacy approved but unavailable item when an admin approves it", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);

    const created = await createItem(vendorAuth, {
      itemName: "Legacy Paused Pizza",
    });
    await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" })
      .expect(200);
    await persistLegacyPaused(created.body.id);

    const hidden = await request(app).get("/api/menu-items");
    expect(hidden.body.total).toBe(0);

    const reactivated = await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.status).toBe("approved");
    expect(reactivated.body.isAvailable).toBe(true);

    const publicAfter = await request(app).get("/api/menu-items");
    expect(publicAfter.body.total).toBe(1);
  });

  it("reactivates an unavailable rejected item when an admin re-approves it", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);

    const created = await createItem(vendorAuth, {
      itemName: "Rejected Paused Pizza",
      isAvailable: false,
    });
    await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "rejected", reason: "Fix the description." })
      .expect(200);

    const reapproved = await request(app)
      .patch(`/api/menu-items/${created.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" });
    expect(reapproved.status).toBe(200);
    expect(reapproved.body.status).toBe("approved");
    expect(reapproved.body.isAvailable).toBe(true);
    expect(reapproved.body.rejectionReason).toBeNull();

    const publicAfter = await request(app).get("/api/menu-items");
    expect(publicAfter.body.total).toBe(1);
  });

  it("applies free-plan capacity when reactivating a legacy paused item", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const premiumVendor = await createTestUser({
      role: "vendor",
      businessName: "Premium Kitchen",
      subscriptionPlan: "premium",
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const admin = await createTestUser({ role: "admin" });
    const vendorAuth = await authorizationFor(vendor);
    const premiumAuth = await authorizationFor(premiumVendor);
    const adminAuth = await authorizationFor(admin);

    const blocked = await createItem(vendorAuth, {
      itemName: "Legacy Over Capacity",
    });
    await request(app)
      .patch(`/api/menu-items/${blocked.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" })
      .expect(200);
    await persistLegacyPaused(blocked.body.id);

    for (let index = 0; index < 3; index += 1) {
      const created = await createItem(vendorAuth, {
        itemName: `Capacity Item ${index + 1}`,
      });
      await request(app)
        .patch(`/api/menu-items/${created.body.id}/status`)
        .set("Authorization", adminAuth)
        .send({ status: "approved" })
        .expect(200);
    }

    const rejected = await request(app)
      .patch(`/api/menu-items/${blocked.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" });
    expect(rejected.status).toBe(409);
    expect(rejected.body.message).toContain("at most 3");

    const premiumItem = await createItem(premiumAuth, {
      itemName: "Premium Legacy Item",
    });
    await request(app)
      .patch(`/api/menu-items/${premiumItem.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" })
      .expect(200);
    await persistLegacyPaused(premiumItem.body.id);

    const allowed = await request(app)
      .patch(`/api/menu-items/${premiumItem.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" });
    expect(allowed.status).toBe(200);
    expect(allowed.body.isAvailable).toBe(true);
  });

  it("hides inactive and legacy paused items from public discovery endpoints and favourites", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });
    const customer = await createTestUser({ role: "customer" });
    const vendorAuth = await authorizationFor(vendor);
    const adminAuth = await authorizationFor(admin);
    const customerAuth = await authorizationFor(customer);

    const active = await createItem(vendorAuth, {
      itemName: "Public Discovery Pizza",
      category: "Classic Pizzas",
      location: "Public Kitchen",
    });
    await request(app)
      .patch(`/api/menu-items/${active.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" })
      .expect(200);

    const firstClassInactive = await createItem(vendorAuth, {
      itemName: "Hidden Inactive Pizza",
      category: "Classic Pizzas",
      location: "Inactive Kitchen",
    });
    await request(app)
      .patch(`/api/menu-items/${firstClassInactive.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "inactive" })
      .expect(200);

    const legacy = await createItem(vendorAuth, {
      itemName: "Hidden Legacy Pizza",
      category: "Classic Pizzas",
      location: "Legacy Kitchen",
    });
    await request(app)
      .patch(`/api/menu-items/${legacy.body.id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "approved" })
      .expect(200);
    await persistLegacyPaused(legacy.body.id);

    const locations = await request(app).get("/api/menu-items/locations");
    expect(locations.status).toBe(200);
    expect(locations.body.locations).toEqual(["Public Kitchen"]);

    const featured = await request(app).get("/api/menu-items/featured");
    expect(featured.status).toBe(200);
    expect(featured.body.items).toEqual([
      expect.objectContaining({ id: active.body.id }),
    ]);

    const categories = await request(app).get("/api/menu-items/categories");
    expect(categories.status).toBe(200);
    expect(
      categories.body.categories.reduce(
        (sum: number, entry: { count: number }) => sum + entry.count,
        0,
      ),
    ).toBe(1);

    for (const itemId of [firstClassInactive.body.id, legacy.body.id]) {
      const attempt = await request(app)
        .post(`/api/favorites/${itemId}`)
        .set("Authorization", customerAuth);
      expect(attempt.status).toBe(404);
    }

    await request(app)
      .post(`/api/favorites/${active.body.id}`)
      .set("Authorization", customerAuth)
      .expect(200);

    const favorites = await request(app)
      .get("/api/favorites")
      .set("Authorization", customerAuth);
    expect(favorites.status).toBe(200);
    expect(favorites.body.items).toEqual([
      expect.objectContaining({ id: active.body.id }),
    ]);
  });

  describe("atomic free-plan capacity", () => {
    it("builds the mandatory unique active-slot index at startup and never exposes it", async () => {
      const indexes = await MenuItemModel.collection.indexes();
      const slotIndex = indexes.find(
        (index) => index.name === "uniq_vendor_active_slot",
      );
      expect(slotIndex).toBeDefined();
      expect(slotIndex?.unique).toBe(true);
      expect(slotIndex?.key).toEqual({ vendorId: 1, activeSlot: 1 });

      const vendor = await createTestUser({ role: "vendor" });
      const created = await createItem(await authorizationFor(vendor));
      expect(created.status).toBe(201);
      expect(created.body).not.toHaveProperty("activeSlot");

      const buildSpy = vi
        .spyOn(MenuItemModel, "createIndexes")
        .mockRejectedValueOnce(new Error("index build failed"));
      try {
        await expect(ensureMenuItemIndexes()).rejects.toThrow(
          "index build failed",
        );
      } finally {
        buildSpy.mockRestore();
      }
    });

    it("allows only three of four concurrent approvals from an empty active set", async () => {
      const vendor = await createTestUser({ role: "vendor" });
      const admin = await createTestUser({ role: "admin" });
      const vendorAuth = await authorizationFor(vendor);
      const adminAuth = await authorizationFor(admin);
      const ids = await Promise.all(
        [1, 2, 3, 4].map((n) => createPendingItem(vendorAuth, `Race ${n}`)),
      );

      const results = await Promise.all(
        ids.map((id) => approveItem(adminAuth, id)),
      );

      expect(results.map((result) => result.status).sort()).toEqual([
        200, 200, 200, 409,
      ]);
      expect(results.filter((result) => result.status === 409)[0].body.message).toContain(
        "at most 3",
      );
      expect(await countActive(vendor.id)).toBe(3);
      const slots = await MenuItemModel.find({
        vendorId: new Types.ObjectId(vendor.id),
        activeSlot: { $ne: null },
      }).select("activeSlot");
      expect(slots).toHaveLength(3);
      expect(new Set(slots.map((item) => item.activeSlot)).size).toBe(3);
    });

    it("blocks one of two concurrent admin approvals at capacity", async () => {
      const vendor = await createTestUser({ role: "vendor" });
      const admin = await createTestUser({ role: "admin" });
      const vendorAuth = await authorizationFor(vendor);
      const adminAuth = await authorizationFor(admin);
      const active = await Promise.all(
        [1, 2].map((n) => createPendingItem(vendorAuth, `Active ${n}`)),
      );
      for (const id of active) await approveItem(adminAuth, id).expect(200);

      const pending = await Promise.all(
        [1, 2].map((n) => createPendingItem(vendorAuth, `Pending ${n}`)),
      );
      const results = await Promise.all(
        pending.map((id) => approveItem(adminAuth, id)),
      );

      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      expect(await countActive(vendor.id)).toBe(3);
    });

    it("blocks one of two concurrent vendor reactivations at capacity", async () => {
      const vendor = await createTestUser({ role: "vendor" });
      const admin = await createTestUser({ role: "admin" });
      const vendorAuth = await authorizationFor(vendor);
      const adminAuth = await authorizationFor(admin);
      const ids = await Promise.all(
        [1, 2, 3, 4].map((n) => createPendingItem(vendorAuth, `Toggle ${n}`)),
      );
      for (const id of ids.slice(0, 2)) await approveItem(adminAuth, id).expect(200);
      for (const id of ids.slice(2)) {
        await request(app)
          .patch(`/api/menu-items/${id}`)
          .set("Authorization", vendorAuth)
          .send({ isAvailable: false })
          .expect(200);
        await approveItem(adminAuth, id).expect(200);
      }

      const results = await Promise.all(
        [ids[2], ids[3]].map((id) =>
          request(app)
            .patch(`/api/menu-items/${id}`)
            .set("Authorization", vendorAuth)
            .send({ isAvailable: true }),
        ),
      );

      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      expect(await countActive(vendor.id)).toBe(3);
    });

    it("frees capacity on deactivation and rejection, and rechecks on reapproval", async () => {
      const vendor = await createTestUser({ role: "vendor" });
      const admin = await createTestUser({ role: "admin" });
      const vendorAuth = await authorizationFor(vendor);
      const adminAuth = await authorizationFor(admin);
      const ids = await Promise.all(
        [1, 2, 3, 4].map((n) => createPendingItem(vendorAuth, `Cycle ${n}`)),
      );
      for (const id of ids.slice(0, 3)) await approveItem(adminAuth, id).expect(200);

      await request(app)
        .patch(`/api/menu-items/${ids[0]}/status`)
        .set("Authorization", adminAuth)
        .send({ status: "inactive" })
        .expect(200);
      expect(await countActive(vendor.id)).toBe(2);
      await approveItem(adminAuth, ids[3]).expect(200);
      expect(await countActive(vendor.id)).toBe(3);

      await request(app)
        .patch(`/api/menu-items/${ids[1]}/status`)
        .set("Authorization", adminAuth)
        .send({ status: "rejected", reason: "Review" })
        .expect(200);
      expect(await countActive(vendor.id)).toBe(2);
      await approveItem(adminAuth, ids[0]).expect(200);

      const overCapacity = await approveItem(adminAuth, ids[1]);
      expect(overCapacity.status).toBe(409);
      expect(overCapacity.body.message).toContain("at most 3");
    });

    it("skips the capacity check when a vendor content edit returns an item to pending", async () => {
      const vendor = await createTestUser({ role: "vendor" });
      const admin = await createTestUser({ role: "admin" });
      const vendorAuth = await authorizationFor(vendor);
      const adminAuth = await authorizationFor(admin);
      const ids = await Promise.all(
        [1, 2, 3, 4].map((n) => createPendingItem(vendorAuth, `Edit ${n}`)),
      );
      for (const id of ids.slice(0, 3)) await approveItem(adminAuth, id).expect(200);

      const edited = await request(app)
        .patch(`/api/menu-items/${ids[0]}`)
        .set("Authorization", vendorAuth)
        .send({ description: "A newly edited and detailed description for review." });
      expect(edited.status).toBe(200);
      expect(edited.body.status).toBe("pending");
      expect(edited.body.isAvailable).toBe(true);
      expect(await countActive(vendor.id)).toBe(2);

      await approveItem(adminAuth, ids[3]).expect(200);
      expect(await countActive(vendor.id)).toBe(3);
      expect(
        (await MenuItemModel.findById(ids[0]))?.activeSlot ?? null,
      ).toBeNull();
    });

    it("repairs legacy unslotted active items and stale slots before claiming", async () => {
      const vendor = await createTestUser({ role: "vendor" });
      const admin = await createTestUser({ role: "admin" });
      const vendorAuth = await authorizationFor(vendor);
      const adminAuth = await authorizationFor(admin);
      const ids = await Promise.all(
        [1, 2, 3, 4].map((n) => createPendingItem(vendorAuth, `Legacy ${n}`)),
      );
      for (const id of ids.slice(0, 3)) await approveItem(adminAuth, id).expect(200);

      await MenuItemModel.updateMany(
        { status: "approved", isAvailable: true },
        { $set: { activeSlot: null } },
      );
      const blocked = await approveItem(adminAuth, ids[3]);
      expect(blocked.status).toBe(409);
      expect(await countActive(vendor.id)).toBe(3);

      await request(app)
        .patch(`/api/menu-items/${ids[0]}/status`)
        .set("Authorization", adminAuth)
        .send({ status: "inactive" })
        .expect(200);
      await MenuItemModel.updateOne(
        { _id: new Types.ObjectId(ids[0]) },
        { $set: { activeSlot: 2 } },
      );
      await approveItem(adminAuth, ids[3]).expect(200);
      expect((await MenuItemModel.findById(ids[0]))?.activeSlot ?? null).toBeNull();
      expect((await MenuItemModel.findById(ids[3]))?.activeSlot).toEqual(
        expect.any(Number),
      );
    });

    it("does not swallow non-duplicate database errors", async () => {
      const vendor = await createTestUser({ role: "vendor" });
      const admin = await createTestUser({ role: "admin" });
      const id = await createPendingItem(await authorizationFor(vendor), "DB Error Item");

      const spy = vi
        .spyOn(MenuItemModel, "findOneAndUpdate")
        .mockRejectedValueOnce(new Error("simulated database failure"));
      try {
        const response = await approveItem(await authorizationFor(admin), id);
        expect(response.status).toBe(500);
        expect((await MenuItemModel.findById(id))?.status).toBe("pending");
      } finally {
        spy.mockRestore();
      }
    });

    it("returns a conflict instead of overwriting a concurrent edit of one item", async () => {
      const vendor = await createTestUser({ role: "vendor" });
      const admin = await createTestUser({ role: "admin" });
      const vendorAuth = await authorizationFor(vendor);
      const id = await createPendingItem(vendorAuth, "Same Item Race");
      await approveItem(await authorizationFor(admin), id).expect(200);

      const [first, second] = await Promise.all([
        request(app)
          .patch(`/api/menu-items/${id}`)
          .set("Authorization", vendorAuth)
          .send({ itemName: "Renamed Item" }),
        request(app)
          .patch(`/api/menu-items/${id}`)
          .set("Authorization", vendorAuth)
          .send({ description: "A concurrent replacement description for this item." }),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 409]);
    });
  });

  describe("premium expiry boundary", () => {
    it("allows unlimited concurrent activations while Premium is active", async () => {
      const vendor = await createTestUser({
        role: "vendor",
        subscriptionPlan: "premium",
        subscriptionExpiresAt: new Date(Date.now() + 86_400_000),
      });
      const admin = await createTestUser({ role: "admin" });
      const vendorAuth = await authorizationFor(vendor);
      const adminAuth = await authorizationFor(admin);
      const ids = await Promise.all(
        [1, 2, 3, 4].map((n) => createPendingItem(vendorAuth, `Premium ${n}`)),
      );

      const results = await Promise.all(
        ids.map((id) => approveItem(adminAuth, id)),
      );
      expect(results.every((result) => result.status === 200)).toBe(true);
      expect(await countActive(vendor.id)).toBe(4);
    });

    it("applies the free-plan cap after expiry without deactivating existing items", async () => {
      const vendor = await createTestUser({
        role: "vendor",
        subscriptionPlan: "premium",
        subscriptionExpiresAt: new Date(Date.now() + 86_400_000),
      });
      const admin = await createTestUser({ role: "admin" });
      const vendorAuth = await authorizationFor(vendor);
      const adminAuth = await authorizationFor(admin);
      const ids = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => createPendingItem(vendorAuth, `Downgrade ${n}`)),
      );
      for (const id of ids) await approveItem(adminAuth, id).expect(200);

      await updateUser(vendor.id, {
        subscriptionExpiresAt: new Date(Date.now() - 1_000),
      });
      const blocked = await approveItem(
        adminAuth,
        await createPendingItem(vendorAuth, "After Downgrade"),
      );
      expect(blocked.status).toBe(409);
      expect(await countActive(vendor.id)).toBe(5);

      for (const id of ids.slice(0, 2)) {
        await request(app)
          .patch(`/api/menu-items/${id}/status`)
          .set("Authorization", adminAuth)
          .send({ status: "inactive" })
          .expect(200);
      }
      const stillBlocked = await approveItem(
        adminAuth,
        await createPendingItem(vendorAuth, "Still Over Limit"),
      );
      expect(stillBlocked.status).toBe(409);

      await request(app)
        .patch(`/api/menu-items/${ids[2]}/status`)
        .set("Authorization", adminAuth)
        .send({ status: "inactive" })
        .expect(200);
      const allowed = await approveItem(
        adminAuth,
        await createPendingItem(vendorAuth, "Back Under Limit"),
      );
      expect(allowed.status).toBe(200);
      expect(await countActive(vendor.id)).toBe(3);
    });

    it("treats an expired subscription as free at the exact boundary", async () => {
      const vendor = await createTestUser({
        role: "vendor",
        subscriptionPlan: "premium",
        subscriptionExpiresAt: new Date(Date.now() - 1),
      });
      const admin = await createTestUser({ role: "admin" });
      const ids = await Promise.all(
        [1, 2, 3, 4].map(async (n) =>
          createPendingItem(await authorizationFor(vendor), `Expired ${n}`),
        ),
      );
      const results = await Promise.all(
        ids.map(async (id) => approveItem(await authorizationFor(admin), id)),
      );
      expect(results.map((result) => result.status).sort()).toEqual([
        200, 200, 200, 409,
      ]);
    });
  });
});
