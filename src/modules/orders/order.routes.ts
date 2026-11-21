import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { checkBlockedUser } from "../../middleware/check-blocked-user.js";
import { authorizeRole } from "../../middleware/authorize-role.js";
import { validateRequest } from "../../middleware/validate-request.js";
import {
  checkoutCartSchema,
  createOrderSchema,
  orderIdSchema,
  orderQuerySchema,
  orderStatusSchema,
  quoteCartSchema,
} from "./order.schema.js";
import {
  checkoutCartHandler,
  createOrderHandler,
  getOrderHandler,
  listOrdersHandler,
  quoteCartHandler,
  updateOrderStatusHandler,
} from "./order.controller.js";

const router = Router();

router.use(authenticate, checkBlockedUser);

router.get(
  "/",
  validateRequest({ query: orderQuerySchema }),
  listOrdersHandler,
);

router.post(
  "/quote",
  authorizeRole("customer"),
  validateRequest({ body: quoteCartSchema }),
  quoteCartHandler,
);

router.post(
  "/checkout",
  authorizeRole("customer"),
  validateRequest({ body: checkoutCartSchema }),
  checkoutCartHandler,
);

router.get(
  "/:id",
  validateRequest({ params: orderIdSchema }),
  getOrderHandler,
);

router.post(
  "/",
  authorizeRole("customer"),
  validateRequest({ body: createOrderSchema }),
  createOrderHandler,
);

router.patch(
  "/:id/status",
  authorizeRole("customer", "vendor"),
  validateRequest({ params: orderIdSchema, body: orderStatusSchema }),
  updateOrderStatusHandler,
);

export default router;
