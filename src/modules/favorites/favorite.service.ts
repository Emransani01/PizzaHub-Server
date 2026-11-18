import { z } from "zod";
import { ApiError } from "../../lib/api-error.js";
import { toObjectId } from "../../lib/object-id.js";
import { updateUser } from "../../lib/user-repository.js";
import type { AppUser } from "../../types/index.js";
import { MenuItemModel } from "../menu-items/menu-item.model.js";
import {
  serializeMenuItems,
  type MenuItemView,
} from "../menu-items/menu-item.service.js";

export const favoriteItemParamSchema = z.object({
  itemId: z.string().trim().min(1),
});

export async function listFavorites(user: AppUser): Promise<MenuItemView[]> {
  const objectIds = user.favorites
    .map((id) => toObjectId(id))
    .filter((value): value is NonNullable<typeof value> => value !== null);

  if (objectIds.length === 0) return [];

  const docs = await MenuItemModel.find({
    _id: { $in: objectIds },
    status: "approved",
    isAvailable: true,
  });

  return serializeMenuItems(docs);
}

export async function addFavorite(
  user: AppUser,
  itemId: string,
): Promise<string[]> {
  const objectId = toObjectId(itemId);
  if (!objectId) {
    throw ApiError.badRequest("Menu item id is not valid.");
  }

  const item = await MenuItemModel.findOne({
    _id: objectId,
    status: "approved",
    isAvailable: true,
  });

  if (!item) {
    throw ApiError.notFound("Menu item not found.");
  }

  if (user.favorites.includes(itemId)) {
    return user.favorites;
  }

  if (user.favorites.length >= 50) {
    throw ApiError.conflict(
      "Your favourites list is full. Remove an item before adding another.",
    );
  }

  const favorites = [...user.favorites, itemId];
  const updated = await updateUser(user.id, { favorites });
  if (!updated) throw ApiError.notFound("Account not found.");
  return updated.favorites;
}

export async function removeFavorite(
  user: AppUser,
  itemId: string,
): Promise<string[]> {
  if (!user.favorites.includes(itemId)) {
    return user.favorites;
  }

  const favorites = user.favorites.filter((id) => id !== itemId);
  const updated = await updateUser(user.id, { favorites });
  if (!updated) throw ApiError.notFound("Account not found.");
  return updated.favorites;
}
