import { Types } from "mongoose";
import { env } from "../../config/environment.js";
import {
  activeMenuItemFilter,
  inactiveMenuItemFilter,
} from "../../lib/menu-status.js";
import { countUsers } from "../../lib/user-repository.js";
import type { AppUser, OrderStatus } from "../../types/index.js";
import { MenuItemModel } from "../menu-items/menu-item.model.js";
import { isPremiumActive } from "../menu-items/menu-item.service.js";
import { OrderModel } from "../orders/order.model.js";
import { listOrders } from "../orders/order.service.js";
import { TransactionModel } from "../transactions/transaction.model.js";

const ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
];

function lastSevenDays(): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - offset,
      ),
    );
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

async function orderStatusBreakdown(
  match: Record<string, unknown>,
): Promise<Record<OrderStatus, number>> {
  const rows = await OrderModel.aggregate<{ _id: OrderStatus; count: number }>([
    { $match: match },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const result: Record<OrderStatus, number> = {
    pending: 0,
    accepted: 0,
    rejected: 0,
    cancelled: 0,
  };

  for (const row of rows) {
    if (ORDER_STATUSES.includes(row._id)) {
      result[row._id] = row.count;
    }
  }

  return result;
}

async function weeklyOrderSeries(
  match: Record<string, unknown>,
): Promise<{ date: string; count: number }[]> {
  const days = lastSevenDays();
  const start = new Date(`${days[0]}T00:00:00.000Z`);

  const rows = await OrderModel.aggregate<{ _id: string; count: number }>([
    { $match: { ...match, createdAt: { $gte: start } } },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const map = new Map(rows.map((row) => [row._id, row.count]));
  return days.map((date) => ({ date, count: map.get(date) ?? 0 }));
}

export async function getVendorOverview(user: AppUser) {
  const vendorId = new Types.ObjectId(user.id);

  const [
    totalItems,
    approvedItems,
    pendingItems,
    rejectedItems,
    activeItems,
    inactiveItems,
  ] = await Promise.all([
    MenuItemModel.countDocuments({ vendorId }),
    MenuItemModel.countDocuments({
      vendorId,
      ...activeMenuItemFilter(),
    }),
    MenuItemModel.countDocuments({ vendorId, status: "pending" }),
    MenuItemModel.countDocuments({ vendorId, status: "rejected" }),
    MenuItemModel.countDocuments({
      vendorId,
      status: "approved",
      isAvailable: true,
    }),
    MenuItemModel.countDocuments({
      vendorId,
      ...inactiveMenuItemFilter(),
    }),
  ]);

  const orderMatch = { vendorId };
  const orders = await orderStatusBreakdown(orderMatch);
  const series = await weeklyOrderSeries(orderMatch);
  const recentOrders = await listOrders(user, { page: 1, limit: 5 });

  return {
    role: "vendor" as const,
    stats: {
      totalItems,
      approvedItems,
      pendingItems,
      rejectedItems,
      activeItems,
      inactiveItems,
      activeItemLimit: env.freePlanActiveItemLimit,
      totalOrders: Object.values(orders).reduce((sum, value) => sum + value, 0),
      orders,
      subscriptionPlan: user.subscriptionPlan,
      premiumActive: isPremiumActive(user),
      subscriptionExpiresAt:
        user.subscriptionExpiresAt?.toISOString() ?? null,
    },
    series,
    recentOrders: recentOrders.items,
  };
}

export async function getCustomerOverview(user: AppUser) {
  const customerId = new Types.ObjectId(user.id);
  const orderMatch = { customerId };

  const orders = await orderStatusBreakdown(orderMatch);
  const series = await weeklyOrderSeries(orderMatch);
  const recentOrders = await listOrders(user, { page: 1, limit: 5 });

  return {
    role: "customer" as const,
    stats: {
      totalOrders: Object.values(orders).reduce((sum, value) => sum + value, 0),
      orders,
      favoritesCount: user.favorites.length,
    },
    series,
    recentOrders: recentOrders.items,
  };
}

export async function getAdminOverview() {
  const [
    totalUsers,
    vendors,
    customers,
    admins,
    blockedUsers,
    totalItems,
    pendingItems,
    approvedItems,
    rejectedItems,
    inactiveItems,
    orders,
    transactionSummary,
  ] = await Promise.all([
    countUsers({}),
    countUsers({ role: "vendor" }),
    countUsers({ role: "customer" }),
    countUsers({ role: "admin" }),
    countUsers({ isBlocked: true }),
    MenuItemModel.countDocuments({}),
    MenuItemModel.countDocuments({ status: "pending" }),
    MenuItemModel.countDocuments(activeMenuItemFilter()),
    MenuItemModel.countDocuments({ status: "rejected" }),
    MenuItemModel.countDocuments(inactiveMenuItemFilter()),
    orderStatusBreakdown({}),
    TransactionModel.aggregate<{ _id: null; total: number; count: number }>([
      { $match: { status: "paid" } },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const series = await weeklyOrderSeries({});
  const revenue = transactionSummary[0]?.total ?? 0;
  const paidTransactions = transactionSummary[0]?.count ?? 0;

  return {
    role: "admin" as const,
    stats: {
      totalUsers,
      vendors,
      customers,
      admins,
      blockedUsers,
      totalItems,
      pendingItems,
      approvedItems,
      rejectedItems,
      inactiveItems,
      totalOrders: Object.values(orders).reduce((sum, value) => sum + value, 0),
      orders,
      paidTransactions,
      revenue,
    },
    series,
    recentOrders: [],
  };
}

export async function getOverview(user: AppUser) {
  if (user.role === "admin") return getAdminOverview();
  if (user.role === "vendor") return getVendorOverview(user);
  return getCustomerOverview(user);
}
