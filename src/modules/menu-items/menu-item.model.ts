import { Schema, model, models, type Model, type Types } from "mongoose";
import { MENU_CATEGORIES } from "../../lib/categories.js";
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
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      required: true,
      index: true,
    },
    isAvailable: { type: Boolean, default: true, required: true },
    rejectionReason: { type: String, default: null, trim: true },
  },
  {
    timestamps: true,
    collection: "menuItems",
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

menuItemSchema.index({ status: 1, isAvailable: 1, category: 1, price: 1 });
menuItemSchema.index({ status: 1, isAvailable: 1, createdAt: -1 });
menuItemSchema.index({ itemName: "text", description: "text" });

export const MenuItemModel: Model<MenuItemDocument> =
  (models.MenuItem as Model<MenuItemDocument> | undefined) ??
  model<MenuItemDocument>("MenuItem", menuItemSchema);
