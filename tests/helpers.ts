import { ObjectId } from "mongodb";
import { getDb } from "../src/lib/mongo.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { toAppUser } from "../src/lib/user-repository.js";
import type { AppUser, SubscriptionPlan, UserRole } from "../src/types/index.js";

interface CreateUserOptions {
  role?: UserRole;
  name?: string;
  email?: string;
  businessName?: string | null;
  isBlocked?: boolean;
  roleOnboarded?: boolean;
  subscriptionPlan?: SubscriptionPlan;
  subscriptionExpiresAt?: Date | null;
  favorites?: string[];
}

let sequence = 0;

/** Inserts a real `users` document and returns it in the app's shape. */
export async function createTestUser(
  options: CreateUserOptions = {},
): Promise<AppUser> {
  sequence += 1;
  const email =
    options.email ?? `user${sequence}-${Date.now()}@pizzahub.test`;

  const doc = {
    _id: new ObjectId(),
    name: options.name ?? `Test User ${sequence}`,
    email: email.toLowerCase(),
    emailVerified: true,
    image: null,
    role: options.role ?? "customer",
    isBlocked: options.isBlocked ?? false,
    businessName: options.businessName ?? null,
    roleOnboarded: options.roleOnboarded ?? true,
    subscriptionPlan: options.subscriptionPlan ?? "free",
    subscriptionExpiresAt: options.subscriptionExpiresAt ?? null,
    stripeCustomerId: null,
    favorites: options.favorites ?? [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await getDb().collection("users").insertOne(doc);
  return toAppUser(doc);
}

export async function accessTokenFor(user: AppUser): Promise<string> {
  return signAccessToken({ sub: user.id, role: user.role });
}

export async function authorizationFor(user: AppUser): Promise<string> {
  return `Bearer ${await accessTokenFor(user)}`;
}

/** Clears business collections between test cases. */
export async function clearDatabase(): Promise<void> {
  const db = getDb();
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  await Promise.all(
    collections.map((collection) => db.collection(collection.name).deleteMany({})),
  );
}

export function futureDate(daysFromNow = 7): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}
