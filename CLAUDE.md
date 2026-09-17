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

Built with Lovable (lovable.dev) and Lovable Cloud (Supabase-based backend). Hosted on GitHub at
`EDGD-Organisation/ComparFacture`; feature branches are merged into `main` via pull request (the
`develop` branch currently mirrors `main`). See [README.md](README.md) for a (French)
setup/onboarding walkthrough aimed at new contributors — this file stays the deeper technical
reference.

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

### Local database (Docker)

Development currently targets a **local** Supabase stack, not the remote Lovable Cloud project —
by design, until this app is deployed (not yet planned). `bunx supabase start` boots the full
stack (Postgres 17, PostgREST, Auth, Storage, Studio) in Docker and applies every migration in
`supabase/migrations/`. `.env.local` holds the local stack's credentials and — since bun loads it
with higher precedence than `.env` — overrides the remote Lovable Cloud config for as long as it
exists; delete it to fall back to remote. `bunx supabase status` reprints the local URLs/keys
(Studio at `:54323`); `bunx supabase stop` shuts the stack down (data persists in the Docker
volume; add `--no-backup` to wipe it).

On Windows/Docker Desktop, the `vector` service (log shipping, unrelated to the `pgvector`
extension) can crash-loop with "Network unreachable" trying to reach the Docker socket — harmless
(Studio's Logs tab just stays empty) but worth clearing with `docker rm -f
supabase_vector_<project_ref>` or starting with `bunx supabase start -x vector`.

**Known gap, left deliberately unfixed**: `supabase/migrations/20260824094934_*.sql` has a typo
(`ADD d prospects_status_check` instead of `ADD CONSTRAINT prospects_status_check`) that is a hard
Postgres syntax error — it aborts `supabase start`'s migration replay and can never have succeeded
anywhere, including the remote project. Do not edit that file (this project adds corrective
migrations instead of rewriting migration history — see the two other `2026083*` migrations for
the pattern). To get a fresh local stack running despite it: temporarily rename the file so the
CLI's `<timestamp>_name.sql` pattern doesn't match it (e.g. append `.disabled`), run
`supabase start`, apply that migration's corrected SQL by hand via
`docker exec -i supabase_db_<project_ref> psql -U postgres -d postgres`, then rename the file back
unchanged. `supabase/migrations/20260831101103_fix_prospects_status_check_constraint.sql` then
covers it idempotently for everything after that point (including a fresh `db reset` — as long as
that reset doesn't replay the broken file first, which it currently still does).

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

- `src/lib/*.server.ts` files (`db.server.ts`, `ai.server.ts`, `structure.server.ts`,
  `matching.server.ts`, `invoices.server.ts`, `catalog.server.ts`) contain real business logic and
  **must never be
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
   Storage, base64-encodes it, and calls `structureInvoiceImage` (`src/lib/structure.server.ts`),
   which sends the file **directly** to the Gemini API (`@google/genai`, `GEMINI_API_KEY`, model
   `gemini-3.1-flash-lite`, **not** the Lovable AI Gateway) as multimodal input (image or PDF) with
   a `responseSchema`-constrained JSON output, to get header fields + line items.
   - An earlier OCR-based design (Tesseract → plain text → LLM structuring) was built, tested
     against real invoices, and deliberately dropped: flattening the image to text lost entire
     line items on dense tables and couldn't distinguish printed numbers from handwritten
     annotations (common on these invoices) — sending the image directly fixed both, verified to
     reconcile extracted line sums against each invoice's printed total to within 0.0% error.
   - Gemini doesn't reliably follow "return ISO dates" on its own — `structure.server.ts` validates
     `invoice_date` against `/^\d{4}-\d{2}-\d{2}$/` and nulls it out otherwise, because a
     non-ISO string sent to the `invoices.invoice_date` `DATE` column fails the whole `UPDATE`
     statement (Postgres error `22008`) with no partial write. Always check the `error` from that
     final `invoices` update in `runInvoiceProcessing` — the pipeline previously swallowed this
     failure silently, leaving the row stuck at `status: "processing"`.
   - `ai.server.ts` (Lovable AI Gateway) has been removed entirely — `embedTexts` now lives in
     `src/lib/embeddings.server.ts` and is unrelated to invoice extraction.
2. Extracted lines go through `matchLines` (`src/lib/matching.server.ts`), which resolves each
   line to a `catalog_products` row via, in order: learned `product_mappings` (exact then fuzzy
   token match), exact supplier reference/EAN, Postgres trigram search (`search_catalog` RPC,
   `pg_trgm`), and pgvector semantic search (`match_catalog_embedding` RPC, embeddings from
   `embedTexts` in `embeddings.server.ts`) — combined into one
   score (`0.35*max(lexical,semantic) + 0.2*min(lexical,semantic) + 0.45*tokens`, plus size/price
   bonuses from `src/lib/match-normalize.ts`) and classified as `confirmed`/`review`/`unmatched`
   against thresholds from `app_settings`.
3. Manual correction in the invoice detail route (`src/routes/factures.$id.tsx`) writes back to
   `product_mappings`, which is what makes subsequent invoices from the same supplier auto-match.
4. "Pack factor" (`src/lib/pack.ts`, `derivePackFactor`) normalizes invoice quantities/prices sold
   in cartons/packs down to a comparable per-unit price before computing gaps
   (`src/lib/format.ts#lineGap`, `src/lib/ozego.ts#ozegoGap`).

`scripts/multimodal-test.ts` (`bun run multimodal:test <files...> --out results.json`) exercises
`structureInvoiceImage` directly against real files on disk, without touching Supabase — useful for
judging extraction quality on a new invoice format before trusting it in the real pipeline.

### Embeddings (local, no API key)

`src/lib/embeddings.server.ts` computes `catalog_products.embedding` and the query-side vectors
used by `match_catalog_embedding` entirely in-process via `@huggingface/transformers` (ONNX
Runtime, `Xenova/multilingual-e5-small`, 384 dimensions, `"query: "` prefix applied uniformly to
both catalog and query text) — no network call, no API key, replacing the Lovable AI
Gateway/OpenAI `text-embedding-3-small` (1536-dim) call that used to live in the now-deleted
`ai.server.ts`. `multilingual-e5-small` was chosen after testing several candidates against real
French food-service invoice text — it was the only one that reliably ranked a real "same product,
different wording" pair above a real "different product" pair; two popular general multilingual
paraphrase models (MiniLM-L12, mpnet-base) both failed that test outright. The model is downloaded
on first use and cached under `.cache/transformers/`.

**Local-only, one-way schema change**: `supabase/migrations/20260902095830_local_embeddings_384_dim.sql`
switched `catalog_products.embedding` from `vector(1536)` to `vector(384)` and rebuilt
`match_catalog_embedding` accordingly. This is only safe locally because local embeddings were
always NULL (the Lovable Gateway was never reachable in local dev) — do **not** run this migration
against the remote/production project, which has real 1536-dim embeddings.

### Ozego identifiers

`catalog_products.ozego_id` groups equivalent products across suppliers; `src/lib/ozego.ts` calls
the `cheapest_by_ozego` RPC to find the cheapest known price in a group, so an invoice line can be
compared both against its directly-matched catalog product and against the best price across all
suppliers for the same product group.

### Database (Supabase/Postgres)

Schema lives in `supabase/migrations/*.sql` (applied in filename/timestamp order). Core tables:
`prospects`, `suppliers`, `invoices`, `invoice_lines`, `catalog_products` (with `pg_trgm` index and
a `vector` embedding column — `384` dimensions locally, `1536` on the untouched remote project, see
"Embeddings" above), `product_mappings` (learned supplier→catalog correspondences),
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
(used by `supabaseAdmin`) — not expected to live in the local `.env`, provisioned by Lovable Cloud.
Catalog embeddings no longer need `LOVABLE_API_KEY`/any API key — see "Embeddings" above.
`GEMINI_API_KEY` (Google AI Studio, direct — not the Lovable Gateway) is required
for invoice extraction (`structure.server.ts`) and, unlike the others, is expected in the local
`.env` for development.

## UI conventions

shadcn/ui components (`src/components/ui/`, "new-york" style, see `components.json`) — add new
ones via the shadcn CLI/aliases (`@/components`, `@/lib`, `@/hooks`) rather than hand-rolling
primitives. All user-facing copy in this app is in French; keep new UI text consistent with that.

## Lint/format

ESLint (`eslint.config.js`) forbids importing the Next.js `server-only` package — this project
uses the `*.server.ts` naming convention (or `@tanstack/react-start/server-only`) instead. Prettier
is run through `eslint-plugin-prettier`, so `bun run lint` also enforces formatting
(100-char width, double quotes, trailing commas — see `.prettierrc`). `eslint.config.js` also
ignores `src/integrations/supabase/**` entirely — that's the generated Lovable scaffolding (see
"Two Supabase clients" above), not code maintained by hand here, so it isn't linted/formatted.

## Deployment & CI/CD

Production runs on a single VPS behind Traefik, deployed through three chained GitHub Actions
workflows (`.github/workflows/`), all scoped to `main`:

1. **`ci.yml`** — on push/PR to `main`: `tsc --noEmit`, `bun run lint`, then a full `bun run build`
   (`NITRO_PRESET=node-server` plus the public `VITE_*` Supabase vars from repo/environment
   variables — safe to expose since these are the publishable client-side values, not secrets).
2. **`docker-publish.yml`** ("Build & Push Docker Image") — on push to `main`: builds the
   `Dockerfile` image and pushes it to `ghcr.io/edgd-organisation/comparfacture` (tags `:latest`
   and `:sha-<commit>`), baking the same public `VITE_*` vars in as build args. Service-role/API
   secrets never go into the image — they're supplied at container runtime instead (see
   `docker-compose.yml` below).
3. **`deploy.yml`** — triggered by that workflow's completion (`workflow_run`), SSHes into the VPS
   (`appleboy/ssh-action`, using `SERVER_HOST`/`SERVER_USER`/`SERVER_SSH_KEY` secrets) and runs
   `sudo docker compose pull && sudo docker compose up -d` from `~/comparfacture`. `sudo` is
   required because the deploy user (`ubuntu`) is deliberately not in the `docker` group on this
   VPS — see the comment in `deploy.yml` for the audit reference; don't "fix" this by adding
   `ubuntu` to the `docker` group.

`Dockerfile` is a multi-stage Bun→Node build: dependencies and the TanStack Start/Vite build run in
an `oven/bun:1` stage (native deps like `onnxruntime-node` and `sharp` must be resolved inside this
Linux image, not copied in from a host build — see "Embeddings" above), then only the built
`.output/` is copied into a slim `node:22-bookworm-slim` runtime stage. `NITRO_PRESET=node-server`
is forced at build time because `@lovable.dev/vite-tanstack-config` otherwise targets Cloudflare
Workers by default (see `vite.config.ts` note above). The runtime stage installs `libgomp1`
(required by `onnxruntime-node` for local embeddings, see "Embeddings" above) and exposes a `/`
healthcheck on port 3000.

`vite.config.ts` aliases the `ws` package (`resolve.alias`) to `src/lib/ws-stub.ts`. `@google/genai`
statically imports `ws` for its Node Live/streaming WebSocket transport, which this app never uses
(`structure.server.ts` only makes plain `generateContent` REST calls) — but in production that
import has intermittently ended up left as an unresolved runtime `import` (`Cannot find package
'ws'` at startup) instead of being bundled, seemingly sensitive to how the build's dependency
tracer treats `ws`'s optional native peer deps (`bufferutil`/`utf-8-validate`), and not reproducible
on demand locally. Aliasing to a stub removes the real `ws` package from the server module graph
entirely rather than chasing the bundler's externalization decision. If a feature ever needs the
real Gemini Live API, this alias must be revisited first.

`docker-compose.yml` on the VPS runs the published image behind an external Traefik reverse proxy
(joins a pre-existing external `web` network) and terminates TLS for the production domain
`comparatif.edgdconseil-pilotage.fr` (switched from an earlier domain in September 2026). Runtime
env vars — `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, etc. — come from a `.env` file that lives
on the host, outside this repo and outside version control.

## Lovable sync

This project is connected to Lovable (see [AGENTS.md](AGENTS.md)). Avoid force-pushing or
rewriting published git history (rebase/amend/squash of pushed commits) — it desyncs Lovable's
copy of the project history. Commits pushed to the connected branch sync back into the Lovable
editor.
