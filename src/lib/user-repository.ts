import { ObjectId, type Collection, type Document, type Filter } from "mongodb";
import { getDb } from "./mongo.js";
import { toObjectId } from "./object-id.js";
import type {
  AppUser,
  PublicUser,
  SubscriptionPlan,
  UserRole,
} from "../types/index.js";

interface UserDocument extends Document {
  _id: ObjectId;
  name?: string;
  email?: string;
  emailVerified?: boolean;
  image?: string | null;
  role?: string;
  isBlocked?: boolean;
  businessName?: string | null;
  roleOnboarded?: boolean;
  subscriptionPlan?: string;
  subscriptionExpiresAt?: Date | string | null;
  stripeCustomerId?: string | null;
  favorites?: string[] | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface UserPatch {
  name?: string;
  image?: string | null;
  businessName?: string | null;
  role?: UserRole;
  roleOnboarded?: boolean;
  isBlocked?: boolean;
  subscriptionPlan?: SubscriptionPlan;
  subscriptionExpiresAt?: Date | null;
  stripeCustomerId?: string | null;
  favorites?: string[];
}

function users(): Collection<UserDocument> {
  return getDb().collection<UserDocument>("users");
}

function normalizeRole(value: unknown): UserRole {
  return value === "vendor" || value === "admin" ? value : "customer";
}

function normalizePlan(value: unknown): SubscriptionPlan {
  return value === "premium" ? "premium" : "free";
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function toAppUser(doc: UserDocument): AppUser {
  return {
    id: doc._id.toString(),
    name: doc.name ?? "PizzaHub user",
    email: doc.email ?? "",
    emailVerified: doc.emailVerified === true,
    image: doc.image ?? null,
    role: normalizeRole(doc.role),
    isBlocked: doc.isBlocked === true,
    businessName: doc.businessName ?? null,
    roleOnboarded: doc.roleOnboarded === true,
    subscriptionPlan: normalizePlan(doc.subscriptionPlan),
    subscriptionExpiresAt: toDate(doc.subscriptionExpiresAt),
    stripeCustomerId: doc.stripeCustomerId ?? null,
    favorites: toStringArray(doc.favorites),
    createdAt: toDate(doc.createdAt),
    updatedAt: toDate(doc.updatedAt),
  };
}

export function toPublicUser(user: AppUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    role: user.role,
    businessName: user.businessName,
    isBlocked: user.isBlocked,
    roleOnboarded: user.roleOnboarded,
    subscriptionPlan: user.subscriptionPlan,
    subscriptionExpiresAt: user.subscriptionExpiresAt?.toISOString() ?? null,
    createdAt: user.createdAt?.toISOString() ?? null,
  };
}

export async function findUserById(id: string): Promise<AppUser | null> {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  const doc = await users().findOne({ _id: objectId });
  return doc ? toAppUser(doc) : null;
}

export async function findUserByEmail(email: string): Promise<AppUser | null> {
  const doc = await users().findOne({ email: email.trim().toLowerCase() });
  return doc ? toAppUser(doc) : null;
}

export async function findUserByStripeCustomerId(
  stripeCustomerId: string,
): Promise<AppUser | null> {
  if (!stripeCustomerId) return null;
  const doc = await users().findOne({ stripeCustomerId });
  return doc ? toAppUser(doc) : null;
}

export async function findUsersByIds(ids: string[]): Promise<Map<string, AppUser>> {
  const objectIds = ids
    .map((id) => toObjectId(id))
    .filter((value): value is ObjectId => value !== null);

  if (objectIds.length === 0) return new Map();

  const docs = await users()
    .find({ _id: { $in: objectIds } })
    .toArray();

  const map = new Map<string, AppUser>();
  for (const doc of docs) {
    const user = toAppUser(doc);
    map.set(user.id, user);
  }
  return map;
}

export interface ListUsersOptions {
  search?: string;
  role?: UserRole;
  page: number;
  limit: number;
}

export async function listUsers(options: ListUsersOptions): Promise<{
  items: AppUser[];
  total: number;
}> {
  const filter: Filter<UserDocument> = {};

  if (options.role) {
    filter.role = options.role;
  }

  if (options.search) {
    const escaped = options.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "i");
    filter.$or = [{ name: pattern }, { email: pattern }, { businessName: pattern }];
  }

  const skip = (options.page - 1) * options.limit;

  const [docs, total] = await Promise.all([
    users()
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(options.limit)
      .toArray(),
    users().countDocuments(filter),
  ]);

  return { items: docs.map(toAppUser), total };
}

export async function updateUser(
  id: string,
  patch: UserPatch,
): Promise<AppUser | null> {
  const objectId = toObjectId(id);
  if (!objectId) return null;

  const update: Record<string, unknown> = { ...patch };
  if (Object.keys(update).length === 0) return findUserById(id);

  update.updatedAt = new Date();

  const result = await users().findOneAndUpdate(
    { _id: objectId },
    { $set: update },
    { returnDocument: "after" },
  );

  return result ? toAppUser(result) : null;
}

export async function countUsers(filter: Filter<UserDocument> = {}): Promise<number> {
  return users().countDocuments(filter);
}

/**
 * Vendor ids that currently hold an active Premium subscription. Used to give
 * Premium vendors featured placement on the homepage.
 */
export async function findPremiumVendorIds(): Promise<string[]> {
  const docs = await users()
    .find(
      {
        role: "vendor",
        subscriptionPlan: "premium",
        $or: [
          { subscriptionExpiresAt: null },
          { subscriptionExpiresAt: { $exists: false } },
          { subscriptionExpiresAt: { $gt: new Date() } },
        ],
      },
      { projection: { _id: 1 } },
    )
    .toArray();

  return docs.map((doc) => doc._id.toString());
}
