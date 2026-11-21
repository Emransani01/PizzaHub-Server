# PizzaHub API

Express 5 + TypeScript + MongoDB API for PizzaHub, a multi-vendor pizza ordering
platform. It handles authentication (Better Auth + short-lived JWTs), role-based
access control, vendor menu item approval, customer orders with a status
timeline, customer favourites, Stripe Vendor Premium subscriptions and ImgBB
image uploads.

Customer orders never touch Stripe. Stripe is used **only** for the optional
Vendor Premium subscription.

## Links

- Live client website URL: <https://pizza-hub-client.vercel.app>
- Live API deployment: <https://pizza-hub-server.vercel.app>
- Client GitHub repository URL: <https://github.com/Emransani01/PizzaHub-Client>
- Server GitHub repository URL: <https://github.com/Emransani01/PizzaHub-Server>

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 22.12.x, 24.x, or 26.x, ESM (`"type": "module"`) |
| HTTP | Express 5 |
| Language | TypeScript |
| Database | MongoDB replica set/sharded cluster (Atlas in deployment, `MongoMemoryReplSet` in tests) |
| ODM | Mongoose (business data) + Better Auth MongoDB adapter (auth data) |
| Auth | Better Auth (email/password + optional Google OAuth) |
| Tokens | HS256 JWT via `jose`, 15 minutes, stored only in client memory |
| Payments | Stripe Checkout + signature-verified webhook (Vendor Premium only) |
| Uploads | ImgBB REST API (multer in-memory buffer) |
| Validation | Zod |
| Tests | Vitest + Supertest + `mongodb-memory-server` |

## Requirements

- Node.js 22.12.x, 24.x, or 26.x
- npm 10 or newer
- A MongoDB replica set or sharded cluster for local development (Atlas M0+ works; a standalone `mongod` cannot provide the transactions required by cart checkout)
- On Windows, the Microsoft Visual C++ Redistributable (x64) is required by the
  MongoDB binary that `mongodb-memory-server` downloads for the test suite.
  Install it from <https://aka.ms/vs/17/release/vc_redist.x64.exe> if
  `npm test` reports a missing `VCRUNTIME140.dll` / `MSVCP140.dll`.

## Setup

```bash
cd server
npm install
cp .env.example .env        # Windows: copy .env.example .env
# edit .env and fill in the values described below
npm run dev                 # http://localhost:5000
```

Health check: `GET http://localhost:5000/health`.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | no | `development`, `production` or `test`. Defaults to `development`. |
| `PORT` | no | API port. Defaults to `5000`. |
| `MONGODB_URI` | **yes** | Atlas connection string **including the database name**, e.g. `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/pizzahub?retryWrites=true&w=majority`. |
| `CLIENT_URL` | no | Frontend origin used for CORS. Defaults to `http://localhost:3000`. |
| `BETTER_AUTH_URL` | no | Public origin of the auth API. Defaults to `CLIENT_URL`. |
| `BETTER_AUTH_SECRET` | **yes** | Better Auth signing secret. |
| `JWT_SECRET` | **yes** | Separate secret for API access tokens. |
| `JWT_EXPIRES_IN` | no | Access-token lifetime. Defaults to `15m`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Enable Google sign-in. Hidden in the UI when empty. Redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google`. |
| `STRIPE_SECRET_KEY` | no | Enables Stripe Checkout for Vendor Premium. |
| `STRIPE_PREMIUM_PRICE_ID` | no | Recurring monthly price ID for Vendor Premium. Also required for checkout. |
| `STRIPE_WEBHOOK_SECRET` | no | Verifies `stripe-signature` on the webhook. Required for Premium to activate. |
| `IMGBB_API_KEY` | no | Enables image uploads. Upload endpoints answer `503` when empty. |
| `ADMIN_NAME` | no | Display name for the seeded administrator. |
| `ADMIN_EMAIL` | no | Email for `npm run seed:admin`. |
| `ADMIN_PASSWORD` | no | Leave empty to let the seed script generate and print a strong password once. |

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Use different values for `BETTER_AUTH_SECRET` and `JWT_SECRET`. Never commit
`.env`; only `.env.example` is tracked.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the API with `tsx watch` on port 5000. |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm start` | Run the compiled server (`dist/server.js`). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Vitest integration suite (starts an in-memory MongoDB). |
| `npm run seed:admin` | Create (or promote) the administrator account. |
| `npm run seed:demo` | Insert demo vendors, customers, menu items and orders. |

### Seed scripts

`npm run seed:admin` reads `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
If `ADMIN_PASSWORD` is empty it generates a random password and prints it **once**.
Administrators can only be created this way; public sign-up can never produce an
admin role.

`npm run seed:demo` is for local development only and prints its credentials:

| Account | Email | Password | Notes |
| --- | --- | --- | --- |
| Free vendor | `vendor@pizzahub.demo` | `Demo1234` | Exactly 3 approved + available items |
| Premium vendor | `premium@pizzahub.demo` | `Demo1234` | Unlimited listings |
| Customer | `customer@pizzahub.demo` | `Demo1234` | Has favourites and orders |

## Authentication and authorization

### JWT verification middleware flow

1. **Session establishment (Better Auth):** the separately deployed Next.js client proxies same-origin `/api/*` requests to this deployed API through the rewrite configured from `API_URL` (see `client/next.config.ts`). The browser only talks to the client origin, so the Better Auth session cookie stays first-party. This server owns the Better Auth routes and MongoDB session data. `POST /api/auth/sign-up/email` and `POST /api/auth/sign-in/email` are handled here. Public sign-up never creates an admin; new accounts start with `roleOnboarded: false`.
2. **Access token issuance:** `GET /api/auth/token` reads the HttpOnly Better Auth session cookie, resolves the current account from MongoDB, rejects blocked accounts, and returns a short-lived HS256 JWT (default 15 minutes, signed with `JWT_SECRET`, issuer `pizzahub-api`, audience `pizzahub-client`) plus the current profile. The client stores the token **in memory only**.
3. **Client request:** protected API calls send `Authorization: Bearer <token>`. On `401` the client refreshes via `/api/auth/token` once (using the session cookie) and retries.
4. **`authenticate` middleware (`src/middleware/authenticate.ts`):** extracts the bearer token, verifies JWT signature/issuer/audience/expiration via `jose`, reads `sub` (user id) and `role` claims, then **reloads the user from MongoDB** (`findUserById`) so role/block/subscription state is always current. Missing/invalid/expired token or unknown user → `401 Unauthorized`.
5. **`checkBlockedUser` middleware:** rejects blocked accounts from protected operations with `403 Forbidden`.
6. **`authorizeRole(...)` middleware:** enforces role membership (customer/vendor/admin) for the route → `403` when the authenticated role is not allowed.
7. **Ownership/state checks in services:** controllers/services independently verify resource ownership (e.g. vendor owns menu item/order, customer owns order/favorites), allowed state transitions, duplicate/conflict rules, and validated input. Client-supplied user IDs/roles are never trusted for authorization decisions.

Authorization outcomes enforced on the server (never trusted from the client):

- Unknown/invalid/expired token → `401`.
- Authenticated but wrong role, wrong owner, blocked account or disallowed
  state transition → `403`.
- Invalid input → `400`. Missing resources → `404`. Duplicate conflicts → `409`.
- Missing optional integration (Stripe, ImgBB) → `503`.

There is no route that lets a client set `role: "admin"`. `POST /api/users/me/role`
accepts only `customer` or `vendor`, and only once (`roleOnboarded` must be
`false`).

### Roles

| Role | Capabilities |
| --- | --- |
| `customer` | Browse the public menu, place orders, cancel pending orders, manage favourites, view own orders. |
| `vendor` | Create/edit/delete own menu items, toggle availability, accept or reject incoming orders, view own transactions, subscribe to Premium. |
| `admin` | Approve/reject/deactivate and reactivate menu items, block/unblock customers and vendors, read all transactions (read-only). |

## Free vs Premium vendors

- Free vendors may have at most **3** menu items that are simultaneously
  `approved` **and** `isAvailable`. Pending, rejected and inactive items do not
  count.
- The limit is enforced on the server when an admin approves an item and when a
  paused approved item is re-enabled; new items start as `pending`, so creation
  cannot bypass it. It is not enforced in the UI.
- Vendor Premium removes the limit. Premium is activated **only** by the
  Stripe webhook after signature verification; a frontend redirect to
  `/payment-success` never grants it.
- Menu-item statuses are `pending`, `approved`, `rejected` and `inactive`.
  Availability changes on approved items move them between `approved` and
  `inactive`; admins can also set `inactive` explicitly. Existing documents that
  store `approved + isAvailable:false` are reported as `inactive` by the API, so
  no database migration is required. The admin `status=approved` filter returns
  only currently active items; legacy paused documents appear under
  `status=inactive`.
- When the **owning vendor** edits the content of an approved or inactive item
  (name, category, description, price, location, images), its status resets to
  `pending` for re-approval. Admin content edits keep the current status.
  Availability-only edits do not require re-approval after the item is restored.
- Only `approved` and available items are public or orderable; rejected and
  inactive items are hidden.
- Items with existing orders cannot be deleted (`409`); mark them inactive
  instead.

## API overview

All endpoints are prefixed with `/api`. JSON in, JSON out.

### Auth (`/api/auth/*`, Better Auth)

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/auth/sign-up/email` | public |
| `POST` | `/auth/sign-in/email` | public |
| `POST` | `/auth/sign-out` | session |
| `GET` | `/auth/get-session` | session |
| `GET` | `/auth/callback/google` | public (when Google is configured) |
| `GET` | `/auth/token` | session cookie → JWT |

### Users

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/users/me` | any authenticated user |
| `PATCH` | `/users/me` | any authenticated user (`name`, `image`; vendors may also set `businessName`) |
| `POST` | `/users/me/role` | any authenticated user, once (`customer` or `vendor`) |
| `GET` | `/users?search=&role=&page=&limit=` | admin |
| `PATCH` | `/users/:id/block` | admin (`{ "blocked": true \| false }`) |

### Menu items

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/menu-items?search=&category=&location=&sort=&page=&limit=` | public |
| `GET` | `/menu-items/featured` | public (premium vendors first) |
| `GET` | `/menu-items/categories` | public (the six categories + counts) |
| `GET` | `/menu-items/locations` | public |
| `GET` | `/menu-items/:id` | public; owners and admins can also read unapproved items |
| `GET` | `/menu-items/mine` | vendor |
| `POST` | `/menu-items` | vendor (created as `pending`) |
| `PATCH` | `/menu-items/:id` | owning vendor, or admin |
| `DELETE` | `/menu-items/:id` | owning vendor, or admin (blocked when orders exist) |
| `GET` | `/menu-items/admin?status=&vendorId=&search=&category=&location=&page=&limit=` | admin |
| `PATCH` | `/menu-items/:id/status` | admin (`{ "status": "approved" \| "rejected" \| "pending" \| "inactive", "reason": "..." }`) |

`sort` is one of `newest`, `price_asc`, `price_desc`. `limit` is capped at 48
for public and admin menu lists; user/order/transaction lists cap it at 50.

The six fixed categories are: `Classic Pizzas`, `Vegetarian Pizzas`,
`Meat Lovers`, `Specialty / Gourmet Pizzas`, `Sides & Appetizers`,
`Beverages & Desserts`.

### Advanced search and sorting implementation

The public menu endpoint (`GET /api/menu-items`) performs server-side search and
filtering against MongoDB:

- **Text/advanced search (`search`):** case-insensitive regex matching over
  `itemName` and `description`, so a single query can find dishes by name or
  description/ingredients.
- **Filters:** exact `category` (one of the six fixed categories) and
  case-insensitive exact `location` match. These are separate from `search`.
- **Sorting:** `sort=price_asc`, `sort=price_desc`, or `sort=newest` (default,
  newest first).
- **Visibility rule:** only `approved` and `isAvailable` items are returned in
  public listings or accepted by the order endpoint. `rejected` and `inactive`
  items (including legacy `approved + isAvailable:false` documents) are hidden.
  Vendors/admins access non-public items through protected owner/admin endpoints.
- **Admin status filter:** `status` accepts `pending`, `approved`, `rejected` or
  `inactive`; the `inactive` filter matches both stored `inactive` rows and the
  legacy unavailable shape.
- **Pagination:** `page` and `limit` (public cap 48) with `total`, `page`,
  `limit`, and `totalPages` in the response. The client combines these controls
  (search box, category/location filters, sort, pagination) for the Browse Menu
  experience with loading/empty/error states.

### Orders

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/orders` | customer (`itemId`, `deliveryDate` `YYYY-MM-DD`, `deliveryAddress` ≥ 10 chars, optional `message`) |
| `GET` | `/orders?status=&page=&limit=` | customers see their own orders, vendors see orders for their items, admins see all |
| `GET` | `/orders/:id` | order owner, the item's vendor, or admin |
| `PATCH` | `/orders/:id/status` | vendor: `accepted`/`rejected`; customer: `cancelled` while `pending` |
| `POST` | `/orders/quote` | customer (`items: [{ itemId, quantity, expectedUnitPrice? }]`) |
| `POST` | `/orders/checkout` | customer (stable `checkoutGroupId`, `items`, `quoteToken`, delivery fields) |

Every transition appends `{ status, changedBy, changedByRole, changedAt, note }`
to `statusHistory`, which powers the customer status timeline. `POST /orders`
remains the backward-compatible single-item endpoint and always creates one
`pending` order with `quantity: 1` and `checkoutGroupId: null`.

#### Cart quote and checkout

The client persists the cart locally; the API never trusts client-side prices.

1. `POST /orders/quote` loads current menu prices and returns `lines`,
   `canCheckout`, `issues`, authoritative `subtotal`/`total`, `quoteToken` and
   `quoteExpiresAt`. `issues` uses the
   codes `MISSING`, `UNAVAILABLE`, `OWN_ITEM` and `PRICE_CHANGED`. When any
   issue exists, `canCheckout` is `false` and no token is issued. The optional
   `expectedUnitPrice` is only the price displayed in the browser; it exists so
   a price change must be explicitly reviewed and re-quoted. To clear a
   `PRICE_CHANGED` issue, the client re-quotes with `acknowledgedUnitPrice` set
   to the authoritative `currentUnitPrice`. The server accepts only an exact
   match, signs that acknowledgement into the token, and re-checks database
   prices at checkout.
2. A successful quote returns an HS256 token signed with `JWT_SECRET`, scoped to
   the customer and the exact item ids/quantities/prices, valid for **10
   minutes**. Checkout verifies this token and ignores any client-supplied
   price. Tampered, expired or mismatched carts receive `409` with a
   `QUOTE_INVALID`/`QUOTE_EXPIRED` code and `details.requiresFreshQuote: true`.
3. `POST /orders/checkout` writes one `checkout_groups` document and one order
   per cart line inside a single MongoDB transaction. The group stores the
   canonical request hash, order ids, quantities and money snapshot. Order
   documents add `quantity`, `lineTotal` and `checkoutGroupId` while preserving
   the existing `activeOrderKey = customer:item:date` partial unique index.
   There is no delivery fee or tax, so `total === subtotal`.
4. Retrying the same `checkoutGroupId` and identical request returns `200` with
   `replayed: true` and the original orders. Reusing the id with different
   request data returns `409 CHECKOUT_GROUP_CONFLICT`. Overlapping active items
   from different groups return `409 ACTIVE_ORDER_EXISTS`.
5. Any write failure aborts the whole transaction: no partial order lines and
   no orphan group are left behind. Startup verifies replica-set/transaction
   support and fails fast instead of falling back to a non-atomic path.

Customer checkout never uses Stripe and never touches Premium subscriptions.

### Favourites

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/favorites` | customer |
| `POST` | `/favorites/:itemId` | customer |
| `DELETE` | `/favorites/:itemId` | customer |

Favourites are stored on the user document, so they follow the account across
devices.

### Subscriptions and transactions

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/subscriptions/status` | vendor |
| `POST` | `/subscriptions/checkout` | vendor (returns `{ url, sessionId }`) |
| `GET` | `/subscriptions/checkout/:sessionId` | vendor (transaction status only) |
| `POST` | `/subscriptions/webhook` | Stripe (raw body + `stripe-signature`) |
| `GET` | `/transactions/me?status=&page=&limit=` | vendor |
| `GET` | `/transactions?status=&page=&limit=` | admin |

Transaction endpoints are read-only: there is intentionally no create, update or
delete route, so administrators cannot fabricate or edit payment records. Rows
are written only by the verified webhook handler (idempotent per
`stripeSessionId`).

### Uploads and public config

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/uploads/menu-image` | vendor (multipart field `image`, max 4 MB, png/jpeg/webp) |
| `POST` | `/uploads/profile-image` | any authenticated user |
| `GET` | `/config/public` | public feature flags and the six categories |

`GET /config/public` exposes booleans only (`googleEnabled`, `stripeEnabled`,
`imgbbEnabled`, `freePlanActiveItemLimit`), never secret material.

### Dashboard

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/dashboard/overview` | any authenticated user; shape depends on role |

Returns `{ role, stats, series, recentOrders }`.

## Stripe setup

1. Create a **recurring monthly** product/price in the Stripe dashboard and copy
   the price ID into `STRIPE_PREMIUM_PRICE_ID`.
2. Put the secret key in `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint pointing at
   `<API_URL>/api/subscriptions/webhook` and subscribe at minimum to:
   - `checkout.session.completed` (activates Premium only after verification; idempotent)
   - `checkout.session.async_payment_succeeded` (activates Premium after async payment succeeds; idempotent)
   - `checkout.session.expired` (marks pending checkout transaction `expired`, never grants Premium)
   - `checkout.session.async_payment_failed` (marks pending checkout transaction `failed`, never grants Premium)
   - `invoice.paid` (keeps subscription period/current state in sync)
   - `invoice.payment_failed` (marks related pending subscription transactions failed)
   - `customer.subscription.updated` (syncs active/expired plan state)
   - `customer.subscription.deleted` (downgrades/cancels Premium)
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` and restart the API.
5. Locally, forward events with the Stripe CLI:

   ```bash
   stripe listen --forward-to localhost:5000/api/subscriptions/webhook
   ```

### Stripe test instructions

- Use Stripe **test mode** keys/prices only. A common test card is
  `4242 4242 4242 4242` with any future expiry, any CVC, and any postal code
  (see Stripe docs for additional scenarios such as 3DS/declines).
- Start checkout from the vendor dashboard subscription page; confirm you are
  redirected to Stripe and back to `<CLIENT_ORIGIN>/payment-success` (or cancel).
- Verify with the Stripe CLI/dashboard that webhook events reach
  `<API_URL>/api/subscriptions/webhook` and that the transaction record is
  created/updated only by verified events (frontend redirect never grants Premium).
- To test expiry/failure handling, let a Checkout Session expire or trigger an
  async payment failure in test mode and confirm the corresponding transaction
  becomes `expired`/`failed` while the vendor remains non-premium.

The webhook route is mounted **before** `express.json()` and uses the raw
request body, because Stripe signatures are computed over the unparsed payload.
Premium is granted only when the signature verifies and the session is real. Customer
pizza orders never use Stripe.

## ImgBB setup

Create a key at <https://api.imgbb.com/> and set `IMGBB_API_KEY`. Uploads are sent
from the server only; the key never reaches the browser. The UI hides upload
controls and explains why when the integration is not configured.

## Deployment notes

- The current API deployment is on Vercel at
  <https://pizza-hub-server.vercel.app>; health and public API routes are live.
  A Render blueprint is also included as `render.yaml` as an alternative. Point
  Render at this repository, then fill in the variables it prompts for (all
  secrets are marked `sync: false`, so no real value is stored in git).
- Set `NODE_ENV=production` and every required variable in the hosting dashboard.
- Use a dedicated Atlas database user with the minimum privileges needed.
- Whitelist the hosting provider's egress IPs in Atlas (or use a VPC peering).
- Configure `CLIENT_URL` and `BETTER_AUTH_URL` with the deployed frontend origin
  so CORS and OAuth redirects match exactly.
- Run `npm run build` then `npm start`. Serve behind HTTPS so the Secure,
  SameSite session cookie is accepted.
- Run `npm run seed:admin` once against the production database.

## Tests

```bash
npm test
```

The suite boots a single-node `MongoMemoryReplSet` with WiredTiger, so it can
exercise the checkout transaction without an Atlas connection or real data. It
covers menu limits and approval, order state transitions and ownership,
role/authorization rules, quote freshness, checkout atomicity, idempotent
replay, group conflicts and subscription checkout/webhook handling.

## Project layout

```
server/
  src/
    config/          environment parsing
    integrations/    Stripe and ImgBB clients
    lib/             auth, jwt, quote tokens, transactions, money helpers
    middleware/      authenticate, authorize-role, blocked-user, validation, uploads
    modules/         auth, users, menu-items, orders, favorites,
                     subscriptions, transactions, dashboard, uploads, config
    scripts/         seed-admin, seed-demo
    app.ts           Express app and route mounting
    server.ts        process bootstrap
  tests/             Vitest + Supertest suites and helpers
```
