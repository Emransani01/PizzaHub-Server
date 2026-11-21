import { createHash } from "node:crypto";
import mongoose, { Types, type HydratedDocument } from "mongoose";
import type { ObjectId } from "mongodb";
import { ApiError } from "../../lib/api-error.js";
import { isMenuItemPublic } from "../../lib/menu-status.js";
import { roundMoney, sameMoney } from "../../lib/money.js";
import { toObjectId } from "../../lib/object-id.js";
import {
  QUOTE_TOKEN_TTL_MS,
  signQuoteToken,
  verifyQuoteToken,
  type QuoteTokenItem,
} from "../../lib/quote-token.js";
import type { AppUser } from "../../types/index.js";
import {
  MenuItemModel,
  type MenuItemDocument,
} from "../menu-items/menu-item.model.js";
import type { CheckoutCartInput, QuoteCartInput } from "./order.schema.js";
import {
  CheckoutGroupModel,
  type CheckoutGroupDocument,
} from "./checkout-group.model.js";
import {
  OrderModel,
  type OrderDocument,
  type OrderStatusEntry,
} from "./order.model.js";
import {
  activeOrderKey,
  normalizeDeliveryDate,
  serializeOrders,
  startOfTodayUtc,
  type OrderView,
} from "./order.service.js";

export type QuoteIssueCode =
  | "MISSING"
  | "UNAVAILABLE"
  | "OWN_ITEM"
  | "PRICE_CHANGED";

export interface CartQuoteIssue {
  itemId: string;
  code: QuoteIssueCode;
  message: string;
  expectedUnitPrice?: number;
  currentUnitPrice?: number;
}

export interface CartQuoteLine {
  itemId: string;
  itemName: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface CartQuoteResult {
  canCheckout: boolean;
  issues: CartQuoteIssue[];
  lines: CartQuoteLine[];
  /** Alias kept for clients that model quote lines as cart items. */
  items: CartQuoteLine[];
  subtotal: number;
  total: number;
  quoteToken: string | null;
  quoteExpiresAt: string | null;
}

export interface CheckoutSummary {
  itemCount: number;
  totalQuantity: number;
  subtotal: number;
  total: number;
  deliveryDate: string;
  deliveryAddress: string;
  message: string | null;
}

export interface CheckoutResult {
  checkoutGroupId: string;
  orders: OrderView[];
  summary: CheckoutSummary;
  replayed: boolean;
}

interface RequestedLine {
  itemId: string;
  objectId: ObjectId;
  quantity: number;
}

interface PreparedLine extends RequestedLine {
  menu: HydratedDocument<MenuItemDocument>;
  unitPrice: number;
}

function requireCustomer(customer: AppUser): void {
  if (customer.role !== "customer") {
    throw ApiError.forbidden("Only customer accounts can check out a cart.");
  }
}

function ensureUniqueItems(
  items: { itemId: string }[],
  errorLabel: string,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    const key = toObjectId(item.itemId)?.toHexString() ?? item.itemId;
    if (seen.has(key)) {
      throw ApiError.unprocessable(
        `${errorLabel} cannot contain the same menu item more than once.`,
      );
    }
    seen.add(key);
  }
}

function staleQuote(message: string, code = "QUOTE_INVALID"): ApiError {
  return new ApiError(409, message, {
    code,
    details: { requiresFreshQuote: true },
  });
}

function sortedSignatureItems(items: { itemId: string; quantity: number }[]) {
  return items
    .map((item) => ({ itemId: item.itemId, quantity: item.quantity }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
}

function requestHash(
  customer: AppUser,
  input: CheckoutCartInput,
  deliveryDate: Date,
  lines: RequestedLine[],
): string {
  const payload = {
    customerId: customer.id,
    checkoutGroupId: input.checkoutGroupId,
    items: sortedSignatureItems(lines),
    deliveryDate: deliveryDate.toISOString().slice(0, 10),
    deliveryAddress: input.deliveryAddress.trim(),
    message: input.message?.trim() || null,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function isDuplicateKeyError(error: unknown): error is {
  code: number;
  keyPattern?: Record<string, unknown>;
  message: string;
} {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { code?: number }).code === 11000
  );
}

function isGroupDuplicateError(error: unknown): boolean {
  if (!isDuplicateKeyError(error)) return false;
  return Boolean(
    error.keyPattern?.checkoutGroupId ||
      error.message.includes("uniq_customer_checkout_group"),
  );
}

function isActiveOrderDuplicateError(error: unknown): boolean {
  if (!isDuplicateKeyError(error)) return false;
  return Boolean(
    error.keyPattern?.activeOrderKey ||
      error.message.includes("activeOrderKey"),
  );
}

function summaryFromGroup(group: CheckoutGroupDocument): CheckoutSummary {
  return {
    itemCount: group.itemCount,
    totalQuantity: group.totalQuantity,
    subtotal: roundMoney(group.subtotal),
    total: roundMoney(group.total),
    deliveryDate: group.deliveryDate.toISOString().slice(0, 10),
    deliveryAddress: group.deliveryAddress,
    message: group.message ?? null,
  };
}

/** Return the committed checkout when the same id and request arrive again. */
async function replayCheckout(
  customer: AppUser,
  input: CheckoutCartInput,
  deliveryDate: Date,
  lines: RequestedLine[],
): Promise<CheckoutResult> {
  const hash = requestHash(customer, input, deliveryDate, lines);
  const group = await CheckoutGroupModel.findOne({
    customerId: new Types.ObjectId(customer.id),
    checkoutGroupId: input.checkoutGroupId,
  });

  if (!group) {
    throw staleQuote("This checkout could not be found. Please try again.");
  }

  if (group.requestHash !== hash) {
    throw new ApiError(
      409,
      "This checkout id was already used for a different cart.",
      { code: "CHECKOUT_GROUP_CONFLICT" },
    );
  }

  const orders = await OrderModel.find({
    _id: { $in: group.orderIds },
    customerId: new Types.ObjectId(customer.id),
    checkoutGroupId: input.checkoutGroupId,
  });

  const byId = new Map(orders.map((order) => [order._id.toString(), order]));
  const ordered = group.orderIds
    .map((id) => byId.get(id.toString()))
    .filter((order): order is (typeof orders)[number] => Boolean(order));

  if (ordered.length !== group.orderIds.length) {
    throw new ApiError(
      409,
      "This checkout was not stored completely. Please use a new checkout id.",
      { code: "CHECKOUT_INCOMPLETE" },
    );
  }

  return {
    checkoutGroupId: group.checkoutGroupId,
    orders: await serializeOrders(ordered),
    summary: summaryFromGroup(group),
    replayed: true,
  };
}

/**
 * Price the cart from the database and return a short-lived signed token. The
 * browser's displayed prices are only used to detect a stale quote; they are
 * never copied into the token or a later order.
 */
export async function quoteCart(
  customer: AppUser,
  input: QuoteCartInput,
): Promise<CartQuoteResult> {
  requireCustomer(customer);
  ensureUniqueItems(input.items, "A quote");

  const objectIds = input.items.map((item) => toObjectId(item.itemId));
  const documents = await MenuItemModel.find({
    _id: { $in: objectIds.filter((id): id is ObjectId => Boolean(id)) },
  });
  const byId = new Map(
    documents.map((document) => [document._id.toString(), document]),
  );

  const issues: CartQuoteIssue[] = [];
  const lines: CartQuoteLine[] = [];
  const tokenItems: QuoteTokenItem[] = [];

  for (const [index, item] of input.items.entries()) {
    const objectId = objectIds[index];
    const document = objectId ? byId.get(objectId.toString()) : undefined;
    const canonicalId = objectId?.toString() ?? item.itemId;

    if (!document) {
      issues.push({
        itemId: item.itemId,
        code: "MISSING",
        message: "This menu item is no longer available. Remove it from your cart.",
      });
      lines.push({
        itemId: item.itemId,
        itemName: null,
        quantity: item.quantity,
        unitPrice: 0,
        lineTotal: 0,
      });
      continue;
    }

    const ownItem = document.vendorId.toString() === customer.id;
    const publicItem = isMenuItemPublic(document.status, document.isAvailable);
    const purchasable = publicItem && !ownItem;

    if (ownItem) {
      issues.push({
        itemId: item.itemId,
        code: "OWN_ITEM",
        message: "You cannot order this item. Remove it from your cart.",
      });
    } else if (!publicItem) {
      // Never leak the name or price of an unpublished/offline menu item.
      issues.push({
        itemId: item.itemId,
        code: "UNAVAILABLE",
        message: "This item is no longer available. Remove it from your cart.",
      });
    }

    let acknowledgedPrice = false;
    if (purchasable) {
      if (
        item.expectedUnitPrice !== undefined &&
        !sameMoney(item.expectedUnitPrice, document.price)
      ) {
        // A changed price is only considered acknowledged when the client
        // echoes back the authoritative database price. Any other value keeps
        // the checkout blocked and the quote unsigned.
        acknowledgedPrice =
          item.acknowledgedUnitPrice !== undefined &&
          sameMoney(item.acknowledgedUnitPrice, document.price);
        if (!acknowledgedPrice) {
          issues.push({
            itemId: item.itemId,
            code: "PRICE_CHANGED",
            message: `The price of ${document.itemName} changed. Review the new total before checking out.`,
            expectedUnitPrice: roundMoney(item.expectedUnitPrice),
            currentUnitPrice: roundMoney(document.price),
          });
        }
      }
    }

    // Unavailable and own items contribute no metadata and no money to the
    // quote. The client can identify the line by itemId and must refresh it.
    const unitPrice = purchasable ? roundMoney(document.price) : 0;
    lines.push({
      itemId: item.itemId,
      itemName: purchasable ? document.itemName : null,
      quantity: item.quantity,
      unitPrice,
      lineTotal: roundMoney(unitPrice * item.quantity),
    });
    if (purchasable) {
      tokenItems.push({
        itemId: canonicalId,
        quantity: item.quantity,
        unitPrice,
        ...(item.expectedUnitPrice !== undefined
          ? { expectedUnitPrice: roundMoney(item.expectedUnitPrice) }
          : {}),
        acknowledgedPrice,
      });
    }
  }

  const canCheckout = issues.length === 0;
  const quoteToken = canCheckout
    ? await signQuoteToken(customer.id, tokenItems)
    : null;
  // Money is always derived from the database prices in the quote lines, even
  // when a stale browser price caused an issue, so the review screen can show
  // the authoritative total before the user accepts it.
  const subtotal = roundMoney(
    lines.reduce((sum, line) => sum + line.lineTotal, 0),
  );

  return {
    canCheckout,
    issues,
    lines,
    items: lines,
    subtotal,
    total: subtotal,
    quoteToken,
    quoteExpiresAt: canCheckout
      ? new Date(Date.now() + QUOTE_TOKEN_TTL_MS).toISOString()
      : null,
  };
}

/**
 * Commit the group document and every order line in one transaction. A replay
 * of an identical request returns the original checkout without writing again.
 */
export async function checkoutCart(
  customer: AppUser,
  input: CheckoutCartInput,
): Promise<CheckoutResult> {
  requireCustomer(customer);
  ensureUniqueItems(input.items, "A checkout");

  const lines: RequestedLine[] = input.items.map((item) => {
    const objectId = toObjectId(item.itemId);
    if (!objectId) {
      throw ApiError.badRequest("Menu item id is not valid.");
    }
    return { itemId: objectId.toString(), objectId, quantity: item.quantity };
  });

  const deliveryDate = normalizeDeliveryDate(input.deliveryDate);

  // Replay is resolved first: an identical retry must return the original
  // checkout even if the delivery date has since passed or its token expired.
  // A reused id with different data is still a group conflict.
  const existing = await CheckoutGroupModel.findOne({
    customerId: new Types.ObjectId(customer.id),
    checkoutGroupId: input.checkoutGroupId,
  });
  if (existing) {
    return replayCheckout(customer, input, deliveryDate, lines);
  }

  // Only a brand-new checkout is rejected for a past delivery date.
  if (deliveryDate.getTime() < startOfTodayUtc().getTime()) {
    throw ApiError.unprocessable("Delivery date cannot be in the past.");
  }

  const quote = await verifyQuoteToken(input.quoteToken, customer.id);
  const quotedItems = sortedSignatureItems(quote.items);
  const requestedItems = sortedSignatureItems(lines);
  if (JSON.stringify(quotedItems) !== JSON.stringify(requestedItems)) {
    throw staleQuote(
      "Your cart changed after the price quote. Review it and try again.",
    );
  }

  const documents = await MenuItemModel.find({
    _id: { $in: lines.map((line) => line.objectId) },
  });
  const byId = new Map(
    documents.map((document) => [document._id.toString(), document]),
  );
  const tokenByItem = new Map(quote.items.map((item) => [item.itemId, item]));

  const prepared: PreparedLine[] = lines.map((line) => {
    const document = byId.get(line.itemId);
    if (!document) {
      throw staleQuote(
        "A menu item in your quote no longer exists. Review your cart and try again.",
        "ITEM_MISSING",
      );
    }
    if (document.vendorId.toString() === customer.id) {
      throw ApiError.forbidden("You cannot order your own menu items.");
    }
    if (!isMenuItemPublic(document.status, document.isAvailable)) {
      throw staleQuote(
        "An item in your cart is no longer available. Review your cart and try again.",
        "ITEM_UNAVAILABLE",
      );
    }

    const quoted = tokenByItem.get(line.itemId);
    if (quoted === undefined) {
      throw staleQuote("Your price quote is incomplete. Review it and try again.");
    }

    // Authoritative database prices win over the signed quote. A price change
    // after quoting requires a fresh quote and a fresh acknowledgement.
    const unitPrice = roundMoney(document.price);
    if (!sameMoney(quoted.unitPrice, unitPrice)) {
      throw staleQuote(
        "A price in your quote has changed. Review your cart and try again.",
        "PRICE_CHANGED",
      );
    }
    if (
      quoted.expectedUnitPrice !== undefined &&
      !sameMoney(quoted.expectedUnitPrice, unitPrice) &&
      quoted.acknowledgedPrice !== true
    ) {
      throw staleQuote(
        "Review the new price before checking out.",
        "PRICE_CHANGED",
      );
    }

    return { ...line, menu: document, unitPrice };
  });

  const hash = requestHash(customer, input, deliveryDate, lines);
  const orderIds = prepared.map(() => new Types.ObjectId());
  const itemCount = prepared.length;
  const totalQuantity = prepared.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = roundMoney(
    prepared.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
  );
  const total = subtotal;
  const message = input.message?.trim() || null;

  const group: CheckoutGroupDocument = {
    customerId: new Types.ObjectId(customer.id),
    checkoutGroupId: input.checkoutGroupId,
    requestHash: hash,
    items: prepared.map((line) => ({
      itemId: new Types.ObjectId(line.objectId.toString()),
      quantity: line.quantity,
    })),
    orderIds,
    deliveryDate,
    deliveryAddress: input.deliveryAddress,
    message,
    itemCount,
    totalQuantity,
    subtotal,
    total,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const orderDocs: OrderDocument[] = prepared.map((line, index) => {
    const entry: OrderStatusEntry = {
      status: "pending",
      changedBy: new Types.ObjectId(customer.id),
      changedByRole: "customer",
      changedAt: new Date(),
      note: "Order placed",
    };
    return {
      _id: orderIds[index],
      itemId: new Types.ObjectId(line.itemId),
      vendorId: new Types.ObjectId(line.menu.vendorId.toString()),
      customerId: new Types.ObjectId(customer.id),
      itemName: line.menu.itemName,
      itemImage: line.menu.images?.[0] ?? null,
      itemPrice: line.unitPrice,
      quantity: line.quantity,
      checkoutGroupId: input.checkoutGroupId,
      deliveryDate,
      deliveryAddress: input.deliveryAddress,
      message,
      status: "pending",
      activeOrderKey: activeOrderKey(customer.id, line.itemId, deliveryDate),
      statusHistory: [entry],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(
      async () => {
        // Group first: its unique (customerId, checkoutGroupId) key is the
        // group-level lock. The partial order key still guards active slots.
        await CheckoutGroupModel.insertMany([group], { session, ordered: true });
        await OrderModel.insertMany(orderDocs, { session, ordered: true });
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      },
    );
  } catch (error) {
    if (isGroupDuplicateError(error)) {
      return replayCheckout(customer, input, deliveryDate, lines);
    }
    if (isActiveOrderDuplicateError(error)) {
      throw new ApiError(
        409,
        "You already have an active order for one of these items on that delivery date.",
        { code: "ACTIVE_ORDER_EXISTS" },
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }

  const orders = await OrderModel.find({
    _id: { $in: orderIds },
    customerId: new Types.ObjectId(customer.id),
    checkoutGroupId: input.checkoutGroupId,
  });
  const byOrderId = new Map(
    orders.map((order) => [order._id.toString(), order]),
  );
  const ordered = orderIds
    .map((id) => byOrderId.get(id.toString()))
    .filter((order): order is (typeof orders)[number] => Boolean(order));

  if (ordered.length !== orderIds.length) {
    throw new ApiError(
      409,
      "Checkout committed but some orders could not be read back. Retry with the same checkout id.",
      { code: "CHECKOUT_INCOMPLETE" },
    );
  }

  return {
    checkoutGroupId: input.checkoutGroupId,
    orders: await serializeOrders(ordered),
    summary: {
      itemCount,
      totalQuantity,
      subtotal,
      total,
      deliveryDate: deliveryDate.toISOString().slice(0, 10),
      deliveryAddress: input.deliveryAddress,
      message,
    },
    replayed: false,
  };
}
