# PizzaHub API

Express 5 + TypeScript + MongoDB API for PizzaHub, a multi-vendor pizza ordering
platform. It handles authentication (Better Auth + short-lived JWTs), role-based
access control, vendor menu item approval, customer orders with a status
timeline, customer favourites, Stripe Vendor Premium subscriptions and ImgBB
image uploads.

Customer orders never touch Stripe. Stripe is used **only** for the optional
Vendor Premium subscription.

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 20+, ESM (`"type": "module"`) |
| HTTP | Express 5 |
| Language | TypeScript |
| Database | MongoDB (Atlas in deployment, `mongodb-memory-server` in tests) |
| ODM | Mongoose (business data) + Better Auth MongoDB adapter (auth data) |
| Auth | Better Auth (email/password + optional Google OAuth) |
| Tokens | HS256 JWT via `jose`, 15 minutes, stored only in client memory |
| Payments | Stripe Checkout + signature-verified webhook (Vendor Premium only) |
| Uploads | ImgBB REST API (multer in-memory buffer) |
| Validation | Zod |
| Tests | Vitest + Supertest + `mongodb-memory-server` |

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- A MongoDB Atlas cluster (or any MongoDB 6+ instance) for local development
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

Health check: `GET http://localhost:5000/api/health`.

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

1. The browser talks to the Next.js app on the same origin; Next rewrites
   `/api/*` to this server, so the Better Auth session cookie is first-party.
2. `POST /api/auth/sign-up/email` and `POST /api/auth/sign-in/email` are handled
   by Better Auth. The account always starts as `customer` with
   `roleOnboarded: false`.
3. `GET /api/auth/token` reads the HttpOnly session cookie and returns a
   short-lived HS256 JWT plus the current profile. The browser keeps the token
   in memory only and refreshes it when an API call answers `401`.
4. Protected routes verify the JWT signature, issuer and audience, reload the
   user from MongoDB, reject blocked accounts and only then apply role checks.

Authorization rules enforced on the server (never trusted from the client):

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
| `admin` | Approve/reject menu items, block/unblock customers and vendors, read all transactions (read-only). |

## Free vs Premium vendors

- Free vendors may have at most **3** menu items that are simultaneously
  `approved` **and** `isAvailable`. Pending and rejected items do not count.
- The limit is enforced inside the create/update/approval transaction, not in
  the UI.
- Vendor Premium removes the limit. Premium is activated **only** by the
  Stripe webhook after signature verification; a frontend redirect to
  `/payment-success` never grants it.
- Editing the content of an approved item (name, category, description, price,
  location, images) resets its status to `pending` for re-approval.
  Availability-only edits keep the approval.
- Items with existing orders cannot be deleted (`409`); mark them unavailable
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
| `GET` | `/menu-items/admin?status=&vendorId=&search=&category=&page=&limit=` | admin |
| `PATCH` | `/menu-items/:id/status` | admin (`{ "status": "approved" \| "rejected" \| "pending", "reason": "..." }`) |

`sort` is one of `newest`, `price_asc`, `price_desc`. `limit` is capped at 48
for the public list and 50 for admin/user lists.

The six fixed categories are: `Classic Pizzas`, `Vegetarian Pizzas`,
`Meat Lovers`, `Specialty / Gourmet Pizzas`, `Sides & Appetizers`,
`Beverages & Desserts`.

### Orders

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/orders` | customer (`itemId`, `deliveryDate` `YYYY-MM-DD`, `deliveryAddress` ≥ 10 chars, optional `message`) |
| `GET` | `/orders?status=&page=&limit=` | customers see their own orders, vendors see orders for their items, admins see all |
| `GET` | `/orders/:id` | order owner, the item's vendor, or admin |
| `PATCH` | `/orders/:id/status` | vendor: `accepted`/`rejected`; customer: `cancelled` while `pending` |

Every transition appends `{ status, changedBy, changedByRole, changedAt, note }`
to `statusHistory`, which powers the customer status timeline.

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
   `<API_URL>/api/subscriptions/webhook` and subscribe to
   `checkout.session.completed`, `checkout.session.expired` and
   `checkout.session.async_payment_failed`.
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` and restart the API.
5. Locally, forward events with the Stripe CLI:

   ```bash
   stripe listen --forward-to localhost:5000/api/subscriptions/webhook
   ```

The webhook route is mounted **before** `express.json()` and uses the raw
request body, because Stripe signatures are computed over the unparsed payload.
Premium is granted only when the signature verifies and the session is real.

## ImgBB setup

Create a key at <https://api.imgbb.com/> and set `IMGBB_API_KEY`. Uploads are sent
from the server only; the key never reaches the browser. The UI hides upload
controls and explains why when the integration is not configured.

## Deployment notes

- A Render blueprint is included as `render.yaml`. Point Render at this
  repository, then fill in the variables it prompts for (all secrets are marked
  `sync: false`, so no real value is stored in git).
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

The suite boots `mongodb-memory-server`, so no Atlas connection is required and
no real data is touched. It covers menu limits and approval, order state
transitions and ownership, role/authorization rules, and subscription checkout
and webhook handling.

## Project layout

```
server/
  src/
    config/          environment parsing
    integrations/    Stripe and ImgBB clients
    lib/             auth, jwt, async handler, categories, repositories
    middleware/      authenticate, authorize-role, blocked-user, validation, uploads
    modules/         auth, users, menu-items, orders, favorites,
                     subscriptions, transactions, dashboard, uploads, config
    scripts/         seed-admin, seed-demo
    app.ts           Express app and route mounting
    server.ts        process bootstrap
  tests/             Vitest + Supertest suites and helpers
```
