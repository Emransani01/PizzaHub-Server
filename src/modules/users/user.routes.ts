import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { checkBlockedUser } from "../../middleware/check-blocked-user.js";
import { authorizeRole } from "../../middleware/authorize-role.js";
import { validateRequest } from "../../middleware/validate-request.js";
import {
  blockUserSchema,
  completeRoleSchema,
  listUsersQuerySchema,
  updateProfileSchema,
  userIdParamSchema,
} from "./user.service.js";
import {
  completeMyRole,
  getMyProfile,
  listUsersHandler,
  setBlockedHandler,
  updateMyProfile,
} from "./user.controller.js";

const router = Router();

router.get("/me", authenticate, checkBlockedUser, getMyProfile);

router.patch(
  "/me",
  authenticate,
  checkBlockedUser,
  validateRequest({ body: updateProfileSchema }),
  updateMyProfile,
);

router.post(
  "/me/role",
  authenticate,
  checkBlockedUser,
  validateRequest({ body: completeRoleSchema }),
  completeMyRole,
);

router.get(
  "/",
  authenticate,
  checkBlockedUser,
  authorizeRole("admin"),
  validateRequest({ query: listUsersQuerySchema }),
  listUsersHandler,
);

router.patch(
  "/:id/block",
  authenticate,
  checkBlockedUser,
  authorizeRole("admin"),
  validateRequest({ params: userIdParamSchema, body: blockUserSchema }),
  setBlockedHandler,
);

export default router;
