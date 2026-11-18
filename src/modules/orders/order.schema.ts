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
