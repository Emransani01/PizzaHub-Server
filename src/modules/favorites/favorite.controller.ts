import type { RequestHandler } from "express";
import type { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { ApiError } from "../../lib/api-error.js";
import { validatedParams } from "../../middleware/validate-request.js";
import {
  addFavorite,
  favoriteItemParamSchema,
  listFavorites,
  removeFavorite,
} from "./favorite.service.js";

export const listFavoritesHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    res.status(200).json({ items: await listFavorites(req.user) });
  },
);

export const addFavoriteHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { itemId } = validatedParams<z.infer<typeof favoriteItemParamSchema>>(
      req,
    );
    const favorites = await addFavorite(req.user, itemId);
    res.status(200).json({ favorites });
  },
);

export const removeFavoriteHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { itemId } = validatedParams<z.infer<typeof favoriteItemParamSchema>>(
      req,
    );
    const favorites = await removeFavorite(req.user, itemId);
    res.status(200).json({ favorites });
  },
);
