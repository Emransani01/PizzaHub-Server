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
  blockUserSchema,
  buildProfile,
  completeRoleOnboarding,
  completeRoleSchema,
  listUsersForAdmin,
  listUsersQuerySchema,
  setUserBlocked,
  updateProfile,
  userIdParamSchema,
  type UpdateProfileInput,
} from "./user.service.js";

export const getMyProfile: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw ApiError.unauthorized();
  res.status(200).json(buildProfile(req.user));
});

export const updateMyProfile: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw ApiError.unauthorized();
  const input = validatedBody<UpdateProfileInput>(req);
  const profile = await updateProfile(req.user, input);
  res.status(200).json(profile);
});

export const completeMyRole: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw ApiError.unauthorized();
  const { role } = validatedBody<z.infer<typeof completeRoleSchema>>(req);
  const profile = await completeRoleOnboarding(req.user, role);
  res.status(200).json(profile);
});

export const listUsersHandler: RequestHandler = asyncHandler(async (req, res) => {
  const query = validatedQuery<z.infer<typeof listUsersQuerySchema>>(req);
  const result = await listUsersForAdmin(query);
  res.status(200).json(result);
});

export const setBlockedHandler: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = validatedParams<z.infer<typeof userIdParamSchema>>(req);
  const { blocked } = validatedBody<z.infer<typeof blockUserSchema>>(req);
  const user = await setUserBlocked(id, blocked);
  res.status(200).json(user);
});
