import {
  Types,
  type HydratedDocument,
  type UpdateQuery,
} from "mongoose";
import { env } from "../../config/environment.js";
import { ApiError } from "../../lib/api-error.js";
import { MENU_CATEGORIES } from "../../lib/categories.js";
import {
  activeMenuItemFilter,
  displayMenuItemStatus,
  inactiveMenuItemFilter,
  isMenuItemPublic,
  isPausedMenuItem,
} from "../../lib/menu-status.js";
import { toObjectId } from "../../lib/object-id.js";
import {
  findPremiumVendorIds,
  findUserById,
  findUsersByIds,
} from "../../lib/user-repository.js";
import type { AppUser, MenuItemStatus } from "../../types/index.js";
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
  status: MenuItemStatus;
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
      status: displayMenuItemStatus(doc.status, doc.isAvailable),
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
  const filter: Record<string, unknown> = { ...activeMenuItemFilter() };

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

  const base = activeMenuItemFilter();

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
    { $match: activeMenuItemFilter() },
    { $group: { _id: "$category", count: { $sum: 1 } } },
  ]);

  const map = new Map(rows.map((row) => [row._id, row.count]));

  return MENU_CATEGORIES.map((category) => ({
    category,
    count: map.get(category) ?? 0,
  }));
}

export async function listLocations(): Promise<string[]> {
  const values = await MenuItemModel.distinct("location", activeMenuItemFilter());
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

function adminStatusCondition(status?: MenuItemStatus): Record<string, unknown> {
  if (status === "inactive") return inactiveMenuItemFilter();

  // Serialised "approved" items are active; legacy paused items are reported
  // through the "inactive" filter above.
  if (status === "approved") {
    return activeMenuItemFilter();
  }

  return { status };
}

export async function listAdminMenuItems(query: AdminMenuQuery) {
  const filter: Record<string, unknown> = {};
  const conditions: Record<string, unknown>[] = [];

  if (query.status) conditions.push(adminStatusCondition(query.status));

  if (query.category) filter.category = query.category;

  if (query.vendorId) {
    const vendorObjectId = toObjectId(query.vendorId);
    if (!vendorObjectId) {
      throw ApiError.badRequest("Vendor id is not valid.");
    }
    filter.vendorId = vendorObjectId;
  }

  if (query.location) {
    conditions.push({
      location: new RegExp(`^${escapeRegex(query.location)}$`, "i"),
    });
  }

  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), "i");
    conditions.push({ $or: [{ itemName: pattern }, { description: pattern }] });
  }

  if (conditions.length > 0) filter.$and = conditions;

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

  if (
    !isAdmin &&
    !isOwner &&
    !isMenuItemPublic(doc.status, doc.isAvailable)
  ) {
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

function freePlanLimitMessage(): string {
  return (
    `Free vendor accounts can have at most ${env.freePlanActiveItemLimit} active menu items. ` +
    "Upgrade to Premium for unlimited items, or make an existing item unavailable."
  );
}

function concurrentUpdateMessage(): string {
  return "This menu item was changed by another request. Refresh and try again.";
}

/**
 * Assignment rule: a free vendor may hold at most three admin-approved, active
 * items. Pending and rejected items do not count toward the limit.
 */
async function assertFreeCapacity(
  vendor: AppUser,
  premium: boolean,
  excludeItemId?: Types.ObjectId,
): Promise<void> {
  if (premium) return;

  const active = await countActiveItems(vendor.id, excludeItemId);
  if (active >= env.freePlanActiveItemLimit) {
    throw ApiError.conflict(freePlanLimitMessage());
  }
}

/** Kept as the public form of the capacity check for existing callers. */
export async function assertActiveItemCapacity(
  vendor: AppUser,
  excludeItemId?: Types.ObjectId,
): Promise<void> {
  await assertFreeCapacity(vendor, isPremiumActive(vendor), excludeItemId);
}

/**
 * A duplicate-key error is the only database error we recover from, and only
 * when it comes from the active-slot index. Everything else propagates so a
 * failed activation can never be mistaken for a successful one.
 */
function isActiveSlotCollision(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
    message?: string;
  };
  return (
    e.code === 11000 &&
    ((e.keyPattern !== undefined && "activeSlot" in e.keyPattern) ||
      /uniq_vendor_active_slot/.test(e.message ?? ""))
  );
}

function writeMenuItem(
  filter: Record<string, unknown>,
  update: UpdateQuery<MenuItemDocument>,
): Promise<MenuItemHydrated | null> {
  return MenuItemModel.findOneAndUpdate(filter, update, {
    returnDocument: "after",
    runValidators: true,
  });
}

function requireUpdated(doc: MenuItemHydrated | null): MenuItemHydrated {
  if (!doc) throw ApiError.conflict(concurrentUpdateMessage());
  return doc;
}

/**
 * Backfill only touches documents that are ALREADY approved and available.
 * It never changes status or availability; it only gives a legacy active item
 * a slot. This is the repair half of the lazy reconciliation.
 */
async function backfillSlots(vendorId: Types.ObjectId): Promise<void> {
  const unslotted = await MenuItemModel.find({
    vendorId,
    status: "approved",
    isAvailable: true,
    activeSlot: null,
  })
    .select("_id")
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  for (const candidate of unslotted) {
    for (let slot = 0; slot < env.freePlanActiveItemLimit; slot += 1) {
      try {
        const claimed = await MenuItemModel.findOneAndUpdate(
          {
            _id: candidate._id,
            vendorId,
            status: "approved",
            isAvailable: true,
            activeSlot: null,
          },
          { $set: { activeSlot: slot } },
        );
        if (claimed) break;
      } catch (error) {
        if (!isActiveSlotCollision(error)) throw error;
      }
    }
  }
}

/** Clears slots held by documents that are no longer active. */
async function clearStaleSlots(vendorId: Types.ObjectId): Promise<void> {
  await MenuItemModel.updateMany(
    {
      vendorId,
      activeSlot: { $ne: null },
      $or: [{ status: { $ne: "approved" } }, { isAvailable: false }],
    },
    { $set: { activeSlot: null } },
  );
}

async function syncActiveSlots(vendorId: Types.ObjectId): Promise<void> {
  await clearStaleSlots(vendorId);
  await backfillSlots(vendorId);
}

interface DesiredMenuItemState {
  status: MenuItemStatus;
  isAvailable: boolean;
  rejectionReason: string | null;
  content: Record<string, unknown>;
}

/**
 * Every state change is one conditional single-document write.
 *
 * - Deactivation writes activeSlot: null in the same write that removes the
 *   item from the active set.
 * - An item that was already active keeps its slot (idempotent approval).
 * - Claiming a slot from pending/inactive sets the desired approved+available
 *   state AND the slot in the same atomic write, so no observer can see a
 *   partially activated item.
 */
async function persistMenuItemState(
  doc: MenuItemHydrated,
  vendor: AppUser | null,
  desired: DesiredMenuItemState,
): Promise<MenuItemHydrated> {
  // Entitlement is evaluated exactly once per request, from the freshly
  // loaded vendor, before any slot work. Expiry during the write does not
  // retroactively deactivate an item or change the outcome of this request.
  const premium = vendor !== null && isPremiumActive(vendor);
  const wasActive = doc.status === "approved" && doc.isAvailable;
  const willBeActive = desired.status === "approved" && desired.isAvailable;
  const filter = {
    _id: doc._id,
    status: doc.status,
    isAvailable: doc.isAvailable,
  };
  const set = {
    ...desired.content,
    status: desired.status,
    isAvailable: desired.isAvailable,
    rejectionReason: desired.rejectionReason,
  };

  if (!willBeActive) {
    return requireUpdated(
      await writeMenuItem(filter, { $set: { ...set, activeSlot: null } }),
    );
  }

  if (wasActive || !vendor || premium) {
    return requireUpdated(await writeMenuItem(filter, { $set: set }));
  }

  // Fast path for the usual "already at capacity" case; the slot claim below
  // is the authoritative concurrency guard.
  await assertFreeCapacity(vendor, premium, doc._id);
  await syncActiveSlots(doc.vendorId);

  for (let slot = 0; slot < env.freePlanActiveItemLimit; slot += 1) {
    try {
      const updated = await writeMenuItem(
        { ...filter, activeSlot: null },
        { $set: { ...set, activeSlot: slot } },
      );
      if (updated) return updated;
      throw ApiError.conflict(concurrentUpdateMessage());
    } catch (error) {
      if (isActiveSlotCollision(error)) continue;
      throw error;
    }
  }

  throw ApiError.conflict(freePlanLimitMessage());
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

function buildContentPatch(input: UpdateMenuItemInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.itemName !== undefined) patch.itemName = input.itemName;
  if (input.category !== undefined) patch.category = input.category;
  if (input.description !== undefined) patch.description = input.description;
  if (input.price !== undefined) patch.price = input.price;
  if (input.location !== undefined) patch.location = input.location;
  if (input.images !== undefined) patch.images = input.images;
  return patch;
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

  // Compute the complete final state first. Capacity is only consulted when
  // that final state is active, so a content edit that returns an item to
  // pending does not consume (or check) active capacity.
  let desiredStatus: MenuItemStatus = doc.status;
  if (
    input.isAvailable !== undefined &&
    (doc.status === "approved" || doc.status === "inactive")
  ) {
    desiredStatus = input.isAvailable ? "approved" : "inactive";
  }

  let rejectionReason: string | null = doc.rejectionReason ?? null;
  if (
    contentChanged &&
    isOwner &&
    (desiredStatus === "approved" || desiredStatus === "inactive")
  ) {
    // A vendor editing approved or paused content must be reviewed again so
    // approval can never be used to smuggle in different content afterwards.
    desiredStatus = "pending";
    rejectionReason = null;
  }

  const desiredAvailable =
    input.isAvailable !== undefined ? input.isAvailable : doc.isAvailable;

  const needsCapacityDecision =
    desiredStatus === "approved" &&
    desiredAvailable &&
    !(doc.status === "approved" && doc.isAvailable);
  const vendor = needsCapacityDecision
    ? await findUserById(doc.vendorId.toString())
    : null;

  const updated = await persistMenuItemState(doc, vendor, {
    status: desiredStatus,
    isAvailable: desiredAvailable,
    rejectionReason,
    content: buildContentPatch(input),
  });
  return serializeOne(updated);
}

export async function setMenuItemStatus(
  id: string,
  status: MenuItemStatus,
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

  // Admin approval publishes paused and rejected items again. A pending item
  // that the vendor deliberately created unavailable keeps that choice, so it
  // still does not consume the free-plan active-item allowance.
  const shouldReactivate =
    isPausedMenuItem(doc.status, doc.isAvailable) || doc.status === "rejected";

  let desiredAvailable = doc.isAvailable;
  let vendor: AppUser | null = null;

  if (status === "approved") {
    vendor = await findUserById(doc.vendorId.toString());
    if (!vendor) {
      throw ApiError.unprocessable(
        "The vendor account for this item no longer exists.",
      );
    }
    if (shouldReactivate) desiredAvailable = true;
  }

  if (status === "inactive") desiredAvailable = false;

  const updated = await persistMenuItemState(doc, vendor, {
    status,
    isAvailable: desiredAvailable,
    rejectionReason: status === "rejected" ? (reason ?? null) : null,
    content: {},
  });

  return serializeOne(updated);
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
