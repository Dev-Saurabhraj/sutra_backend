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
| `GET /health` | DB check and AI mode |

## AI

Set `ANTHROPIC_API_KEY` to let Claude (`claude-opus-5-5`, structured output, low effort, server-side refusal fallback)
read free-form voice notes. Without it, or with `SUTRA_AI=off`, the rule-based Hindi/Hinglish parser is used.
Either way, nothing is saved until the user confirms the preview.
