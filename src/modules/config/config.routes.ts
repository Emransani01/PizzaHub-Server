import { Router } from "express";
import { env } from "../../config/environment.js";
import {
  MENU_CATEGORIES,
  MENU_CATEGORY_DESCRIPTIONS,
  MENU_CATEGORY_SLUGS,
} from "../../lib/categories.js";

const router = Router();

/**
 * Public feature flags. Only booleans are exposed so the UI can hide optional
 * integrations that are not configured, without leaking any secret material.
 */
router.get("/public", (_req, res) => {
  res.status(200).json({
    googleEnabled: env.google.enabled,
    stripeEnabled: env.stripe.enabled,
    imgbbEnabled: env.imgbb.enabled,
    freePlanActiveItemLimit: env.freePlanActiveItemLimit,
    categories: MENU_CATEGORIES.map((category) => ({
      name: category,
      slug: MENU_CATEGORY_SLUGS[category],
      description: MENU_CATEGORY_DESCRIPTIONS[category],
    })),
  });
});

export default router;
