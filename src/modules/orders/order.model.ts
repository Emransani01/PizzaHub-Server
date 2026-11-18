import { Schema, model, models, type Model, type Types } from "mongoose";
import type { OrderStatus, UserRole } from "../../types/index.js";

export interface OrderStatusEntry {
  status: OrderStatus;
  changedBy: Types.ObjectId;
  changedByRole: UserRole;
  changedAt: Date;
  note?: string | null;
}

export interface OrderDocument {
  itemId: Types.ObjectId;
  vendorId: Types.ObjectId;
  customerId: Types.ObjectId;
  itemName: string;
  itemImage: string | null;
  itemPrice: number;
  deliveryDate: Date;
  deliveryAddress: string;
  message: string | null;
  status: OrderStatus;
  statusHistory: OrderStatusEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const statusEntrySchema = new Schema<OrderStatusEntry>(
  {
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "cancelled"],
      required: true,
    },
    changedBy: { type: Schema.Types.ObjectId, required: true },
    changedByRole: {
      type: String,
      enum: ["customer", "vendor", "admin"],
      required: true,
    },
    changedAt: { type: Date, required: true },
    note: { type: String, default: null, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const orderSchema = new Schema<OrderDocument>(
  {
    itemId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, required: true, index: true },
    itemName: { type: String, required: true, trim: true },
    itemImage: { type: String, default: null },
    itemPrice: { type: Number, required: true, min: 0 },
    deliveryDate: { type: Date, required: true, index: true },
    deliveryAddress: { type: String, required: true, trim: true, maxlength: 400 },
    message: { type: String, default: null, trim: true, maxlength: 600 },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "cancelled"],
      default: "pending",
      required: true,
      index: true,
    },
    statusHistory: { type: [statusEntrySchema], required: true, default: [] },
  },
  {
    timestamps: true,
    collection: "orders",
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

orderSchema.index({ customerId: 1, itemId: 1, deliveryDate: 1, status: 1 });
orderSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
orderSchema.index({ customerId: 1, status: 1, createdAt: -1 });

export const OrderModel: Model<OrderDocument> =
  (models.Order as Model<OrderDocument> | undefined) ??
  model<OrderDocument>("Order", orderSchema);
