import mongoose, { Schema, model, type Model, type Types } from "mongoose";
import { MENU_CATEGORIES } from "../../lib/categories.js";
import { MENU_ITEM_STATUSES } from "../../lib/menu-status.js";
import type { MenuCategory, MenuItemStatus } from "../../types/index.js";

export interface MenuItemDocument {
  vendorId: Types.ObjectId;
  itemName: string;
  category: MenuCategory;
  description: string;
  price: number;
  location: string;
  images: string[];
  status: MenuItemStatus;
  isAvailable: boolean;
  activeSlot?: number | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const menuItemSchema = new Schema<MenuItemDocument>(
  {
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    itemName: { type: String, required: true, trim: true, maxlength: 120 },
    category: {
      type: String,
      enum: MENU_CATEGORIES,
      required: true,
      index: true,
    },
    description: { type: String, required: true, trim: true, maxlength: 1200 },
    price: { type: Number, required: true, min: 0.01, max: 100000 },
    location: { type: String, required: true, trim: true, maxlength: 160 },
    images: {
      type: [String],
      required: true,
      validate: {
        validator: (images: string[]) => images.length > 0 && images.length <= 3,
        message: "Provide between 1 and 3 images.",
      },
    },
    status: {
      type: String,
      enum: [...MENU_ITEM_STATUSES],
      default: "pending",
      required: true,
      index: true,
    },
    isAvailable: { type: Boolean, default: true, required: true },
    activeSlot: { type: Number, default: null },
    rejectionReason: { type: String, default: null, trim: true },
  },
  {
    timestamps: true,
    collection: "menuItems",
    versionKey: false,
    // Indexes are created once, explicitly, by ensureMenuItemIndexes() during
    // database startup so a build failure aborts startup instead of surfacing
    // later as a silent request-level error.
    autoIndex: false,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
  },
);

menuItemSchema.index({ status: 1, isAvailable: 1, category: 1, price: 1 });
menuItemSchema.index({ status: 1, isAvailable: 1, createdAt: -1 });
menuItemSchema.index({ itemName: "text", description: "text" });

// Mandatory correctness constraint: a free vendor has only slots 0..limit-1.
// The partial filter excludes legacy documents with no numeric activeSlot, so
// building this index never rewrites or rejects existing data.
menuItemSchema.index(
  { vendorId: 1, activeSlot: 1 },
  {
    unique: true,
    name: "uniq_vendor_active_slot",
    partialFilterExpression: { activeSlot: { $type: "number" } },
  },
);

export const MenuItemModel: Model<MenuItemDocument> =
  (mongoose.models.MenuItem as Model<MenuItemDocument> | undefined) ??
  model<MenuItemDocument>("MenuItem", menuItemSchema);

/**
 * Single startup call that creates every menu-item index, including the unique
 * active-slot constraint. Callers must await this before serving requests and
 * must not swallow failures: without the index the free-plan cap is not safe.
 */
export async function ensureMenuItemIndexes(): Promise<void> {
  await MenuItemModel.createIndexes();
}
