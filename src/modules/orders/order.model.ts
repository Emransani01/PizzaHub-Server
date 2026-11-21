import mongoose, { Schema, model, type Model, type Types } from "mongoose";
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
  /** Unit price captured from the database when the order was created. */
  itemPrice: number;
  quantity: number;
  checkoutGroupId: string | null;
  deliveryDate: Date;
  deliveryAddress: string;
  message: string | null;
  status: OrderStatus;
  /**
   * Present only while the order is active (pending/accepted). Used by a
   * partial unique index to prevent duplicate active orders for the same
   * customer, item and delivery date at the database level.
   */
  activeOrderKey: string | null;
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
    quantity: { type: Number, required: true, min: 1, default: 1 },
    checkoutGroupId: { type: String, default: null },
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
    activeOrderKey: { type: String, default: null },
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
orderSchema.index(
  { activeOrderKey: 1 },
  {
    unique: true,
    partialFilterExpression: { activeOrderKey: { $type: "string" } },
  },
);
orderSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
orderSchema.index({ customerId: 1, status: 1, createdAt: -1 });
// Checkout lines are read back by their stable group id during replay.
orderSchema.index({ customerId: 1, checkoutGroupId: 1, createdAt: 1 });

export const OrderModel: Model<OrderDocument> =
  (mongoose.models.Order as Model<OrderDocument> | undefined) ??
  model<OrderDocument>("Order", orderSchema);
