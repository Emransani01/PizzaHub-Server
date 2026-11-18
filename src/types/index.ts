export type UserRole = "customer" | "vendor" | "admin";

export type SubscriptionPlan = "free" | "premium";

export type MenuItemStatus = "pending" | "approved" | "rejected";

export type OrderStatus = "pending" | "accepted" | "rejected" | "cancelled";

export type TransactionStatus =
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: UserRole;
  isBlocked: boolean;
  businessName: string | null;
  roleOnboarded: boolean;
  subscriptionPlan: SubscriptionPlan;
  subscriptionExpiresAt: Date | null;
  stripeCustomerId: string | null;
  favorites: string[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: UserRole;
  businessName: string | null;
  isBlocked: boolean;
  roleOnboarded: boolean;
  subscriptionPlan: SubscriptionPlan;
  subscriptionExpiresAt: string | null;
  createdAt: string | null;
}

export interface OrderStatusEntry {
  status: OrderStatus;
  changedBy: string;
  changedByRole: UserRole;
  changedAt: Date;
  note?: string | null;
}

export interface ApiErrorBody {
  message: string;
  code?: string;
  details?: unknown;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type { MenuCategory } from "../lib/categories.js";
