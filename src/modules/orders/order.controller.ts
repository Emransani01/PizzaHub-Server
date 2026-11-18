import type { RequestHandler } from "express";
import type { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { ApiError } from "../../lib/api-error.js";
import {
  validatedBody,
  validatedParams,
  validatedQuery,
} from "../../middleware/validate-request.js";
import {
  createOrderSchema,
  orderIdSchema,
  orderQuerySchema,
  orderStatusSchema,
  type CreateOrderInput,
  type OrderQuery,
} from "./order.schema.js";
import {
  createOrder,
  getOrderById,
  listOrders,
  updateOrderStatus,
} from "./order.service.js";

export const listOrdersHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const query = validatedQuery<OrderQuery>(req);
    res.status(200).json(await listOrders(req.user, query));
  },
);

export const getOrderHandler: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw ApiError.unauthorized();
  const { id } = validatedParams<z.infer<typeof orderIdSchema>>(req);
  res.status(200).json(await getOrderById(id, req.user));
});

export const createOrderHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const input = validatedBody<CreateOrderInput>(req);
    const order = await createOrder(req.user, input);
    res.status(201).json(order);
  },
);

export const updateOrderStatusHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = validatedParams<z.infer<typeof orderIdSchema>>(req);
    const { status, note } = validatedBody<
      z.infer<typeof orderStatusSchema>
    >(req);
    res.status(200).json(await updateOrderStatus(id, req.user, status, note));
  },
);
