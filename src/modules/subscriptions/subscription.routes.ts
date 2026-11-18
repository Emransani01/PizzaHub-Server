import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { checkBlockedUser } from "../../middleware/check-blocked-user.js";
import { authorizeRole } from "../../middleware/authorize-role.js";
import { validateRequest } from "../../middleware/validate-request.js";
import {
  checkoutSessionParamSchema,
  createCheckoutHandler,
  getCheckoutStatusHandler,
  getStatusHandler,
} from "./subscription.controller.js";

const router = Router();

router.get(
  "/status",
  authenticate,
  checkBlockedUser,
  authorizeRole("vendor"),
  getStatusHandler,
);

router.post(
  "/checkout",
  authenticate,
  checkBlockedUser,
  authorizeRole("vendor"),
  createCheckoutHandler,
);

router.get(
  "/checkout/:sessionId",
  authenticate,
  checkBlockedUser,
  authorizeRole("vendor"),
  validateRequest({ params: checkoutSessionParamSchema }),
  getCheckoutStatusHandler,
);

export default router;
