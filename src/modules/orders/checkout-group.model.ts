import mongoose, { Schema, model, type Model, type Types } from "mongoose";

export interface CheckoutGroupItem {
  itemId: Types.ObjectId;
  quantity: number;
}

export interface CheckoutGroupDocument {
  customerId: Types.ObjectId;
  checkoutGroupId: string;
  requestHash: string;
  items: CheckoutGroupItem[];
  orderIds: Types.ObjectId[];
  deliveryDate: Date;
  deliveryAddress: string;
  message: string | null;
  itemCount: number;
  totalQuantity: number;
  subtotal: number;
  total: number;
  createdAt: Date;
  updatedAt: Date;
}

const groupItemSchema = new Schema<CheckoutGroupItem>(
  {
    itemId: { type: Schema.Types.ObjectId, required: true },
    quantity: { type: Number, required: true, min: 1, max: 20 },
  },
  { _id: false },
);

const checkoutGroupSchema = new Schema<CheckoutGroupDocument>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    checkoutGroupId: { type: String, required: true },
    requestHash: { type: String, required: true },
    items: { type: [groupItemSchema], required: true },
    orderIds: { type: [Schema.Types.ObjectId], required: true },
    deliveryDate: { type: Date, required: true },
    deliveryAddress: { type: String, required: true },
    message: { type: String, default: null },
    itemCount: { type: Number, required: true, min: 1 },
    totalQuantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  {
    timestamps: true,
    collection: "checkout_groups",
    versionKey: false,
    autoIndex: false,
  },
);

// The unique pair is the group-level lock. A per-line unique index on orders is
// not enough: two concurrent requests with the same UUID but different item
// sets would otherwise both commit and merge into one incomplete checkout.
checkoutGroupSchema.index(
  { customerId: 1, checkoutGroupId: 1 },
  { unique: true, name: "uniq_customer_checkout_group" },
);
checkoutGroupSchema.index({ customerId: 1, createdAt: -1 });

export const CheckoutGroupModel: Model<CheckoutGroupDocument> =
  (mongoose.models.CheckoutGroup as Model<CheckoutGroupDocument> | undefined) ??
  model<CheckoutGroupDocument>("CheckoutGroup", checkoutGroupSchema);

export async function ensureCheckoutGroupIndexes(): Promise<void> {
  await CheckoutGroupModel.createIndexes();
}
