# Handoff — 2026-10-07 (rôles commercial/expert ajoutés)

Working notes for whoever (human or agent) picks this project up next. This is a point-in-time
status snapshot, not permanent documentation — **CLAUDE.md stays the authoritative technical
reference** (architecture, pipeline, conventions); this file only covers what changed recently and
what's still open. Delete or replace it once it's stale.

## Repo state right now

- Branch `develop` and `main` are both at commit `750f659` ("Normalize line endings and cleanup
  formatting"), already pushed. Latest CI run, Docker build, and deploy all **succeeded**
  (verified via the GitHub Actions API — this repo is public, so `curl
  https://api.github.com/repos/EDGD-Organisation/ComparFacture/actions/runs` works without a
  token).
- No uncommitted changes of substance (only `.claude/settings.json`, which is the harness's own
  auto-logged bash-permission allowlist, not app code).
- User (`jack0237`) commits and pushes themselves once a fix is explained/verified — don't assume
  you need to do it, but don't assume it's been skipped either; check `git log`/`git status`
  before acting on "this is still broken" type reports, since the fix may already be live.

## What changed in this work cycle, roughly chronological

1. **"Unité de négo + nom du fournisseur" column** added across the invoice comparison tables.
2. **ERP sync bug fix**: `catalog_products.unit` wasn't being populated from the ERP sync — fixed
   field mapping in `src/lib/catalog.functions.ts` (`weight`, not `order_unit` — see CLAUDE.md
   "Ozego identifiers" for the full story, including why `order_unit` looks tempting but is wrong).
3. **Column rename**: "Ligne facture" → "Désignation fournisseur" everywhere in
   `src/routes/factures.$id.tsx`.
4. **Gap color-coding bug fix** in `src/routes/comparatifs.$id.tsx`: three spots had the
   écart/gap color convention inverted relative to `factures.$id.tsx` (positive gap = overpaying =
   should be red/`text-destructive`, not green). Also relabeled "Meilleurs gains" →
   "Lignes les plus coûteuses" since it was showing the biggest overpayments mislabeled as gains.
5. **Soft-delete for invoice lines** ("Supprimer la ligne" trash icon, all 4 comparison tabs) —
   `invoice_lines.excluded` boolean column
   (`supabase/migrations/20260921120000_add_invoice_lines_excluded_flag.sql`), filtered out at the
   query level everywhere (including the prospect-level aggregate in `comparatifs.$id.tsx`).
   **Migration confirmed applied to the remote DB** (verified via direct REST query just now).
6. **Filter toolbar** on the invoice detail page (`factures.$id.tsx`): free-text search
   (reference/label, accent- and case-insensitive) + a "Toutes / Validées / Non validées" status
   select. Only changes which rows render — KPI totals and the 3 Excel exports still use the full,
   unfiltered line set on purpose.
7. **"Voir le fichier original"** button (invoice list in `comparatifs.$id.tsx`, and the invoice
   detail header in `factures.$id.tsx`) — generates a short-lived Supabase Storage signed URL and
   opens the original PDF/scan in a new tab. No new storage infra needed — Supabase Storage is
   already S3-compatible and the `invoices` bucket already existed.
8. **Cascading validation lock** across the 4 comparison pages (Comparatif référence fournisseur →
   Ozego Même fournisseur → Ozego Autres fournisseurs → Ozego Fournisseurs préférés, in that fixed
   order): once a line is validated at one stage, it becomes read-only on every *later* stage, but
   each stage can still validate its own not-yet-validated lines. Tracked via
   `invoice_lines.validated_stage`
   (`supabase/migrations/20260922090000_add_invoice_lines_validated_stage.sql`), logic in
   `isLineLocked`/`STAGE_ORDER` in `factures.$id.tsx`. **Migration confirmed applied to the remote
   DB.** The "Supprimer la ligne" delete action is deliberately *not* gated by this lock (deleting
   isn't "modifying" the validated data) — flagged to the user as a judgment call, no objection
   raised.
9. **Removed everything Lovable-related** (the user confirmed the Supabase project is their own,
   never Lovable-provisioned, and the app is no longer edited via Lovable's platform): dropped the
   `@lovable.dev/vite-tanstack-config` npm dependency (replaced with vanilla Vite config wiring
   TanStack Start's own official plugin + React + Tailwind + Nitro directly — **kept TanStack
   Start itself**, which is an independent framework unrelated to Lovable, after the user asked
   about removing it too and I talked through why that'd be a much bigger, separate rewrite),
   regenerated `bun.lock` off the public npm registry (it had been pointing several unrelated
   packages at a private Lovable registry mirror), deleted Lovable-preview-only dead code
   (`lovable-error-reporting.ts`, `previewAuthStorage.ts` — both were no-ops outside Lovable's own
   iframe), `.lovable/` → `docs/plan/`, removed `AGENTS.md`, scrubbed docs/comments.
10. **Production bug, two rounds**: `Cannot find module 'onnxruntime-node'` then (after a too-narrow
    first fix) `Cannot find module 'onnxruntime-common'` at runtime. Root cause: Nitro's build-time
    dependency tracer doesn't follow the `createRequire(import.meta.url)(...)` indirection
    `@huggingface/transformers` uses to load the ONNX native binding, so `.output/server`'s
    self-traced `node_modules` silently missed it (and its own sub-dependencies). **Final fix**
    (Dockerfile): a dedicated `prod-deps` build stage runs a real `bun install --production` (bun's
    actual resolver, not a static tracer) and that complete `node_modules` is copied into the
    runtime image wholesale, as a fallback underneath whatever Nitro did manage to trace. Verified
    by replicating the exact runtime file layout locally and requiring the real package chain
    end-to-end — not just reasoning about it.
11. **CI "quality" job fix**: had been failing since 2026-09-22 across several commits (unrelated
    to the onnxruntime work) — initially assumed to be the known pre-existing CRLF noise, but that
    was a red herring (confirmed the actual committed git blobs were already clean LF). Real cause:
    6 genuine prettier formatting violations introduced earlier in `factures.$id.tsx` and
    `vite.config.ts` from hand-wrapping long lines instead of running the formatter. Fixed via
    targeted `eslint --fix`. Also added `.gitattributes` (`* text=auto eol=lf`) so the long-standing
    local Windows CRLF lint noise (documented in CLAUDE.md) stops recurring and stops being a
    red herring in future debugging.

12. **Nettoyage post-incident** (2026-10-07): secrets retirés de `settings.local.json`, image Docker allégée
    (voir Open items).

13. **Authentification + rôles commercial/expert** (2026-10-07, code écrit, **migration pas encore appliquée**):
    connexion email/mot de passe (`/connexion`), rôles `commercial` (crée des comparatifs + upload de
    factures, voit liste/statuts) et `expert` (= administrateur: tout, y compris rapprochement, catalogue, réglages,
    page `/utilisateurs` pour créer les comptes). Migration
    `supabase/migrations/20261007140000_add_roles_and_lock_down_rls.sql` (table `profiles`,
    `prospects.created_by`, remplace toutes les politiques RLS `open_*`). Server functions protégées
    par `requireSupabaseAuth` + `requireRole`; `serverSupabase()` passe sur le client service-role.
    Détails dans CLAUDE.md, section "Authentication & roles". `tsc` et `vite build` passent; non
    testé en conditions réelles (pas de Docker local).

## Open items for the next agent

- **Migration de renommage des rôles** (`20261008100000_rename_roles_expert_commercial.sql`): la
  migration `20261007140000` a déjà été exécutée par l'utilisateur avec les anciens noms
  (admin/expert); celle-ci les convertit (admin -> expert, expert -> commercial) et recrée
  fonctions + politiques. **À exécuter dans le SQL Editor** (ne pas rejouer `20261007140000`).
  Si le compte ozego@gmail.com a déjà été inséré avec le rôle `admin`, il devient `expert`
  automatiquement; sinon utiliser la requête ci-dessous avec le rôle `expert`.
- **À FAIRE pour mettre l'auth en service (dans cet ordre)**:
  1. Créer le premier compte expert dans Supabase Studio (Authentication > Users > Add user, email +
     mot de passe, "Auto confirm").
  2. Coller et exécuter la migration `20261007140000_add_roles_and_lock_down_rls.sql` dans le SQL
     Editor (dès cet instant, l'app actuelle sans connexion ne fonctionne plus).
  3. Donner le rôle expert à ce compte:
     `INSERT INTO public.profiles (user_id, email, role) SELECT id, email, 'expert' FROM auth.users WHERE email = 'ozego@gmail.com';`
  4. Déployer le code (merge sur `main`). Vérifier que `SUPABASE_SERVICE_ROLE_KEY` est bien dans le
     `.env` du VPS (déjà utilisé par la synchro ERP), puis tester: connexion expert, création d'un
     compte commercial depuis `/utilisateurs`, connexion commercial (upload OK, pas d'accès au reste).
  5. Régénérer `types.ts` (`bunx supabase gen types typescript --project-id ...`): `profiles` et
     `prospects.created_by` y ont été ajoutés à la main en attendant.
- **Sécurité**: le Storage et les RPC (`search_catalog`, `cheapest_by_ozego`...) ne sont plus
  accessibles sans rôle; en local, `.env.local` doit contenir `SUPABASE_SERVICE_ROLE_KEY`.
- **Plus tard**: restreindre les commerciaux à leurs propres comparatifs (voir CLAUDE.md).

- **Factures bloquées en `processing`**: résolu (confirmé par l’utilisateur le 2026-10-07).
- **Secrets dans `.claude/settings.local.json`**: les 16 entrées d’allowlist contenant des clés (anon, service-role,
  `x-api-key` myozego) ont été supprimées du fichier le 2026-10-07 (gitignoré). Décision de l’utilisateur: pas de
  rotation, simple suppression.
- **Image Docker**: le stage `prod-deps` du `Dockerfile` supprime maintenant les binaires natifs
  `onnxruntime-node` darwin/win32/linux-arm64 (garde seulement `linux/x64`, ~220MB de moins). Logique du `find`
  simulée localement; **pas encore validée par un vrai `docker build`** (Docker non lancé) — à vérifier au prochain
  run de la CI/déploiement (le conteneur doit démarrer et charger `onnxruntime-node`).
- **Favicon**: `public/favicon.ico` toujours absent — l’utilisateur s’en occupera plus tard.
- **Pre-existing, not touched**: `syncCatalogFromErp` in `catalog.functions.ts` has parsing logic that should
  arguably live in `catalog.server.ts`, and skips some zod validation.

## Things worth knowing before you touch anything

- **No Claude co-author line in commits for this repo/session** — the user explicitly asked for
  this early in the work cycle (standing instruction, not a one-off).
- **DB migrations can't be applied by Claude directly** — no `SUPABASE_ACCESS_TOKEN` or DB
  password exists anywhere in this environment, and local Docker Desktop isn't running either. Any
  new migration needs the user to paste the SQL into Supabase Studio's SQL Editor themselves. Give
  them the exact SQL, don't just say "run the migration."
- **`supabase/migrations/20260824094934_*.sql`** has a known, deliberate, never-fixed syntax typo
  — don't touch it, see CLAUDE.md "Local database (Docker)".
- **`.claude/settings.local.json`** contains real plaintext secrets (gitignored, never commit it).
- Docker Desktop has not been running in this environment at any point in this work cycle — Docker
  build fixes were verified by replicating the runtime file layout and module resolution locally,
  not by an actual `docker build`. Worth a real container build/run next time Docker is available.
