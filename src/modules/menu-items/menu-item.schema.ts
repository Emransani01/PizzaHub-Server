import { z } from "zod";
import { MENU_CATEGORIES } from "../../lib/categories.js";
import { categoryFromSlug } from "../../lib/categories.js";
import type { MenuCategory } from "../../types/index.js";

const categorySchema = z
  .string()
  .trim()
  .max(80)
  .transform<MenuCategory>((value, ctx) => {
    const direct = MENU_CATEGORIES.find((category) => category === value);
    if (direct) {
      return direct;
    }
    const fromSlug = categoryFromSlug(value);
    if (fromSlug) return fromSlug;
    ctx.addIssue({
      code: "custom",
      message: `Category must be one of: ${MENU_CATEGORIES.join(", ")}`,
    });
    return z.NEVER;
  });

export const createMenuItemSchema = z.object({
  itemName: z.string().trim().min(2, "Item name is required.").max(120),
  category: categorySchema,
  description: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters.")
    .max(1200),
  price: z.coerce
    .number()
    .positive("Price must be greater than zero.")
    .max(100000),
  location: z.string().trim().min(2, "Location is required.").max(160),
  images: z
    .array(z.string().trim().url("Each image must be a valid URL.").max(600))
    .min(1, "At least one image is required.")
    .max(3, "A maximum of three images is allowed."),
  isAvailable: z.boolean().optional(),
});

export const updateMenuItemSchema = z
  .object({
    itemName: z.string().trim().min(2).max(120).optional(),
    category: categorySchema.optional(),
    description: z.string().trim().min(10).max(1200).optional(),
    price: z.coerce.number().positive().max(100000).optional(),
    location: z.string().trim().min(2).max(160).optional(),
    images: z
      .array(z.string().trim().url().max(600))
      .min(1)
      .max(3)
      .optional(),
    isAvailable: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export const adminStatusSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
  reason: z.string().trim().max(500).optional(),
});

export const menuItemIdSchema = z.object({
  id: z.string().trim().min(1),
});

export const publicMenuQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  location: z.string().trim().max(160).optional(),
  sort: z.enum(["price_asc", "price_desc", "newest"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});

export const adminMenuQuerySchema = publicMenuQuerySchema.extend({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  vendorId: z.string().trim().max(40).optional(),
});

export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;
export type PublicMenuQuery = z.infer<typeof publicMenuQuerySchema>;
export type AdminMenuQuery = z.infer<typeof adminMenuQuerySchema>;
