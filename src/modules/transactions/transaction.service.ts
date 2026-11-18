import { z } from "zod";
import { Types } from "mongoose";
import { findUsersByIds } from "../../lib/user-repository.js";
import type { AppUser, TransactionStatus } from "../../types/index.js";
import { TransactionModel } from "./transaction.model.js";

export const transactionQuerySchema = z.object({
  status: z
    .enum(["pending", "paid", "failed", "cancelled", "expired"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type TransactionQuery = z.infer<typeof transactionQuerySchema>;

export interface TransactionView {
  id: string;
  vendorId: string;
  vendorName: string;
  plan: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  stripeSessionId: string;
  stripeSubscriptionId: string | null;
  paidAt: string | null;
  createdAt: string | null;
}

async function serialize(
  docs: Awaited<ReturnType<typeof TransactionModel.find>>,
): Promise<TransactionView[]> {
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
      plan: doc.plan,
      amount: doc.amount,
      currency: doc.currency,
      status: doc.status,
      stripeSessionId: doc.stripeSessionId,
      stripeSubscriptionId: doc.stripeSubscriptionId,
      paidAt: doc.paidAt?.toISOString() ?? null,
      createdAt: doc.createdAt?.toISOString() ?? null,
    };
  });
}

export async function listTransactions(query: TransactionQuery) {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;

  const skip = (query.page - 1) * query.limit;

  const [docs, total] = await Promise.all([
    TransactionModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(query.limit),
    TransactionModel.countDocuments(filter),
  ]);

  return {
    items: await serialize(docs),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function listVendorTransactions(
  user: AppUser,
  query: TransactionQuery,
) {
  const filter: Record<string, unknown> = {
    vendorId: new Types.ObjectId(user.id),
  };
  if (query.status) filter.status = query.status;

  const skip = (query.page - 1) * query.limit;

  const [docs, total] = await Promise.all([
    TransactionModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(query.limit),
    TransactionModel.countDocuments(filter),
  ]);

  return {
    items: await serialize(docs),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}
