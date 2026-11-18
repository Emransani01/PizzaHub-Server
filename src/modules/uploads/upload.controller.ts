import type { RequestHandler } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { ApiError } from "../../lib/api-error.js";
import { uploadImageToImgbb } from "../../integrations/imgbb/imgbb.client.js";

export const uploadImageHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.file) {
      throw ApiError.badRequest("Attach an image file in the \"image\" field.");
    }

    const result = await uploadImageToImgbb(
      req.file.buffer,
      req.file.originalname || "pizzahub-upload",
    );

    res.status(201).json({
      url: result.url,
      displayUrl: result.displayUrl,
      id: result.id,
    });
  },
);
