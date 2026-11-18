import type { RequestHandler } from "express";
import type { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { ApiError } from "../../lib/api-error.js";
import { validatedQuery } from "../../middleware/validate-request.js";
import {
  listTransactions,
  listVendorTransactions,
  transactionQuerySchema,
} from "./transaction.service.js";

export const listTransactionsHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    const query = validatedQuery<z.infer<typeof transactionQuerySchema>>(req);
    res.status(200).json(await listTransactions(query));
  },
);

export const listMyTransactionsHandler: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const query = validatedQuery<z.infer<typeof transactionQuerySchema>>(req);
    res.status(200).json(await listVendorTransactions(req.user, query));
  },
);
