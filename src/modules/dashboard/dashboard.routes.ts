import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { checkBlockedUser } from "../../middleware/check-blocked-user.js";
import { getOverviewHandler } from "./dashboard.controller.js";

const router = Router();

router.get("/overview", authenticate, checkBlockedUser, getOverviewHandler);

export default router;
