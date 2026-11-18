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
  adminMenuQuerySchema,
  adminStatusSchema,
  createMenuItemSchema,
  menuItemIdSchema,
  publicMenuQuerySchema,
  updateMenuItemSchema,
  type CreateMenuItemInput,
  type UpdateMenuItemInput,
} from "./menu-item.schema.js";
import {
  createMenuItem,
  deleteMenuItem,
  getCategoryCounts,
  getMenuItemForViewer,
  listAdminMenuItems,
  listFeaturedMenuItems,
  listLocations,
  listPublicMenuItems,
  listVendorMenuItems,
  setMenuItemStatus,
  updateMenuItem,
} from "./menu-item.service.js";

export const listMenuItemsHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    const query = validatedQuery<z.infer<typeof publicMenuQuerySchema>>(req);
    res.status(200).json(await listPublicMenuItems(query));
  },
);

export const listFeaturedHandler: RequestHandler = asyncHandler(
  async (_req, res) => {
    res.status(200).json({ items: await listFeaturedMenuItems(8) });
  },
);

export const listCategoriesHandler: RequestHandler = asyncHandler(
  async (_req, res) => {
    res.status(200).json({ categories: await getCategoryCounts() });
  },
);

export const listLocationsHandler: RequestHandler = asyncHandler(
  async (_req, res) => {
    res.status(200).json({ locations: await listLocations() });
  },
);

export const listMyMenuItems: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw ApiError.unauthorized();
  res.status(200).json({ items: await listVendorMenuItems(req.user.id) });
});

export const listAdminMenuItemsHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    const query = validatedQuery<z.infer<typeof adminMenuQuerySchema>>(req);
    res.status(200).json(await listAdminMenuItems(query));
  },
);

export const getMenuItemHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    const { id } = validatedParams<z.infer<typeof menuItemIdSchema>>(req);
    res.status(200).json(await getMenuItemForViewer(id, req.user));
  },
);

export const createMenuItemHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const input = validatedBody<CreateMenuItemInput>(req);
    const item = await createMenuItem(req.user, input);
    res.status(201).json(item);
  },
);

export const updateMenuItemHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = validatedParams<z.infer<typeof menuItemIdSchema>>(req);
    const input = validatedBody<UpdateMenuItemInput>(req);
    res.status(200).json(await updateMenuItem(id, req.user, input));
  },
);

export const setMenuItemStatusHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    const { id } = validatedParams<z.infer<typeof menuItemIdSchema>>(req);
    const { status, reason } = validatedBody<
      z.infer<typeof adminStatusSchema>
    >(req);
    res.status(200).json(await setMenuItemStatus(id, status, reason));
  },
);

export const deleteMenuItemHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = validatedParams<z.infer<typeof menuItemIdSchema>>(req);
    await deleteMenuItem(id, req.user);
    res.status(204).send();
  },
);
