import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  authorizationFor,
  clearDatabase,
  createTestUser,
} from "./helpers.js";

const app = createApp();

describe("access control", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it("returns 401 when no token is supplied", async () => {
    const response = await request(app).get("/api/users/me");
    expect(response.status).toBe(401);
    expect(response.body.message).toContain("Bearer");
  });

  it("returns 401 for a token signed with the wrong secret", async () => {
    const { SignJWT } = await import("jose");
    const customer = await createTestUser({ role: "customer" });

    const forged = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(customer.id)
      .setIssuer("pizzahub-api")
      .setAudience("pizzahub-client")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("a-different-secret"));

    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${forged}`);

    expect(response.status).toBe(401);
  });

  it("returns 401 for a correctly signed but expired token", async () => {
    const { SignJWT } = await import("jose");
    const customer = await createTestUser({ role: "customer" });

    const expired = await new SignJWT({ role: "customer" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(customer.id)
      .setIssuer("pizzahub-api")
      .setAudience("pizzahub-client")
      .setIssuedAt(new Date(Date.now() - 10 * 60 * 1000))
      .setExpirationTime(new Date(Date.now() - 5 * 60 * 1000))
      .sign(new TextEncoder().encode(process.env.JWT_SECRET ?? ""));

    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${expired}`);

    expect(response.status).toBe(401);
    expect(response.body.message).toContain("expired");
  });

  it("returns 401 for a malformed Bearer token", async () => {
    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", "Bearer not-a-jwt");

    expect(response.status).toBe(401);
    expect(response.body.message).toContain("Invalid or expired");
  });

  it("returns 403 for a blocked account", async () => {
    const blocked = await createTestUser({ role: "customer", isBlocked: true });

    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", await authorizationFor(blocked));

    expect(response.status).toBe(403);
    expect(response.body.message).toContain("blocked");
  });

  it("never trusts the role claim inside the token", async () => {
    const { SignJWT } = await import("jose");
    const customer = await createTestUser({ role: "customer" });

    // Correctly signed, but the claim says "admin" while the database says
    // "customer". The middleware must re-read the account from MongoDB.
    const escalated = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(customer.id)
      .setIssuer("pizzahub-api")
      .setAudience("pizzahub-client")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET ?? ""));

    const response = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${escalated}`);

    expect(response.status).toBe(403);
  });

  it("restricts the admin user list to administrators", async () => {
    const customer = await createTestUser({ role: "customer" });
    const vendor = await createTestUser({ role: "vendor" });
    const admin = await createTestUser({ role: "admin" });

    for (const user of [customer, vendor]) {
      const response = await request(app)
        .get("/api/users")
        .set("Authorization", await authorizationFor(user));
      expect(response.status).toBe(403);
    }

    const allowed = await request(app)
      .get("/api/users")
      .set("Authorization", await authorizationFor(admin));
    expect(allowed.status).toBe(200);
    expect(allowed.body.total).toBeGreaterThanOrEqual(3);
  });

  it("prevents blocking administrators and self-escalation", async () => {
    const admin = await createTestUser({ role: "admin" });
    const otherAdmin = await createTestUser({ role: "admin" });
    const customer = await createTestUser({ role: "customer" });

    const blockAdmin = await request(app)
      .patch(`/api/users/${otherAdmin.id}/block`)
      .set("Authorization", await authorizationFor(admin))
      .send({ blocked: true });
    expect(blockAdmin.status).toBe(403);

    const escalate = await request(app)
      .post("/api/users/me/role")
      .set("Authorization", await authorizationFor(customer))
      .send({ role: "admin" });
    expect(escalate.status).toBe(422);
  });

  it("only lets a vendor delete its own menu items", async () => {
    const vendor = await createTestUser({ role: "vendor" });
    const otherVendor = await createTestUser({ role: "vendor" });

    const created = await request(app)
      .post("/api/menu-items")
      .set("Authorization", await authorizationFor(vendor))
      .send({
        itemName: "Garlic Knots",
        category: "Sides & Appetizers",
        description: "Hand-tied knots with garlic butter and parsley.",
        price: 5.5,
        location: "Naples, FL",
        images: ["https://images.pizzahub.test/knots.jpg"],
      })
      .expect(201);

    const foreign = await request(app)
      .delete(`/api/menu-items/${created.body.id}`)
      .set("Authorization", await authorizationFor(otherVendor));
    expect(foreign.status).toBe(403);

    const own = await request(app)
      .delete(`/api/menu-items/${created.body.id}`)
      .set("Authorization", await authorizationFor(vendor));
    expect(own.status).toBe(204);
  });

  it("exposes payment records read-only and never lets an admin write one", async () => {
    const admin = await createTestUser({ role: "admin" });
    const auth = await authorizationFor(admin);

    const list = await request(app).get("/api/transactions").set("Authorization", auth);
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);

    const write = await request(app)
      .post("/api/transactions")
      .set("Authorization", auth)
      .send({ amount: 0, status: "paid" });
    expect(write.status).toBe(404);

    const patch = await request(app)
      .patch("/api/transactions/64b7f1f1f1f1f1f1f1f1f1f1")
      .set("Authorization", auth)
      .send({ status: "paid" });
    expect(patch.status).toBe(404);
  });

  it("returns 404 for unknown routes and validates query strings", async () => {
    const missing = await request(app).get("/api/does-not-exist");
    expect(missing.status).toBe(404);

    const admin = await createTestUser({ role: "admin" });
    const invalid = await request(app)
      .get("/api/users")
      .query({ limit: 500 })
      .set("Authorization", await authorizationFor(admin));
    expect(invalid.status).toBe(422);
  });
});
