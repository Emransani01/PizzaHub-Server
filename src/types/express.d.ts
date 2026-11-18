import type { AppUser } from "./index.js";

declare global {
  namespace Express {
    interface Request {
      user?: AppUser;
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
