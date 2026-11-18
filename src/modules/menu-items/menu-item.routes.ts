import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { optionalAuthenticate } from "../../middleware/optional-authenticate.js";
import { checkBlockedUser } from "../../middleware/check-blocked-user.js";
import { authorizeRole } from "../../middleware/authorize-role.js";
import { validateRequest } from "../../middleware/validate-request.js";
import {
  adminMenuQuerySchema,
  adminStatusSchema,
  createMenuItemSchema,
  menuItemIdSchema,
  publicMenuQuerySchema,
  updateMenuItemSchema,
} from "./menu-item.schema.js";
import {
  createMenuItemHandler,
  deleteMenuItemHandler,
  getMenuItemHandler,
  listAdminMenuItemsHandler,
  listCategoriesHandler,
  listFeaturedHandler,
  listLocationsHandler,
  listMenuItemsHandler,
  listMyMenuItems,
  setMenuItemStatusHandler,
  updateMenuItemHandler,
} from "./menu-item.controller.js";

const router = Router();

router.get("/categories", listCategoriesHandler);
router.get("/locations", listLocationsHandler);
router.get("/featured", listFeaturedHandler);

router.get(
  "/mine",
  authenticate,
  checkBlockedUser,
  authorizeRole("vendor"),
  listMyMenuItems,
);

router.get(
  "/admin",
  authenticate,
  checkBlockedUser,
  authorizeRole("admin"),
  validateRequest({ query: adminMenuQuerySchema }),
  listAdminMenuItemsHandler,
);

router.get(
  "/",
  validateRequest({ query: publicMenuQuerySchema }),
  listMenuItemsHandler,
);

router.get(
  "/:id",
  optionalAuthenticate,
  validateRequest({ params: menuItemIdSchema }),
  getMenuItemHandler,
);

router.post(
  "/",
  authenticate,
  checkBlockedUser,
  authorizeRole("vendor"),
  validateRequest({ body: createMenuItemSchema }),
  createMenuItemHandler,
);

router.patch(
  "/:id",
  authenticate,
  checkBlockedUser,
  authorizeRole("vendor", "admin"),
  validateRequest({ params: menuItemIdSchema, body: updateMenuItemSchema }),
  updateMenuItemHandler,
);

router.patch(
  "/:id/status",
  authenticate,
  checkBlockedUser,
  authorizeRole("admin"),
  validateRequest({ params: menuItemIdSchema, body: adminStatusSchema }),
  setMenuItemStatusHandler,
);

router.delete(
  "/:id",
  authenticate,
  checkBlockedUser,
  authorizeRole("vendor", "admin"),
  validateRequest({ params: menuItemIdSchema }),
  deleteMenuItemHandler,
);

export default router;
