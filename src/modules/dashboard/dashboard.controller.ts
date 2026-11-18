import type { RequestHandler } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { ApiError } from "../../lib/api-error.js";
import { getOverview } from "./dashboard.service.js";

export const getOverviewHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    res.status(200).json(await getOverview(req.user));
  },
);
