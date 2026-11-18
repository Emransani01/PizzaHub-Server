import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { checkBlockedUser } from "../../middleware/check-blocked-user.js";
import { authorizeRole } from "../../middleware/authorize-role.js";
import { validateRequest } from "../../middleware/validate-request.js";
import {
  addFavoriteHandler,
  listFavoritesHandler,
  removeFavoriteHandler,
} from "./favorite.controller.js";
import { favoriteItemParamSchema } from "./favorite.service.js";

const router = Router();

router.use(authenticate, checkBlockedUser, authorizeRole("customer"));

router.get("/", listFavoritesHandler);

router.post(
  "/:itemId",
  validateRequest({ params: favoriteItemParamSchema }),
  addFavoriteHandler,
);

router.delete(
  "/:itemId",
  validateRequest({ params: favoriteItemParamSchema }),
  removeFavoriteHandler,
);

export default router;
