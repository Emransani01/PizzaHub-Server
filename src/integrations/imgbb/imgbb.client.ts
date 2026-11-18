import { env } from "../../config/environment.js";
import { ApiError } from "../../lib/api-error.js";

interface ImgbbResponse {
  success?: boolean;
  data?: {
    id?: string;
    url?: string;
    display_url?: string;
    delete_url?: string;
  };
  error?: { message?: string };
}

export interface ImgbbUploadResult {
  url: string;
  displayUrl: string;
  id: string | null;
}

/**
 * Uploads an image buffer to ImgBB. The API key is read from the server
 * environment and never reaches the browser.
 */
export async function uploadImageToImgbb(
  buffer: Buffer,
  fileName: string,
): Promise<ImgbbUploadResult> {
  if (!env.imgbb.enabled) {
    throw ApiError.unavailable(
      "Image uploads are not configured. Add IMGBB_API_KEY to the server environment.",
    );
  }

  const form = new FormData();
  form.append("image", buffer.toString("base64"));
  form.append("name", fileName.slice(0, 80));

  const response = await fetch(
    `https://api.imgbb.com/1/upload?key=${encodeURIComponent(env.imgbb.apiKey)}`,
    { method: "POST", body: form },
  );

  const payload = (await response.json().catch(() => null)) as
    | ImgbbResponse
    | null;

  if (!response.ok || !payload?.success || !payload.data?.url) {
    throw new ApiError(
      502,
      payload?.error?.message ??
        "ImgBB rejected the upload. Check the API key and try again.",
      { code: "UPLOAD_FAILED" },
    );
  }

  return {
    url: payload.data.url,
    displayUrl: payload.data.display_url ?? payload.data.url,
    id: payload.data.id ?? null,
  };
}
