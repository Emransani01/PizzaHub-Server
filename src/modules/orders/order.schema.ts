import { z } from "zod";

export const createOrderSchema = z.object({
  itemId: z.string().trim().min(1, "A menu item is required."),
  deliveryDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Delivery date must use the YYYY-MM-DD format."),
  deliveryAddress: z
    .string()
    .trim()
    .min(10, "Delivery address must be at least 10 characters.")
    .max(400),
  message: z.string().trim().max(600).optional(),
});

const deliveryDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Delivery date must use the YYYY-MM-DD format.");

const deliveryAddressSchema = z
  .string()
  .trim()
  .min(10, "Delivery address must be at least 10 characters.")
  .max(400);

const cartItemSchema = z.object({
  itemId: z.string().trim().min(1, "A menu item is required."),
  quantity: z.number().int().min(1).max(20),
});

export const quoteCartSchema = z.object({
  items: z
    .array(
      cartItemSchema.extend({
        expectedUnitPrice: z.number().finite().nonnegative().optional(),
        /**
         * Explicit acceptance of a changed price. The server only honours it
         * when it equals the authoritative database price for that item.
         */
        acknowledgedUnitPrice: z.number().finite().nonnegative().optional(),
      }),
    )
    .min(1, "Add at least one item to checkout.")
    .max(20, "A cart can contain at most 20 lines."),
});

export const checkoutCartSchema = z.object({
  checkoutGroupId: z
    .string()
    .trim()
    .uuid("Checkout group id must be a UUID."),
  items: z.array(cartItemSchema).min(1).max(20),
  quoteToken: z.string().trim().min(1, "A current price quote is required."),
  deliveryDate: deliveryDateSchema,
  deliveryAddress: deliveryAddressSchema,
  message: z.string().trim().max(600).optional(),
});

export const orderStatusSchema = z.object({
  status: z.enum(["accepted", "rejected", "cancelled"], {
    message: "Status must be accepted, rejected or cancelled.",
  }),
  note: z.string().trim().max(500).optional(),
});

export const orderQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "rejected", "cancelled"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const orderIdSchema = z.object({
  id: z.string().trim().min(1),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderQuery = z.infer<typeof orderQuerySchema>;
export type QuoteCartInput = z.infer<typeof quoteCartSchema>;
export type CheckoutCartInput = z.infer<typeof checkoutCartSchema>;
