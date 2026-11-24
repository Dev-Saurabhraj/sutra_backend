# Sutra API

Node.js 22+ · Express 5 · TypeScript (strict) · Prisma 6 + PostgreSQL 17 · zod · pino · Vitest · Docker.

Rebuilt from scratch, using the `thread/` prototype only as a reference. The planning engine, GST rules, voice parser
and seed story were ported and re-structured into layers.

## Run

```bash
cp .env.example .env              # then set two random JWT secrets
docker compose up -d db           # Postgres on localhost:5433
npm install
npm run db:push && npm run db:seed
npm run dev                       # http://localhost:4000
```

Everything in Docker: `docker compose up -d --build` (then `docker compose exec api npm run db:seed`).

Checks: `npm run typecheck` · `npm test`.

**Demo login:** Rohit Kushwaha, phone `+919800000001`, dev OTP `123456`. That OTP works only when `NODE_ENV=development`;
the real code is also printed in the server log. Other makers use `+9198000000NN` (02–13). Sitaram Koli (`04`) is on
the composition scheme and Kamla Bai (`07`) is unregistered, to exercise the GST rules.


**Your data is safe from the demo seed.** `npm run db:seed` refuses to run once any real (non-demo) account
exists, because it starts from an empty database. `npm run db:seed:wipe-all` erases everything on purpose.
The Postgres data lives in the `pgdata` Docker volume, so restarting the server or Docker keeps every account.

## Layout

```
src/
  server.ts, app.ts        bootstrap + Express app factory
  container.ts             composition root: the only place that news up concrete classes
  config/env.ts            zod-validated environment (fails fast)
  core/                    errors, logger, db client, HTTP middleware (auth, validation, idempotency, error handler)
  data/                    UnitOfWork (transactions across repositories), counters
  engine/                  pure planning functions: reorder health, "Can Deliver" quote, cluster split (+ tests)
  ai/                      VoiceParser strategy: Claude → rule-based fallback chain (+ tests)
  events/                  EventBus (observer) for post-commit side effects
  shared/                  GST (GSTIN checksum, tax split, sale-document rules, FY invoice numbers), money, time
  modules/<name>/          vertical slices: *.controller.ts → *.service.ts → *.repository.ts
prisma/                    schema.prisma, seed.ts
```

## Design patterns used

| Pattern | Where | Why |
|---|---|---|
| Repository | `modules/*/*.repository.ts` | Only repositories import Prisma; services stay testable |
| Unit of Work | `data/unit-of-work.ts` | A voice "sale" touches stock, order, invoice and khata in **one** transaction |
| Strategy | `ai/voice-parser.ts`, `modules/auth/otp-sender.ts` | Swap Claude / rules, log / SMS without touching callers |
| Chain of responsibility | `FallbackVoiceParser` | Claude first, rules if Claude is off, slow or refuses |
| Command + Registry | `modules/voice/handlers/*`, `voice.registry.ts` | One handler per voice action; a new action is a new class |
| Factory | `InvoiceService.issueForSale` | Picks tax invoice vs bill of supply by GST scheme and numbers it per FY |
| Observer | `events/event-bus.ts`, `low-stock.watcher.ts` | Low-stock alerts after a commit, without the voice code knowing |
| Domain service shared by channels | `InventoryService.*In(repos, …)` | Voice entries and app taps run the same produce/sell/stock-in code inside one transaction |
| Derived ledger | `labour/wages.ts` | Wage due and advance pending are computed from append-only entries; the 50% rule is a pure, tested function |
| Template / data-driven config | `onboarding/industry-templates.ts` | A new industry is data, not code |
| Shared domain service | `quotes/quote.service.ts` | One "can I deliver?" for the maker's order screen, the buyer's instant quote, the badge and the late-order check |
| State machine | `engine/order-flow.ts` | Order stages and allowed moves in one pure table; services ask it, never hard-code statuses |
| Strategy + fallback | `ai/translator.ts`, `ai/story-writer.ts`, `catalog/image-cleaner.ts` | Chat translation, catalog stories and photo clean-up each have an offline implementation |
| Composition root / DI | `container.ts` | Constructor injection everywhere; no hidden singletons |

## API (v1)

All routes except `/auth/*` need `Authorization: Bearer <accessToken>`. Mutating routes accept an `Idempotency-Key` header.
Errors are always `{ "error": { "code", "message", "details"? } }`.

| Method & path | What it does |
|---|---|
| `POST /api/v1/auth/otp/request` `{phone}` | Send an OTP (registered numbers only; 3 per 15 min) |
| `POST /api/v1/auth/otp/verify` `{phone, code}` | → `{accessToken, refreshToken, user}` |
| `POST /api/v1/auth/refresh` `{refreshToken}` | Rotate tokens; reusing an old refresh token revokes every session |
| `POST /api/v1/auth/logout` `{refreshToken}` | Revoke |
| `GET /api/v1/me` · `POST /me/consent` · `PUT /me/language` | Profile, DPDP consent, language |
| `GET /api/v1/home` | "Aaj" summary: greeting + spoken line, alerts, KPIs, top materials |
| `GET /api/v1/stock/materials` | Run-out prediction per material (OK / LOW / CRITICAL, reorder-by date) |
| `GET /api/v1/stock/products` | Finished goods |
| `POST /api/v1/stock/materials/:id/reorder` `{qty}` | WhatsApp reorder message + `wa.me` link |
| `POST /api/v1/voice/preview` `{transcript}` | Understand a note, store the draft, return what will be written |
| `POST /api/v1/voice/:id/confirm` | Write the stored draft once (second call → 409) |
| `GET /api/v1/khata?status=open\|settled` | Ledger with overdue days and the MSME 45-day clock |
| `POST /api/v1/khata/:id/settle` · `GET /khata/:id/reminder` | Settle; reminder text + WhatsApp + UPI links |
| `GET /api/v1/alerts?unread=true` · `POST /alerts/:id/read` · `POST /alerts/read-all` | Alerts |
| `GET /api/v1/invoices` · `GET /invoices/:id` | Invoices / bills of supply |
| `GET /api/v1/industries` | Industry templates (starter materials, products, recipes, usual wage type) |
| `POST /api/v1/onboarding` | Create the whole business in one transaction → fresh session with the producer id |
| `GET /api/v1/inventory/flow` | The five stations: suppliers · raw · making · ready · clients, plus materials and products |
| `GET/POST /api/v1/inventory/suppliers` · `GET/POST /inventory/clients` | Partners at each end of the thread |
| `POST /api/v1/inventory/materials` · `/materials/:id/stock-in` · `/materials/:id/adjust` | Add material; stock in (GST purchase + to-pay when a rate and supplier are given); count correction |
| `POST /api/v1/inventory/products` · `/products/:id/produce` · `/sell` · `/adjust` | Add product with recipe; make (recipe deduction, piece wages if `workerId`); sell (GST document + khata); count |
| `GET /api/v1/inventory/movements?materialId=&productId=` | Movement history |
| `GET /api/v1/labour` | Team: wage due, overdue, advance pending, this period's earnings, pay-by date, today's attendance |
| `POST /api/v1/labour/workers` · `PATCH /labour/workers/:id` | Add or edit a worker (daily / piece / monthly) |
| `POST /api/v1/labour/attendance` `{marks:[{workerId, units}]}` | Roll call (1, 0.5, 0); re-marking replaces |
| `POST /api/v1/labour/workers/:id/piece` · `/advance` · `/pay` | Piece work; advance; pay (advance recovery ≤ 50% of the period's wages) |
| `GET /api/v1/labour/workers/:id/pay-preview` · `/history` · `/slip` | Split before paying; ledger; WhatsApp wage slip |
| `GET /api/v1/bills/samples` | Whether photo reading is on (AI), and the demo sample bills |
| `POST /api/v1/bills/scan` `{image:{base64,mediaType}}` or `{sampleKey}` | Read a bill → draft with GSTIN / arithmetic checks, supplier + material matching, tax credit (nothing saved yet; photo kept) |
| `POST /api/v1/bills/:id/confirm` `{materialIds?}` | Save it: stock in, multi-line GST purchase with ITC, money to pay, GST alert if the GSTIN fails (second call → 409) |
| `GET /api/v1/invoices/:id/pdf` | Tax invoice / bill of supply / proforma as an A4 PDF (Rule 46 fields, amount in words) |
| `GET /api/v1/gst/periods` | Last 6 months and 4 financial-year quarters |
| `GET /api/v1/gst/summary?month=2026-11` or `?quarter=2026-Q3` | Regular: output tax vs ITC, payable / carry forward, ITC at risk · Composition: 1% CMP-08 estimate + limit watch · Unregistered: registration threshold + inter-state warning · issues and filing hints |
| `GET /api/v1/gst/export.csv` · `GET /api/v1/gst/gstr1.json` | Files for the CA (review before filing); GSTR-1 only for regular dealers |
| `GET /api/v1/orders?tab=new\|active\|done` | Orders inbox with counts per tab and the last message |
| `GET /api/v1/orders/:code` | Order + allowed actions + live "can I deliver?" (stock, looms, other orders, material lead times) + price floor (recipe + piece wage) + chat + invoices |
| `POST /api/v1/orders/:code/respond` `{accept}` | Accept (promises what the simulation says) or decline, with a message to the buyer |
| `POST /api/v1/orders/:code/dispatch` `{transporter?, lrNumber?, photo?}` | Stock out, tax invoice / bill of supply, money to collect, proof of dispatch (wrong stage → 409 `WRONG_STAGE`; fewer pieces in stock than ordered → 409 `NOT_READY`) |
| `GET /api/v1/orders/:code/dispatch-photo` | The proof photo |
| `POST /api/v1/orders/:code/deliver` | Delivered; updates orders done and the on-time rate |
| `POST /api/v1/orders/:code/messages` `{text}` | Write in Hindi; the buyer gets English (original always kept; marked untranslated when AI is off) |
| `GET /api/v1/catalog` | Products with unit cost, margin at list price, published / ready |
| `POST /api/v1/catalog/:id/draft` `{note, photo?}` | Clean the photo (square, straightened, even light) and draft an honest English story; nothing is published |
| `PATCH /api/v1/catalog/:id` `{name?, story?, price?, published?, acceptBelowCost?}` | Save the listing; publishing below cost needs `acceptBelowCost` (409 `BELOW_COST`) |
| `GET /api/v1/capacity` | Capacity calendar (P24): next 6 weeks as machines working per day, events, machine-days lost |
| `POST /api/v1/capacity` `{kind, startsOn, endsOn, machinesOff?, note?}` | Add downtime (holiday = all machines unless said); returns accepted orders it now makes late, each with an alert |
| `DELETE /api/v1/capacity/:id` | Remove an entry |
| `GET /api/v1/market/products?q&industry&cluster&category&maxPrice` | Browse (B1) with facets; every card has the "Can Deliver" badge (B2): ready after other orders + pieces per week after downtime |
| `GET /api/v1/market/products/:id` · `GET /api/v1/market/makers/:slug` | Product page and trust profile (B7): GSTIN with format check, scheme, Udyam yes/no, quality marks, orders done, on-time rate, since |
| `POST /api/v1/market/quote` `{productId, qty, wantedBy}` | Instant quote (B3) from the same engine the maker sees, GST for the buyer's state, and a cluster split (B4, max 4 registered makers) when one maker can't make the date |
| `POST /api/v1/market/requests` `{…quote, note?, split}` | Buyer only: order per maker, a proforma each (B5), the note translated to Hindi, an alert to each maker |
| `GET /api/v1/market/orders` · `/orders/:code` · `POST /orders/:code/messages` | Tracking (B6): stages, the rest of a split request, letters (maker's Hindi shown in English) |
| `GET /api/v1/market/orders/:code/dispatch-photo` · `GET /api/v1/market/invoices/:id/pdf` | Proof of dispatch and documents, scoped to the buyer's own orders |
| `POST /api/v1/onboarding/buyer` `{name, business, city, state, gstin?}` | Buyer account (GSTIN checked against the state); the new session carries `buyerId` |
| `GET /api/v1/cluster` | Cluster admin (C1): every maker's production, sales, orders, stock alerts and GST status, with totals |
| `POST /api/v1/cluster/split` · `/split/send` `{category, qty, wantedBy, buyer?}` | Bulk order (C2) shared fairly by each maker's real capacity; "send" creates one request per maker under a `BULK-` code with a Hindi alert |
| `GET /api/v1/cluster/group-buy` | Buy together (C3): 4 weeks of material needs added up across makers, with a ready WhatsApp message for the supplier |
| `GET /api/v1/cluster/compliance` · `/impact` | GST health per maker (C4); agent's cut kept, direct orders, income, on-time (C5) |
| `GET /api/v1/prices` | Supplier price watch (P25): rates per bill, trend, cheapest supplier; a rise of 5%+ on a bill raises a `PRICE` alert |
| `POST /api/v1/webhooks/whatsapp` (+ `GET` verify) | WhatsApp bot (P28): the voice flow over WhatsApp ("aaj 6 saree bani" → preview → "haan" saves). Signed by Meta (`WHATSAPP_APP_SECRET`); replies via the Cloud API when `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_TOKEN` are set, otherwise logged |
| `GET /api/v1/me/export` · `DELETE /api/v1/me` | DPDP (X4): all your data as JSON; delete the account (login and personal details erased, business hidden; tax records kept 6 years as GST law requires) |
| `POST /api/v1/orders/:code/advance` `{pct}` · `/advance/received` | Advance (B8): maker asks a % before making; the buyer pays straight to the maker's UPI ID (Sutra never holds money); the maker confirms; dispatch then bills only the balance |
| `POST /api/v1/market/orders/:code/advance-paid` `{utr}` | Buyer says the advance is paid, with the 12-digit UPI reference; the maker gets an alert |
| `GET /api/v1/orders/:code/eway-bill` | E-way bill helper (X6): needed or not (₹50,000, handicraft rule) and Part A/B prefilled for the portal |
| `GET /api/v1/gst/2b/sample` · `POST /api/v1/gst/2b/reconcile` `{data}` | GSTR-2B reconciliation (X7): portal JSON vs the books → matched, short-filed, not filed (credit at risk), not in books |
| `GET /api/v1/schemes` | Scheme matcher (C6): government schemes the maker may qualify for, each with why and the official link |
| `GET /api/v1/cluster/categories` | What this cluster's makers make (for the bulk-order picker) |
| `GET /media/catalog/*` | Public catalog photos (nothing else under `uploads/` is served) |
| `GET /health` | DB check and AI mode |

## Files

Bill, dispatch and catalog photos are saved through the `FileStore` interface (`LocalFileStore` → `uploads/`, a Docker volume). Swap in cloud
storage by adding another implementation in `container.ts`. Demo bill images live in `assets/samples/`.

## AI

Set `ANTHROPIC_API_KEY` to let Claude (`claude-opus-5-5`, structured output, low effort, server-side refusal fallback)
read free-form voice notes and bill photos. Without it, or with `SUTRA_AI=off`, the rule-based Hindi/Hinglish parser
is used for voice, and only the three sample bills can be "read" (photos are refused with a clear message).
Either way, nothing is saved until the user confirms the preview.
