# Freshroots Demand Planning Intelligence

A demand-planning prototype for a regional FMCG distributor, built for the MESA School of Business AI-Native Track case study. It applies a planner's documented forecasting rules to sales and inventory data, flags high-demand, stockout and overstock risks, and puts every recommendation in front of a human planner for approval.

**Fixed rules decide every recommendation. AI only explains them.** Gemini writes a short summary and per-SKU explanations from the calculated results. It never changes a number, flag, action or quantity, and the app is fully usable without it.

> **Non-commercial case-study prototype.** It runs on Vercel Hobby, which is for non-commercial use. It is not a production system for Freshroots' commercial operations.

## Scope and limits (please read)

- **Sample data only.** The supplied weekly sales file has **240 rows: 15 SKUs over 16 weeks (2026-W27 to 2026-W42)**. It is not three years of history. The case narrative describes a larger company dataset that was not supplied.
- **Snapshot, not live.** Results reflect the inventory snapshot of **19 Oct 2026** (Pune Central Warehouse). The app does not connect to SAP. Its only outbound purchasing link is the optional Zoho Books integration below, which stays off until you configure it.
- **No distributor-level forecasts.** The sales file has no `Distributor_ID` column, so sales are not split by distributor.
- **No financial impact.** The data has no prices or costs, so savings and ROI are shown as "Not available".
- **Recommendations are proposals.** A planner approves, rejects or overrides each one. Approved items can be exported as CSV for manual handoff to procurement.
- **Data is loaded once.** There is no upload UI. The six supplied CSVs in `data/sample/` are validated and loaded into Neon by `npm run db:seed`. The two `distributor_master` files are byte-identical copies and are imported once.
- **Gemini free tier.** Free-tier submissions may be used to improve Google's products. Use only the supplied sample data. Do not put confidential company data into this demo.

## The rules

All thresholds live in one file, `src/lib/rules/config.ts`. The logic is a pure function in `src/lib/rules/engine.ts` with no database, network or AI access.

| Step | Rule |
| --- | --- |
| Averages | Latest 4 and latest 12 **observed** ISO weeks per SKU, sorted by real week. Fewer than 12 distinct weeks gives **Insufficient Data** and Manual Review. Missing weeks are never treated as zero. |
| Festival uplift | If the analysis month is a festival month (Mar, Oct, Nov, taken from the calendar), both averages are multiplied by **1.25 exactly once**. Raw and adjusted values are both stored and shown. The analysis month is the month of the latest inventory snapshot. |
| Coverage | `units on hand / adjusted 12-week average`, in weeks. |
| High Demand | `adjusted 4-week average > adjusted 12-week average x 1.20`. Suggested quantity is `1.5 x Standard_Reorder_Qty`, rounded up. Because both averages scale together, the uplift never changes this comparison. |
| Stockout (standard SKUs) | Coverage below **6** weeks. Suggest an immediate reorder at `Standard_Reorder_Qty`. |
| Overstock (standard SKUs) | Coverage above **14** weeks. Suggest pausing the next order (quantity 0). |
| High-perishability SKUs | Below **3** weeks is Stockout. 3 to 4 weeks is normal. Above **4** weeks is Overstock. The 6 and 14 week thresholds are not used. |

**Precedence for the primary recommendation.** Every applicable flag is kept, even when several apply.

1. Missing data (insufficient history or no inventory row): Manual Review, no quantity.
2. Overstock together with a reorder signal (High Demand or Stockout): **Manual Review: Conflicting Signals**, no executable quantity.
3. Overstock alone: **Pause Next Order**, quantity 0.
4. High Demand: reorder 1.5x the standard quantity.
5. Stockout: reorder at the standard quantity.
6. Otherwise: Maintain and Monitor (no order proposed).

Edge cases: zero average demand with stock on hand is treated as overstock with a warning. Zero demand and zero stock is Maintain with a warning. A SKU with no inventory row goes to Manual Review.

### What the sample data produces

The supplied sample is analysed with the 25% October uplift. These values were computed independently and are asserted in the tests.

| Result | SKUs |
| --- | --- |
| High Demand (and Stockout), reorder 750 | SKU001 |
| Stockout, reorder at standard quantity | SKU003 (300), SKU004 (150), SKU011 (500), SKU013 (120) |
| Overstock, pause next order | SKU006, SKU007 |
| Maintain and Monitor | the other 8 |

No SKU in the sample has conflicting signals or insufficient data. Those paths are covered by unit tests.

## Pages

| Page | Purpose |
| --- | --- |
| Overview | Counts per risk, risk chart, actions to review, AI summary, data status, snapshot date and last analysis time. |
| Workbench | Searchable, sortable, filterable SKU table. Each row has a stock-coverage gauge drawn against that SKU's own thresholds. |
| SKU detail | Sales chart with 4 and 12 week averages, raw and adjusted figures, every rule with its threshold and calculation, warnings, AI explanation, review history. |
| Review queue | Approve, reject, override a quantity, add a note, or mark for investigation. Pending, investigating, approved, overridden and rejected are shown separately. Export approved items as CSV. |

## Tech stack

Next.js (App Router, TypeScript), Tailwind CSS and shadcn/ui, Neon PostgreSQL with the serverless driver, Drizzle ORM and migrations, the official `@google/genai` SDK, Zod, PapaParse, Recharts, Vitest.

Database and AI code runs on the Node.js runtime. Reads use Neon's stateless HTTP driver. Writes that must be atomic open one short-lived pooled connection and always close it, so no connection outlives a request.

## Setup

### 1. Install dependencies

```bash
npm install
```

Requires Node.js 22 or newer.

### 2. Create a Neon Free project

Either create one at [neon.com](https://neon.com) (choose the **Free** plan), or from Vercel (step 9) with `vercel integration add neon --plan free_v3`.

### 3. Configure `DATABASE_URL`

Copy `.env.example` to `.env.local`. Set `DATABASE_URL` to the **pooled** connection string (the host contains `-pooler`) and `DATABASE_URL_UNPOOLED` to the direct one. Migrations use the unpooled string when it is set.

### 4. Run database migrations

```bash
npm run db:migrate
```

### 5. Load the supplied CSV data (once)

```bash
npm run db:seed
```

This validates every file, imports in dependency order inside transactions, skips the duplicate distributor file, and runs the first analysis. It is safe to run again: uniqueness constraints and upserts mean nothing is double-counted. Check it with:

```bash
npm run db:verify
```

Expected: 4 distributors, 15 SKUs, 24 calendar months, 240 sales rows, 1 snapshot, 15 inventory items, and 0 duplicate SKU/week groups.

If any row in a file is invalid (negative sales, a malformed week such as `2026-W54`, an unknown SKU, an invalid date, a bad reorder quantity, a conflicting duplicate), the whole file is rejected and nothing is written, so good data is never replaced.

### 5b. Day-to-day: re-run the analysis

Signed in as the planner, use **Re-run analysis** on the Overview page. Each run is stored; earlier runs and decisions are kept for audit, and only the latest run can be decided on.

### 6. Get a Gemini API key (free tier)

1. Open [Google AI Studio](https://aistudio.google.com/apikey) and create an API key.
2. Do **not** enable billing or link a paid Cloud project.
3. Confirm the model is free of charge on the [pricing page](https://ai.google.dev/gemini-api/docs/pricing). This project defaults to `gemini-3.8-flash`, which was listed as free (not preview) when this was built. Check again, because availability changes.

### 7. Configure the remaining variables

| Variable | Notes |
| --- | --- |
| `GEMINI_API_KEY` | From step 6. Server-side only. Without it, AI shows "not configured" and everything else works. |
| `GEMINI_MODEL` | Defaults to `gemini-3.8-flash`. There is **no fallback** to any other model. |
| `ADMIN_PASSWORD` | The planner's password. If unset, the app is a read-only demo and all changes are disabled. |
| `SESSION_SECRET` | At least 32 random characters: `openssl rand -base64 48`. |
| `AI_MAX_REQUESTS_PER_MINUTE`, `AI_MAX_REQUESTS_PER_DAY`, `AI_TIMEOUT_MS` | Optional guard rails (defaults 4, 40, 20000). |

### 8. Run locally

```bash
npm run dev
```

Open http://localhost:3000. Without `ADMIN_PASSWORD` it is read-only. With it, use **Sign in** in the sidebar.

### 9. Deploy to Vercel Hobby (non-commercial demo)

```bash
npm i -g vercel@latest
vercel link --project freshroots          # creates the project on your Hobby team
vercel integration add neon --plan free_v3 -m region=sin1 -m auth=false
```

The integration injects `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and related variables into the project. Always pick the Free plan.

### 10. Configure Vercel environment variables and initialise the database

```bash
printf %s "$(openssl rand -base64 48 | tr -d '\n')" | vercel env add SESSION_SECRET production --sensitive
vercel env add ADMIN_PASSWORD production --sensitive
vercel env add GEMINI_API_KEY production --sensitive
vercel env add GEMINI_MODEL production
vercel env pull .env.local --yes          # for running migrations and the seed locally
npm run db:migrate && npm run db:seed
vercel deploy --prod
```

Repeat the `vercel env add` lines for `preview` if you use preview deployments. `vercel.json` pins functions to `sin1` (Singapore) next to the database. Change both together if you move regions.

### 11. Verify the deployment

1. Overview shows 15 SKUs analysed, 1 High Demand, 5 Stockout, 2 Overstock, 0 manual review, 0 insufficient data.
2. `npm run db:verify` against the same database reports 240 sales rows and no duplicates.
3. Workbench: filter by Stockout Risk (5 SKUs), sort by coverage, open SKU001.
4. Sign in. In the review queue approve one item, override another with a note, then check **Export approved as CSV**. Reload and confirm the decisions persisted.
5. On the Overview, **Generate summary**. On a SKU page, **Explain this recommendation**. If Gemini is unavailable or over quota you should see a clear message and all numbers unchanged.

## Using the app

- Start on the **Overview**, then open the **Workbench** to see which SKUs need attention. The left edge of each row is coloured by priority and the gauge shows where stock cover sits against that SKU's thresholds.
- Open a **SKU** to see exactly why it was flagged: each rule, its threshold, and the arithmetic.
- In the **Review queue**, work from the top (most urgent first). Manual Review items have no suggested quantity, so they can only be overridden with a quantity or rejected. A decision cannot be changed once made; re-running the analysis creates fresh proposals.
- Signed-out visitors and read-only demos can look at everything. Only the signed-in planner can run the analysis, make decisions, or request AI commentary. This also keeps the free Gemini quota from being used by strangers.

## Free-tier limits and recovering from quota exhaustion

- The AI endpoints are throttled (default 4 per minute and 40 per day across the app), responses are capped at 1200 output tokens with low reasoning effort, requests time out after 20 seconds, and repeat requests for the same run and SKU are served from stored answers without calling Gemini.
- If you see "The Gemini free-tier quota has been reached": wait for the daily reset, or lower `AI_MAX_REQUESTS_PER_DAY`. Calculations, tables and the review queue keep working. **Do not enable billing or switch to a paid model.** The app will never switch models on its own.
- If you see "AI requests are limited": wait a minute. The cap exists to protect the free tier.
- Neon Free scales to zero. After a pause the first request can take a couple of seconds longer.

## Security notes

- Secrets live only in environment variables. `.env.example` has placeholders. Nothing secret is logged, and the Gemini key and database URL are never sent to the browser.
- Every data-changing endpoint requires the admin session. The session is an HMAC-signed, expiring (8 hours), HttpOnly, SameSite=Lax cookie. The password is compared in constant time, and a wrong password is delayed.
- All API inputs are validated with Zod. Review notes and labels are stripped of control characters and length-limited. The CSV export neutralises spreadsheet formulas.
- Review decisions and their audit rows commit in a single transaction, with the row locked so two clicks cannot both win.
- This is a single-admin prototype: there is no registration, per-user accounts or rate limit on sign-in beyond the delay.

## Tests and checks

```bash
npm test            # business rules, validation, imports, review flow, API gates, AI handling
npm run lint
npm run typecheck
npm run build
npm run verify      # all of the above in order
```

Database tests run the real migrations against in-memory Postgres (PGlite), so they need no network. They cover every rule case in the brief, duplicate and invalid CSV rows, idempotent imports, failed imports leaving data untouched, review status transitions and audit rows, rollback when an audit write fails, access gates and validation on each endpoint, and Gemini failure modes (malformed output, unknown SKU IDs, quota, timeout, throttling) with a mocked client. A test also asserts the analysis never imports the AI module.

## Project layout

```
src/lib/rules/        thresholds (config.ts) and the pure decision engine (engine.ts)
src/lib/csv/          CSV parsing and validation
src/lib/import/       transactional upserts, duplicate-file detection
src/lib/analysis/     loads inputs, runs the engine, stores a run
src/lib/review/       status state machine and the review service
src/lib/ai/           Gemini client, prompts, output schemas, throttling and caching
src/lib/api/          request handlers and Zod schemas behind the route files
src/db/               Drizzle schema and the Neon store
scripts/              seed.ts and verify-db.ts
data/sample/          the supplied sample CSVs
drizzle/              SQL migrations
```


## Zoho Books integration (optional)

Two directions, both off until the `ZOHO_*` variables in `.env.example` are set.

**Approve places a purchase order.** Approving or overriding a recommendation that proposes a quantity creates a *draft* purchase order in Zoho Books: one line, the SKU's Zoho item, the approved or overridden quantity, and the recommendation as the reference number. Rejecting, investigating, Maintain/Monitor and Pause (quantity 0) create nothing.

- The planner's decision is committed first. If Zoho is down or rejects the order, the approval stands, the failure is shown on the item, and **Retry order** sends it again. A retry never creates a duplicate: the order carries a unique reference and Zoho is checked for it before creating.
- The vendor is the SKU's distributor, found in Zoho by exact name (case-insensitive) among vendors. The item is found by exact SKU code. Both ids are cached after the first order. Create the vendors and items in Zoho first, or set `zoho_vendor_id` / `zoho_item_id` by hand.
- Prices are not sent: the data has none. Zoho uses the item's purchase rate, so set one there.

**Zoho items update the database.** The Zoho webhook and the *Sync items from Zoho* button (Overview, for a manual catch-up) run the same sync, which re-reads Zoho's API and ignores whatever the caller sent.

- A SKU we already have is linked to its Zoho item and takes Zoho's name. Reorder quantity, perishability, distributor and unit stay as loaded, because they feed the rules.
- An unknown SKU is created only if its preferred vendor matches a distributor by name and its reorder level is a whole number above 0 (that becomes the standard reorder quantity). Perishability and category come from Zoho custom fields labelled `Perishability` and `Category`, else `Low` and `Uncategorised`; the sync reports every default it used. Anything else is skipped with the reason shown.
- New SKUs have no sales or stock yet, so the analysis marks them for manual review until data arrives. Re-run the analysis after a sync.
- For the webhook, create a Zoho Books workflow rule on item creation and edit with a webhook to `POST /api/zoho/webhook` carrying the header `x-webhook-secret: <ZOHO_WEBHOOK_SECRET>`. There is no scheduled fallback: if a webhook is missed, use the button.

**Setup:** create a Self Client in the Zoho API console with scopes `ZohoBooks.purchaseorders.CREATE`, `ZohoBooks.purchaseorders.READ`, `ZohoBooks.contacts.READ`, `ZohoBooks.settings.READ`; exchange its code for a refresh token; set `ZOHO_DC`, `ZOHO_ORG_ID`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_WEBHOOK_SECRET`; run `npm run db:migrate`.

**Cost.** Zoho Books' free plan appears not to include purchase orders, so this needs a paid plan or the trial. That is outside the free-tier-only rule for the rest of the stack, which is why nothing here runs unless you configure it. The Zoho API calls were written from Zoho's published documentation and tested against a fake client; they have not been run against a live Zoho organisation.
