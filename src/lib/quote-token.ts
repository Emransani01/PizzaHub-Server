import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/environment.js";
import { ApiError } from "./api-error.js";

/** A displayed quote is valid for ten minutes. */
export const QUOTE_TOKEN_TTL_MS = 10 * 60 * 1000;

const ISSUER = "pizzahub-api";
const AUDIENCE = "pizzahub-cart-quote";
const TOKEN_TYPE = "cart-quote";
const ALGORITHM = "HS256";

const secret = () => new TextEncoder().encode(env.jwtSecret);

function staleQuote(message: string, code = "QUOTE_INVALID"): ApiError {
  return new ApiError(409, message, {
    code,
    details: { requiresFreshQuote: true },
  });
}

export interface QuoteTokenItem {
  itemId: string;
  quantity: number;
  unitPrice: number;
  /** Price the customer's cart displayed when the quote was requested. */
  expectedUnitPrice?: number;
  /**
   * True only when the customer explicitly accepted a server-verified price
   * change. It is signed into the token so checkout cannot silently skip the
   * acknowledgement step.
   */
  acknowledgedPrice?: boolean;
}

export interface QuoteTokenPayload {
  customerId: string;
  items: QuoteTokenItem[];
}

export async function signQuoteToken(
  customerId: string,
  items: QuoteTokenItem[],
  options: { expiresIn?: string | number } = {},
): Promise<string> {
  return new SignJWT({
    tokenType: TOKEN_TYPE,
    items,
  })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .setSubject(customerId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "10m")
    .sign(secret());
}

export async function verifyQuoteToken(
  token: string,
  customerId: string,
): Promise<QuoteTokenPayload> {
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, secret(), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_JWT_EXPIRED") {
      throw staleQuote(
        "Your price quote has expired. Review the current prices and try again.",
        "QUOTE_EXPIRED",
      );
    }
    throw staleQuote(
      "This price quote is invalid. Review the current prices and try again.",
    );
  }

  if (
    payload.tokenType !== TOKEN_TYPE ||
    typeof payload.sub !== "string" ||
    payload.sub !== customerId ||
    !Array.isArray(payload.items)
  ) {
    throw staleQuote(
      "This price quote is invalid. Review the current prices and try again.",
    );
  }

  const items: QuoteTokenItem[] = payload.items.map((value) => {
    const candidate = value as Partial<QuoteTokenItem>;
    if (
      typeof candidate.itemId !== "string" ||
      candidate.itemId.trim().length === 0 ||
      !Number.isInteger(candidate.quantity) ||
      (candidate.quantity ?? 0) < 1 ||
      (candidate.quantity ?? 0) > 20 ||
      typeof candidate.unitPrice !== "number" ||
      !Number.isFinite(candidate.unitPrice) ||
      candidate.unitPrice < 0
    ) {
      throw staleQuote(
        "This price quote is invalid. Review the current prices and try again.",
      );
    }
    if (
      candidate.expectedUnitPrice !== undefined &&
      (typeof candidate.expectedUnitPrice !== "number" ||
        !Number.isFinite(candidate.expectedUnitPrice) ||
        candidate.expectedUnitPrice < 0)
    ) {
      throw staleQuote(
        "This price quote is invalid. Review the current prices and try again.",
      );
    }
    if (
      candidate.acknowledgedPrice !== undefined &&
      typeof candidate.acknowledgedPrice !== "boolean"
    ) {
      throw staleQuote(
        "This price quote is invalid. Review the current prices and try again.",
      );
    }

    return {
      itemId: candidate.itemId,
      quantity: candidate.quantity as number,
      unitPrice: candidate.unitPrice,
      ...(candidate.expectedUnitPrice !== undefined
        ? { expectedUnitPrice: candidate.expectedUnitPrice }
        : {}),
      ...(candidate.acknowledgedPrice !== undefined
        ? { acknowledgedPrice: candidate.acknowledgedPrice }
        : {}),
    };
  });

  if (items.length === 0 || items.length > 20) {
    throw staleQuote(
      "This price quote is invalid. Review the current prices and try again.",
    );
  }

  return { customerId, items };
}
