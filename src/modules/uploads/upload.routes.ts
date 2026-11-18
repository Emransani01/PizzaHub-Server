import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { checkBlockedUser } from "../../middleware/check-blocked-user.js";
import { authorizeRole } from "../../middleware/authorize-role.js";
import { imageUpload } from "../../middleware/image-upload.js";
import { uploadImageHandler } from "./upload.controller.js";

const router = Router();

router.post(
  "/menu-image",
  authenticate,
  checkBlockedUser,
  authorizeRole("vendor"),
  imageUpload.single("image"),
  uploadImageHandler,
);

router.post(
  "/profile-image",
  authenticate,
  checkBlockedUser,
  imageUpload.single("image"),
  uploadImageHandler,
);

export default router;
