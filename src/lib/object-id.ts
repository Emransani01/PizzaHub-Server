import { ObjectId } from "mongodb";
import { ApiError } from "./api-error.js";

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export function isObjectIdString(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID_PATTERN.test(value);
}

export function toObjectId(value: string): ObjectId | null {
  if (!isObjectIdString(value)) return null;
  return new ObjectId(value);
}

export function parseObjectId(value: string, resource = "Resource"): ObjectId {
  const objectId = toObjectId(value);
  if (!objectId) {
    throw ApiError.badRequest(`${resource} id is not valid.`);
  }
  return objectId;
}
