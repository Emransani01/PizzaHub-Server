import type { MenuItemStatus } from "../types/index.js";

/** The four menu-item statuses required by Assignment 9. */
export const MENU_ITEM_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "inactive",
] as const satisfies readonly MenuItemStatus[];

/**
 * Older documents use `approved + isAvailable:false` for a paused item. New
 * documents store `inactive` directly. Normalising at the API boundary keeps
 * both shapes consistent without requiring a database migration.
 */
export function displayMenuItemStatus(
  status: MenuItemStatus,
  isAvailable: boolean,
): MenuItemStatus {
  return status === "approved" && !isAvailable ? "inactive" : status;
}

export function isMenuItemPublic(
  status: MenuItemStatus,
  isAvailable: boolean,
): boolean {
  return status === "approved" && isAvailable;
}

/** True for both the stored `inactive` status and the legacy paused shape. */
export function isPausedMenuItem(
  status: MenuItemStatus,
  isAvailable: boolean,
): boolean {
  return status === "inactive" || (status === "approved" && !isAvailable);
}

/** Matches only items that are approved and currently available. */
export function activeMenuItemFilter(): Record<string, unknown> {
  return { status: "approved", isAvailable: true };
}

/** Matches both the stored `inactive` status and the backwards-compatible shape. */
export function inactiveMenuItemFilter(): Record<string, unknown> {
  return {
    $or: [{ status: "inactive" }, { status: "approved", isAvailable: false }],
  };
}
