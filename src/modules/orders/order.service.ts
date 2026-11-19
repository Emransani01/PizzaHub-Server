import { Types, type HydratedDocument } from "mongoose";
import { ApiError } from "../../lib/api-error.js";
import { isMenuItemPublic } from "../../lib/menu-status.js";
import { toObjectId } from "../../lib/object-id.js";
import { findUsersByIds } from "../../lib/user-repository.js";
import type { AppUser, OrderStatus, UserRole } from "../../types/index.js";
import { MenuItemModel } from "../menu-items/menu-item.model.js";
import {
  OrderModel,
  type OrderDocument,
  type OrderStatusEntry,
} from "./order.model.js";
import type {
  CreateOrderInput,
  OrderQuery,
} from "./order.schema.js";

type OrderHydrated = HydratedDocument<OrderDocument>;

export interface OrderView {
  id: string;
  itemId: string;
  itemName: string;
  itemImage: string | null;
  itemPrice: number;
  vendorId: string;
  vendorName: string;
  customerId: string;
  customerName: string;
  deliveryDate: string;
  deliveryAddress: string;
  message: string | null;
  status: OrderStatus;
  statusHistory: {
    status: OrderStatus;
    changedBy: string;
    changedByRole: UserRole;
    changedAt: string;
    note: string | null;
  }[];
  createdAt: string | null;
  updatedAt: string | null;
}

function normalizeDeliveryDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw ApiError.unprocessable("Delivery date is not a valid date.");
  }
  const [year, month, day] = value.split("-").map(Number);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw ApiError.unprocessable("Delivery date is not a valid calendar date.");
  }
  return date;
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function activeOrderKey(
  customerId: string,
  itemId: string,
  deliveryDate: Date,
): string {
  return `${customerId}:${itemId}:${deliveryDate.toISOString().slice(0, 10)}`;
}

function isDuplicateActiveOrderError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: number; keyPattern?: Record<string, unknown> };
  return e.code === 11000 && Boolean(e.keyPattern?.activeOrderKey);
}

async function serialize(docs: OrderHydrated[]): Promise<OrderView[]> {
  const userIds = new Set<string>();
  for (const doc of docs) {
    userIds.add(doc.vendorId.toString());
    userIds.add(doc.customerId.toString());
  }

  const users = await findUsersByIds(Array.from(userIds));

  return docs.map((doc) => {
    const vendor = users.get(doc.vendorId.toString());
    const customer = users.get(doc.customerId.toString());

    return {
      id: doc._id.toString(),
      itemId: doc.itemId.toString(),
      itemName: doc.itemName,
      itemImage: doc.itemImage ?? null,
      itemPrice: doc.itemPrice,
      vendorId: doc.vendorId.toString(),
      vendorName: vendor?.businessName ?? vendor?.name ?? "PizzaHub vendor",
      customerId: doc.customerId.toString(),
      customerName: customer?.name ?? "Customer",
      deliveryDate: doc.deliveryDate.toISOString().slice(0, 10),
      deliveryAddress: doc.deliveryAddress,
      message: doc.message ?? null,
      status: doc.status,
      statusHistory: (doc.statusHistory ?? []).map((entry) => ({
        status: entry.status,
        changedBy: entry.changedBy.toString(),
        changedByRole: entry.changedByRole,
        changedAt: entry.changedAt.toISOString(),
        note: entry.note ?? null,
      })),
      createdAt: doc.createdAt?.toISOString() ?? null,
      updatedAt: doc.updatedAt?.toISOString() ?? null,
    };
  });
}

export async function createOrder(
  customer: AppUser,
  input: CreateOrderInput,
): Promise<OrderView> {
  if (customer.role !== "customer") {
    throw ApiError.forbidden("Only customer accounts can place orders.");
  }

  const itemObjectId = toObjectId(input.itemId);
  if (!itemObjectId) {
    throw ApiError.badRequest("Menu item id is not valid.");
  }

  const item = await MenuItemModel.findById(itemObjectId);

  if (!item) {
    throw ApiError.notFound("Menu item not found.");
  }

  if (item.vendorId.toString() === customer.id) {
    throw ApiError.forbidden("You cannot order your own menu items.");
  }

  if (!isMenuItemPublic(item.status, item.isAvailable)) {
    throw ApiError.conflict(
      "This item is not currently available for ordering.",
    );
  }

  const deliveryDate = normalizeDeliveryDate(input.deliveryDate);
  if (deliveryDate.getTime() < startOfTodayUtc().getTime()) {
    throw ApiError.unprocessable("Delivery date cannot be in the past.");
  }

  const existing = await OrderModel.findOne({
    customerId: new Types.ObjectId(customer.id),
    itemId: itemObjectId,
    deliveryDate,
    status: { $in: ["pending", "accepted"] },
  });

  if (existing) {
    throw ApiError.conflict(
      "You already have an active order for this item on that delivery date.",
    );
  }

  let created: OrderHydrated;
  try {
    created = await OrderModel.create({
      itemId: itemObjectId,
      vendorId: item.vendorId,
      customerId: new Types.ObjectId(customer.id),
      itemName: item.itemName,
      itemImage: item.images?.[0] ?? null,
      itemPrice: item.price,
      deliveryDate,
      deliveryAddress: input.deliveryAddress,
      message: input.message ?? null,
      status: "pending" satisfies OrderStatus,
      activeOrderKey: activeOrderKey(customer.id, item._id.toString(), deliveryDate),
      statusHistory: [
        {
          status: "pending" satisfies OrderStatus,
          changedBy: new Types.ObjectId(customer.id),
          changedByRole: "customer" satisfies UserRole,
          changedAt: new Date(),
          note: "Order placed",
        },
      ],
    });
  } catch (error) {
    if (isDuplicateActiveOrderError(error)) {
      throw ApiError.conflict(
        "You already have an active order for this item on that delivery date.",
      );
    }
    throw error;
  }

  const [view] = await serialize([created]);
  return view;
}

export async function listOrders(user: AppUser, query: OrderQuery) {
  const filter: Record<string, unknown> = {};

  if (user.role === "vendor") {
    filter.vendorId = new Types.ObjectId(user.id);
  } else if (user.role === "customer") {
    filter.customerId = new Types.ObjectId(user.id);
  }

  if (query.status) {
    filter.status = query.status;
  }

  const skip = (query.page - 1) * query.limit;

  const [docs, total] = await Promise.all([
    OrderModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(query.limit),
    OrderModel.countDocuments(filter),
  ]);

  return {
    items: await serialize(docs),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getOrderById(
  id: string,
  user: AppUser,
): Promise<OrderView> {
  const objectId = toObjectId(id);
  if (!objectId) {
    throw ApiError.badRequest("Order id is not valid.");
  }

  const doc = await OrderModel.findById(objectId);
  if (!doc) {
    throw ApiError.notFound("Order not found.");
  }

  const isCustomer = doc.customerId.toString() === user.id;
  const isVendor = doc.vendorId.toString() === user.id;
  const isAdmin = user.role === "admin";

  if (!isCustomer && !isVendor && !isAdmin) {
    throw ApiError.forbidden("You do not have access to this order.");
  }

  const [view] = await serialize([doc]);
  return view;
}

export async function updateOrderStatus(
  id: string,
  actor: AppUser,
  status: "accepted" | "rejected" | "cancelled",
  note?: string,
): Promise<OrderView> {
  const objectId = toObjectId(id);
  if (!objectId) {
    throw ApiError.badRequest("Order id is not valid.");
  }

  const doc = await OrderModel.findById(objectId);
  if (!doc) {
    throw ApiError.notFound("Order not found.");
  }

  if (actor.role === "admin") {
    throw ApiError.forbidden("Administrators cannot change order statuses.");
  }

  if (actor.role === "customer") {
    if (doc.customerId.toString() !== actor.id) {
      throw ApiError.forbidden("You can only cancel your own orders.");
    }
  }

  if (actor.role === "vendor" && doc.vendorId.toString() !== actor.id) {
    throw ApiError.forbidden("You can only manage orders for your own menu items.");
  }

  // Authorisation is settled before the state machine, so a stranger always
  // learns nothing about the current status of an order they do not own.
  if (doc.status !== "pending") {
    throw ApiError.conflict(
      `Only pending orders can change status. This order is already ${doc.status}.`,
    );
  }

  if (actor.role === "customer" && status !== "cancelled") {
    throw ApiError.forbidden("Customers can only cancel a pending order.");
  }

  if (actor.role === "vendor" && status === "cancelled") {
    throw ApiError.forbidden("Vendors can accept or reject an order, not cancel it.");
  }

  const entry: OrderStatusEntry = {
    status,
    changedBy: new Types.ObjectId(actor.id),
    changedByRole: actor.role,
    changedAt: new Date(),
    note: note ?? null,
  };

  doc.status = status;
  if (status === "rejected" || status === "cancelled") {
    doc.activeOrderKey = null;
  }
  doc.statusHistory = [...(doc.statusHistory ?? []), entry];
  await doc.save();

  const [view] = await serialize([doc]);
  return view;
}
