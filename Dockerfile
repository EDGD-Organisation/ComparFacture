# syntax=docker/dockerfile:1

# Native deps (onnxruntime-node, sharp) must be resolved/traced inside this
# Linux image, not copied from a host build — see CLAUDE.md "Embeddings".
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY . .

# Public/publishable values only (never service-role/API secrets) — these
# get inlined into the client bundle by Vite and are safe to bake in.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY} \
    VITE_SUPABASE_PROJECT_ID=${VITE_SUPABASE_PROJECT_ID}

# nitro/vite (wired up in vite.config.ts) targets Cloudflare Workers by default when no
# preset is set; force a plain Node server build for our own Docker/Traefik deployment.
ENV NITRO_PRESET=node-server
RUN bun run build

# onnxruntime-node (local embeddings, see @huggingface/transformers in CLAUDE.md "Embeddings")
# loads its native binary, and some of its own dependencies (onnxruntime-common, adm-zip,
# global-agent, ...), via createRequire(import.meta.url)(...) indirections that Nitro's
# build-time dependency tracer doesn't follow (same blind spot class as the `ws` package, see
# vite.config.ts) — so `.output/server`'s own traced node_modules can't be trusted to carry the
# full, correct dependency closure for this one package. A plain `bun install --production` (no
# devDependencies) resolves that closure correctly via bun's real resolver instead of a static
# tracer, so we ship it wholesale as a fallback underneath .output/server's own node_modules.
FROM oven/bun:1 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# onnxruntime-node (local embeddings) needs libgomp at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/.output ./.output
COPY --from=prod-deps /app/node_modules ./node_modules

ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
