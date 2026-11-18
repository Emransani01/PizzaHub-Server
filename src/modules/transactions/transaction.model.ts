import { Schema, model, models, type Model, type Types } from "mongoose";
import type { TransactionStatus } from "../../types/index.js";

/**
 * Vendor Premium subscription payments only. Customer pizza orders are not
 * paid through Stripe, so this collection never stores order payments.
 * Records are written exclusively by the verified Stripe webhook.
 */
export interface TransactionDocument {
  vendorId: Types.ObjectId;
  plan: "premium";
  amount: number;
  currency: string;
  status: TransactionStatus;
  stripeSessionId: string;
  stripeSubscriptionId: string | null;
  stripeInvoiceId: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<TransactionDocument>(
  {
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    plan: { type: String, enum: ["premium"], default: "premium", required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "cancelled", "expired"],
      default: "pending",
      required: true,
      index: true,
    },
    stripeSessionId: { type: String, required: true, unique: true, index: true },
    stripeSubscriptionId: { type: String, default: null, index: true },
    stripeInvoiceId: { type: String, default: null },
    paidAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "transactions",
    versionKey: false,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
  },
);

export const TransactionModel: Model<TransactionDocument> =
  (models.Transaction as Model<TransactionDocument> | undefined) ??
  model<TransactionDocument>("Transaction", transactionSchema);
