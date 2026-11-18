import { Types, type HydratedDocument } from "mongoose";
import { env } from "../../config/environment.js";
import { ApiError } from "../../lib/api-error.js";
import { MENU_CATEGORIES } from "../../lib/categories.js";
import { toObjectId } from "../../lib/object-id.js";
import {
  findPremiumVendorIds,
  findUserById,
  findUsersByIds,
} from "../../lib/user-repository.js";
import type { AppUser } from "../../types/index.js";
import { OrderModel } from "../orders/order.model.js";
import { MenuItemModel, type MenuItemDocument } from "./menu-item.model.js";
import type {
  AdminMenuQuery,
  CreateMenuItemInput,
  PublicMenuQuery,
  UpdateMenuItemInput,
} from "./menu-item.schema.js";

type MenuItemHydrated = HydratedDocument<MenuItemDocument>;

export interface MenuItemView {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorBusinessName: string | null;
  isPremiumVendor: boolean;
  itemName: string;
  category: string;
  description: string;
  price: number;
  location: string;
  images: string[];
  status: string;
  isAvailable: boolean;
  rejectionReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function isPremiumActive(user: AppUser): boolean {
  if (user.subscriptionPlan !== "premium") return false;
  if (!user.subscriptionExpiresAt) return true;
  return user.subscriptionExpiresAt.getTime() > Date.now();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function serialize(
  docs: MenuItemHydrated[],
): Promise<MenuItemView[]> {
  const vendorIds = Array.from(
    new Set(docs.map((doc) => doc.vendorId.toString())),
  );
  const vendors = await findUsersByIds(vendorIds);

  return docs.map((doc) => {
    const vendorId = doc.vendorId.toString();
    const vendor = vendors.get(vendorId);
    return {
      id: doc._id.toString(),
      vendorId,
      vendorName: vendor?.businessName ?? vendor?.name ?? "PizzaHub vendor",
      vendorBusinessName: vendor?.businessName ?? null,
      isPremiumVendor: vendor ? isPremiumActive(vendor) : false,
      itemName: doc.itemName,
      category: doc.category,
      description: doc.description,
      price: doc.price,
      location: doc.location,
      images: doc.images ?? [],
      status: doc.status,
      isAvailable: doc.isAvailable,
      rejectionReason: doc.rejectionReason ?? null,
      createdAt: doc.createdAt?.toISOString() ?? null,
      updatedAt: doc.updatedAt?.toISOString() ?? null,
    };
  });
}

export async function serializeMenuItems(
  docs: MenuItemHydrated[],
): Promise<MenuItemView[]> {
  return serialize(docs);
}

async function serializeOne(doc: MenuItemHydrated): Promise<MenuItemView> {
  const [view] = await serialize([doc]);
  return view;
}

function buildPublicFilter(query: PublicMenuQuery) {
  const filter: Record<string, unknown> = {
    status: "approved",
    isAvailable: true,
  };

  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ itemName: pattern }, { description: pattern }];
  }

  if (query.category) {
    filter.category = query.category;
  }

  if (query.location) {
    filter.location = new RegExp(`^${escapeRegex(query.location)}$`, "i");
  }

  return filter;
}

function sortStage(sort: PublicMenuQuery["sort"]): Record<string, 1 | -1> {
  if (sort === "price_asc") return { price: 1, createdAt: -1 };
  if (sort === "price_desc") return { price: -1, createdAt: -1 };
  return { createdAt: -1 };
}

export async function listPublicMenuItems(query: PublicMenuQuery) {
  const filter = buildPublicFilter(query);
  const skip = (query.page - 1) * query.limit;

  const [docs, total] = await Promise.all([
    MenuItemModel.find(filter)
      .sort(sortStage(query.sort))
      .skip(skip)
      .limit(query.limit),
    MenuItemModel.countDocuments(filter),
  ]);

  return {
    items: await serialize(docs),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function listFeaturedMenuItems(limit = 8): Promise<MenuItemView[]> {
  const premiumVendorIds = await findPremiumVendorIds();
  const premiumObjectIds = premiumVendorIds
    .map((id) => toObjectId(id))
    .filter((value): value is Types.ObjectId => value !== null);

  const base = { status: "approved", isAvailable: true } as const;

  const featured: MenuItemHydrated[] = [];

  if (premiumObjectIds.length > 0) {
    const premiumItems = await MenuItemModel.find({
      ...base,
      vendorId: { $in: premiumObjectIds },
    })
      .sort({ createdAt: -1 })
      .limit(limit);
    featured.push(...premiumItems);
  }

  if (featured.length < limit) {
    const remaining = limit - featured.length;
    const others = await MenuItemModel.find({
      ...base,
      ...(premiumObjectIds.length > 0
        ? { vendorId: { $nin: premiumObjectIds } }
        : {}),
    })
      .sort({ createdAt: -1 })
      .limit(remaining);
    featured.push(...others);
  }

  return serialize(featured);
}

export async function getCategoryCounts(): Promise<
  { category: string; count: number }[]
> {
  const rows = await MenuItemModel.aggregate<{ _id: string; count: number }>([
    { $match: { status: "approved", isAvailable: true } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
  ]);

  const map = new Map(rows.map((row) => [row._id, row.count]));

  return MENU_CATEGORIES.map((category) => ({
    category,
    count: map.get(category) ?? 0,
  }));
}

export async function listLocations(): Promise<string[]> {
  const values = await MenuItemModel.distinct("location", {
    status: "approved",
    isAvailable: true,
  });
  return values.filter((value): value is string => typeof value === "string").sort();
}

export async function listVendorMenuItems(
  vendorId: string,
): Promise<MenuItemView[]> {
  const objectId = toObjectId(vendorId);
  if (!objectId) return [];
  const docs = await MenuItemModel.find({ vendorId: objectId }).sort({
    createdAt: -1,
  });
  return serialize(docs);
}

export async function listAdminMenuItems(query: AdminMenuQuery) {
  const filter: Record<string, unknown> = {};

  if (query.status) filter.status = query.status;

  if (query.category) filter.category = query.category;

  if (query.vendorId) {
    const vendorObjectId = toObjectId(query.vendorId);
    if (!vendorObjectId) {
      throw ApiError.badRequest("Vendor id is not valid.");
    }
    filter.vendorId = vendorObjectId;
  }

  if (query.location) {
    filter.location = new RegExp(`^${escapeRegex(query.location)}$`, "i");
  }

  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ itemName: pattern }, { description: pattern }];
  }

  const skip = (query.page - 1) * query.limit;

  const [docs, total] = await Promise.all([
    MenuItemModel.find(filter)
      .sort(sortStage(query.sort))
      .skip(skip)
      .limit(query.limit),
    MenuItemModel.countDocuments(filter),
  ]);

  return {
    items: await serialize(docs),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getMenuItemForViewer(
  id: string,
  viewer: AppUser | undefined,
): Promise<MenuItemView> {
  const objectId = toObjectId(id);
  if (!objectId) {
    throw ApiError.badRequest("Menu item id is not valid.");
  }

  const doc = await MenuItemModel.findById(objectId);
  if (!doc) {
    throw ApiError.notFound("Menu item not found.");
  }

  const isOwner =
    viewer !== undefined && doc.vendorId.toString() === viewer.id;
  const isAdmin = viewer?.role === "admin";

  if (!isAdmin && !isOwner && !(doc.status === "approved" && doc.isAvailable)) {
    throw ApiError.notFound("Menu item not found.");
  }

  return serializeOne(doc);
}

async function countActiveItems(
  vendorId: string,
  excludeItemId?: Types.ObjectId,
): Promise<number> {
  const objectId = toObjectId(vendorId);
  if (!objectId) return 0;

  const filter: Record<string, unknown> = {
    vendorId: objectId,
    status: "approved",
    isAvailable: true,
  };

  if (excludeItemId) {
    filter._id = { $ne: excludeItemId };
  }

  return MenuItemModel.countDocuments(filter);
}

/**
 * Assignment rule: a free vendor may hold at most three admin-approved, active
 * items. Pending and rejected items do not count toward the limit.
 */
export async function assertActiveItemCapacity(
  vendor: AppUser,
  excludeItemId?: Types.ObjectId,
): Promise<void> {
  if (isPremiumActive(vendor)) return;

  const active = await countActiveItems(vendor.id, excludeItemId);
  if (active >= env.freePlanActiveItemLimit) {
    throw ApiError.conflict(
      `Free vendor accounts can have at most ${env.freePlanActiveItemLimit} active menu items. ` +
        "Upgrade to Premium for unlimited items, or make an existing item unavailable.",
    );
  }
}

export async function createMenuItem(
  vendor: AppUser,
  input: CreateMenuItemInput,
): Promise<MenuItemView> {
  const created = await MenuItemModel.create({
    vendorId: new Types.ObjectId(vendor.id),
    itemName: input.itemName,
    category: input.category,
    description: input.description,
    price: input.price,
    location: input.location,
    images: input.images,
    status: "pending",
    isAvailable: input.isAvailable ?? true,
    rejectionReason: null,
  });

  return serializeOne(created);
}

export async function updateMenuItem(
  id: string,
  actor: AppUser,
  input: UpdateMenuItemInput,
): Promise<MenuItemView> {
  const objectId = toObjectId(id);
  if (!objectId) {
    throw ApiError.badRequest("Menu item id is not valid.");
  }

  const doc = await MenuItemModel.findById(objectId);
  if (!doc) {
    throw ApiError.notFound("Menu item not found.");
  }

  const isOwner = doc.vendorId.toString() === actor.id;
  const isAdmin = actor.role === "admin";

  if (!isOwner && !isAdmin) {
    throw ApiError.forbidden("You can only manage your own menu items.");
  }

  const contentChanged = (
    ["itemName", "category", "description", "price", "location", "images"] as const
  ).some((key) => input[key] !== undefined);

  if (
    input.isAvailable === true &&
    doc.isAvailable === false &&
    isOwner
  ) {
    const vendor = await findUserById(actor.id);
    if (vendor) {
      await assertActiveItemCapacity(vendor, objectId);
    }
  }

  if (contentChanged) {
    doc.itemName = input.itemName ?? doc.itemName;
    doc.category = (input.category as typeof doc.category) ?? doc.category;
    doc.description = input.description ?? doc.description;
    doc.price = input.price ?? doc.price;
    doc.location = input.location ?? doc.location;
    doc.images = input.images ?? doc.images;
  }

  if (input.isAvailable !== undefined) {
    doc.isAvailable = input.isAvailable;
  }

  // A vendor editing approved content must be reviewed again so approval can
  // never be used to smuggle in different content after the fact.
  if (contentChanged && isOwner && doc.status === "approved") {
    doc.status = "pending";
    doc.rejectionReason = null;
  }

  await doc.save();
  return serializeOne(doc);
}

export async function setMenuItemStatus(
  id: string,
  status: "pending" | "approved" | "rejected",
  reason?: string,
): Promise<MenuItemView> {
  const objectId = toObjectId(id);
  if (!objectId) {
    throw ApiError.badRequest("Menu item id is not valid.");
  }

  const doc = await MenuItemModel.findById(objectId);
  if (!doc) {
    throw ApiError.notFound("Menu item not found.");
  }

  if (status === "approved") {
    const vendor = await findUserById(doc.vendorId.toString());
    if (!vendor) {
      throw ApiError.unprocessable(
        "The vendor account for this item no longer exists.",
      );
    }
    if (doc.isAvailable) {
      await assertActiveItemCapacity(vendor, objectId);
    }
  }

  doc.status = status;
  doc.rejectionReason = status === "rejected" ? (reason ?? null) : null;
  await doc.save();

  return serializeOne(doc);
}

export async function deleteMenuItem(
  id: string,
  actor: AppUser,
): Promise<void> {
  const objectId = toObjectId(id);
  if (!objectId) {
    throw ApiError.badRequest("Menu item id is not valid.");
  }

  const doc = await MenuItemModel.findById(objectId);
  if (!doc) {
    throw ApiError.notFound("Menu item not found.");
  }

  const isOwner = doc.vendorId.toString() === actor.id;
  if (!isOwner && actor.role !== "admin") {
    throw ApiError.forbidden("You can only delete your own menu items.");
  }

  const orderCount = await OrderModel.countDocuments({ itemId: objectId });
  if (orderCount > 0) {
    throw ApiError.conflict(
      "This item has order history and cannot be deleted. Mark it unavailable instead.",
    );
  }

  await doc.deleteOne();
}
