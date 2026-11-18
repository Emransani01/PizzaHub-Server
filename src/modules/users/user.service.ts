import { z } from "zod";
import { ApiError } from "../../lib/api-error.js";
import {
  findUserById,
  toPublicUser,
  updateUser,
  listUsers,
} from "../../lib/user-repository.js";
import type { AppUser, PublicUser, UserRole } from "../../types/index.js";

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(80).optional(),
  image: z.string().trim().url("Image must be a valid URL.").max(600).nullable().optional(),
  businessName: z
    .string()
    .trim()
    .min(2, "Business name must be at least 2 characters.")
    .max(120)
    .nullable()
    .optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const completeRoleSchema = z.object({
  role: z.enum(["customer", "vendor"], {
    message: "Choose either the customer or vendor role.",
  }),
});

export const listUsersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  role: z.enum(["customer", "vendor", "admin"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const blockUserSchema = z.object({
  blocked: z.boolean(),
});

export const userIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export interface ProfileResponse extends PublicUser {
  favoritesCount: number;
}

export function buildProfile(user: AppUser): ProfileResponse {
  return {
    ...toPublicUser(user),
    favoritesCount: user.favorites.length,
  };
}

export async function updateProfile(
  user: AppUser,
  input: UpdateProfileInput,
): Promise<ProfileResponse> {
  if (
    input.businessName !== undefined &&
    input.businessName !== null &&
    user.role !== "vendor"
  ) {
    throw ApiError.forbidden(
      "Only vendor accounts can set a business name.",
    );
  }

  if (Object.keys(input).length === 0) {
    return buildProfile(user);
  }

  const updated = await updateUser(user.id, {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.image === undefined ? {} : { image: input.image }),
    ...(input.businessName === undefined
      ? {}
      : { businessName: input.businessName }),
  });

  if (!updated) {
    throw ApiError.notFound("Account not found.");
  }

  return buildProfile(updated);
}

/**
 * One-time role selection. Used after email sign-up and after a first Google
 * sign-in. The role can never be supplied through Better Auth's own payload,
 * and "admin" is not an accepted value.
 */
export async function completeRoleOnboarding(
  user: AppUser,
  role: "customer" | "vendor",
): Promise<ProfileResponse> {
  if (user.role === "admin") {
    throw ApiError.forbidden("Administrator roles cannot be changed here.");
  }

  if (user.roleOnboarded) {
    throw ApiError.conflict("Your account type has already been set.");
  }

  const updated = await updateUser(user.id, {
    role: role as UserRole,
    roleOnboarded: true,
  });

  if (!updated) {
    throw ApiError.notFound("Account not found.");
  }

  return buildProfile(updated);
}

export async function listUsersForAdmin(query: {
  search?: string;
  role?: UserRole;
  page: number;
  limit: number;
}): Promise<{
  items: PublicUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const { items, total } = await listUsers(query);

  return {
    items: items.map(toPublicUser),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function setUserBlocked(
  targetId: string,
  blocked: boolean,
): Promise<PublicUser> {
  const target = await findUserById(targetId);

  if (!target) {
    throw ApiError.notFound("User not found.");
  }

  if (target.role === "admin") {
    throw ApiError.forbidden("Administrator accounts cannot be blocked.");
  }

  if (target.isBlocked === blocked) {
    return toPublicUser(target);
  }

  const updated = await updateUser(targetId, { isBlocked: blocked });

  if (!updated) {
    throw ApiError.notFound("User not found.");
  }

  return toPublicUser(updated);
}
