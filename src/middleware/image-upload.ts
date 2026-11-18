import multer from "multer";
import { env } from "../config/environment.js";
import { ApiError } from "../lib/api-error.js";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploadMaxBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      callback(
        ApiError.unprocessable(
          "Only JPEG, PNG, WEBP or GIF images can be uploaded.",
        ),
      );
      return;
    }
    callback(null, true);
  },
});
