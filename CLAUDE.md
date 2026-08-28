# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Comparateur de factures fournisseurs" (a.k.a. "comparateur test Ozego") — a supplier invoice
matcher. Users create a comparatif per prospect, upload their supplier invoices (PDF/scan), the
app extracts line items via AI, matches each line to a reference product catalog, and shows the
price gap versus catalog price and versus the cheapest known price for the same product group
(Ozego identifier). See [.lovable/plan/comparateur-de-factures-fournisseurs-2026-08-17.md](.lovable/plan/comparateur-de-factures-fournisseurs-2026-08-17.md)
for the original product spec (in French) — matching thresholds, table list, and out-of-scope
items are defined there.

Built with Lovable (lovable.dev) and Lovable Cloud (Supabase-based backend). This repo is not a
git repository locally — there is no `.git` directory, so don't assume `git` commands work here.

## Commands

Package manager is bun (`bun.lock`, `bunfig.toml`), though `package.json` scripts also work via npm.

```sh
bun install          # or: npm i
bun run dev          # vite dev — starts the app
bun run build        # vite build
bun run build:dev    # vite build --mode development
bun run preview      # vite preview
bun run lint         # eslint .
bun run format       # prettier --write .
```

There is no test suite in this repo (no test runner configured, no `*.test.ts` files).

`bunfig.toml` enforces a 24h supply-chain guard on new package versions (`minimumReleaseAge`).
Only bypass it (via `minimumReleaseAgeExcludes`) for `@lovable.dev/*` packages, and confirm with
the user before adding new excludes.

## Architecture

### Framework: TanStack Start (file-based routing)

Routes live in `src/routes/`; `routeTree.gen.ts` is auto-generated — never edit it by hand. See
[src/routes/README.md](src/routes/README.md) for file-naming conventions (`$id` dynamic segments,
`_layout.tsx`, `__root.tsx`, splat routes). The only root layout is `src/routes/__root.tsx`
(wraps every page in `QueryClientProvider`, renders `<Outlet />` — do not remove it).

`vite.config.ts` is intentionally minimal: `@lovable.dev/vite-tanstack-config` already wires up
TanStack Start, React, Tailwind, path aliases, and Nitro — read the comment at the top of that
file before adding plugins, since duplicating them breaks the build.

`src/server.ts` and `src/start.ts` wrap the generated TanStack Start server entry to force
internal SSR/server-function errors into a plain error page (`src/lib/error-page.ts`) instead of
leaking raw h3 JSON error bodies. `src/start.ts` also re-registers CSRF protection for server
functions (TanStack Start skips its default CSRF middleware once `src/start.ts` exists) and
installs `attachSupabaseAuth` as global function middleware so every server function call carries
the user's Supabase bearer token.

### `.server.ts` vs `.functions.ts` — critical bundling boundary

- `src/lib/*.server.ts` files (`db.server.ts`, `ai.server.ts`, `matching.server.ts`,
  `invoices.server.ts`, `catalog.server.ts`) contain real business logic and **must never be
  imported at the top level from a route file or a `.functions.ts` file** — those ship to the
  client bundle, and `.server.ts` modules hold service-role keys / server-only env vars.
- `src/lib/*.functions.ts` files (`invoices.functions.ts`, `catalog.functions.ts`) are the
  `createServerFn(...)` boundary: they validate input with `zod`, then `await import("./x.server")`
  **inside the handler** to keep the server-only code out of the client bundle. Follow this exact
  pattern (validate → dynamic import → delegate) when adding a new server function.
- Routes call server functions via `useServerFn(fn)` from `@tanstack/react-start` + `useMutation`.
- `src/integrations/supabase/client.server.ts` exports `supabaseAdmin` (service-role, bypasses
  RLS) — only usable inside other `.server.ts` modules or inside a server function handler via
  dynamic import, never from client code.

### Two Supabase clients

- `src/integrations/supabase/client.ts` — browser/client-side client (anon/publishable key,
  persisted session). Routes query Supabase directly from React Query hooks with this client for
  reads and simple writes (no need to round-trip through a server function for normal CRUD).
- `src/lib/db.server.ts` (`serverSupabase()`) and `src/integrations/supabase/client.server.ts`
  (`supabaseAdmin`) — server-side clients using the publishable/service-role key, used from
  `.server.ts` modules for AI extraction, matching, and catalog import (heavier logic that
  shouldn't run in the browser).
- Several files under `src/integrations/supabase/` are marked "automatically generated. Do not
  edit it directly" (`client.ts`, `client.server.ts`, `auth-attacher.ts`, `auth-middleware.ts`,
  `types.ts`) — these are Lovable-managed Supabase scaffolding; treat them as generated and avoid
  hand-editing unless regenerating the equivalent from Lovable.

### Invoice processing pipeline

1. `runInvoiceProcessing` (`src/lib/invoices.server.ts`) downloads the invoice file from Supabase
   Storage, base64-encodes it, and calls `extractInvoice` (`src/lib/ai.server.ts`), which sends
   the file to the Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1`, model
   `google/gemini-3.7-flash`) with a strict JSON-extraction prompt to get header fields + line
   items.
2. Extracted lines go through `matchLines` (`src/lib/matching.server.ts`), which resolves each
   line to a `catalog_products` row via, in order: learned `product_mappings` (exact then fuzzy
   token match), exact supplier reference/EAN, Postgres trigram search (`search_catalog` RPC,
   `pg_trgm`), and pgvector semantic search (`match_catalog_embedding` RPC, embeddings from
   `embedTexts` in `ai.server.ts`, model `openai/text-embedding-3-small`) — combined into one
   score (`0.35*max(lexical,semantic) + 0.2*min(lexical,semantic) + 0.45*tokens`, plus size/price
   bonuses from `src/lib/match-normalize.ts`) and classified as `confirmed`/`review`/`unmatched`
   against thresholds from `app_settings`.
3. Manual correction in the invoice detail route (`src/routes/factures.$id.tsx`) writes back to
   `product_mappings`, which is what makes subsequent invoices from the same supplier auto-match.
4. "Pack factor" (`src/lib/pack.ts`, `derivePackFactor`) normalizes invoice quantities/prices sold
   in cartons/packs down to a comparable per-unit price before computing gaps
   (`src/lib/format.ts#lineGap`, `src/lib/ozego.ts#ozegoGap`).

### Ozego identifiers

`catalog_products.ozego_id` groups equivalent products across suppliers; `src/lib/ozego.ts` calls
the `cheapest_by_ozego` RPC to find the cheapest known price in a group, so an invoice line can be
compared both against its directly-matched catalog product and against the best price across all
suppliers for the same product group.

### Database (Supabase/Postgres)

Schema lives in `supabase/migrations/*.sql` (applied in filename/timestamp order). Core tables:
`prospects`, `suppliers`, `invoices`, `invoice_lines`, `catalog_products` (with `pg_trgm` index and
`vector(1536)` embedding column), `product_mappings` (learned supplier→catalog correspondences),
`catalog_sync_runs`, `app_settings` (single-row config: match thresholds, tolerance percent, ERP
API URL). Custom RPCs: `search_catalog` (trigram search), `match_catalog_embedding` (cosine
similarity search), `cheapest_by_ozego`.

There is currently no authentication gate in the UI (per the product plan, this is single-user/
internal tooling for now), though the Supabase auth middleware/RLS plumbing exists and is wired
into server functions.

### Env vars

Client-side (Vite-injected, `VITE_` prefix) and server-side pairs both exist for Supabase:
`SUPABASE_URL`/`VITE_SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`/`VITE_SUPABASE_PUBLISHABLE_KEY`,
plus `SUPABASE_PROJECT_ID`/`VITE_SUPABASE_PROJECT_ID`. Server-only: `SUPABASE_SERVICE_ROLE_KEY`
(used by `supabaseAdmin`) and `LOVABLE_API_KEY` (Lovable AI Gateway, used by `ai.server.ts`) —
these are not expected to live in the local `.env` and are provisioned by Lovable Cloud.

## UI conventions

shadcn/ui components (`src/components/ui/`, "new-york" style, see `components.json`) — add new
ones via the shadcn CLI/aliases (`@/components`, `@/lib`, `@/hooks`) rather than hand-rolling
primitives. All user-facing copy in this app is in French; keep new UI text consistent with that.

## Lint/format

ESLint (`eslint.config.js`) forbids importing the Next.js `server-only` package — this project
uses the `*.server.ts` naming convention (or `@tanstack/react-start/server-only`) instead. Prettier
is run through `eslint-plugin-prettier`, so `bun run lint` also enforces formatting
(100-char width, double quotes, trailing commas — see `.prettierrc`).

## Lovable sync

This project is connected to Lovable (see [AGENTS.md](AGENTS.md)). Avoid force-pushing or
rewriting published git history (rebase/amend/squash of pushed commits) — it desyncs Lovable's
copy of the project history. Commits pushed to the connected branch sync back into the Lovable
editor.
