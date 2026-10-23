<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Freshroots commands and constraints

- `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, or all four with `npm run verify`.
- `npm run db:generate` after editing `src/db/schema.ts`, then `npm run db:migrate`. `npm run db:seed` loads `data/sample/` once and is idempotent. `npm run db:verify` checks row counts.
- Write the test first. Database tests use in-memory Postgres (PGlite) with the real migrations; see `tests/helpers/db.ts`.
- All forecasting thresholds live in `src/lib/rules/config.ts`. `src/lib/rules/engine.ts` must stay pure: no I/O, no `process.env`, no AI imports (a test enforces this).
- Gemini only explains results. It must never change a calculation, flag, action or quantity, and the analysis must never import `src/lib/ai`.
- Free tier only: Vercel Hobby, Neon Free, Gemini free-tier models. Never add a fallback to a paid model or enable billing.
- Every data-changing route goes through the admin gate in `src/lib/api/handlers.ts`. Keep route files thin.
- `cacheComponents` is off on purpose: every page reads the session cookie and live data.
- Never commit `.env*` (except `.env.example`) or read credentials from them.
- Zoho Books (`src/lib/zoho`, `src/lib/procurement`) is optional and off without `ZOHO_*` env vars. A Zoho failure must never undo a review decision. The webhook endpoint ignores request bodies and authenticates by shared secret only.
