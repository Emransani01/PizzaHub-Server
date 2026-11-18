import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { checkBlockedUser } from "../../middleware/check-blocked-user.js";
import { authorizeRole } from "../../middleware/authorize-role.js";
import { validateRequest } from "../../middleware/validate-request.js";
import {
  listMyTransactionsHandler,
  listTransactionsHandler,
} from "./transaction.controller.js";
import { transactionQuerySchema } from "./transaction.service.js";

const router = Router();

// Read-only by design: there is intentionally no create, update or delete
// route, so administrators cannot fabricate or edit payment records.
router.get(
  "/me",
  authenticate,
  checkBlockedUser,
  authorizeRole("vendor"),
  validateRequest({ query: transactionQuerySchema }),
  listMyTransactionsHandler,
);

router.get(
  "/",
  authenticate,
  checkBlockedUser,
  authorizeRole("admin"),
  validateRequest({ query: transactionQuerySchema }),
  listTransactionsHandler,
);

export default router;
