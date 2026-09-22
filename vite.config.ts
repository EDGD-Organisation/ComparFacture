// Vanilla Vite config for TanStack Start — replaces the (now removed)
// @lovable.dev/vite-tanstack-config wrapper. That wrapper additionally wired up:
//   - TanStack devtools (dev-only) — dropped, see PR/commit notes: it would pull in
//     @tanstack/devtools-vite (not an existing dependency here) and, with it, a real `ws`
//     dependency for its own dev-time websocket server — optional dev tooling, not worth
//     reintroducing `ws` into the dependency tree for.
//   - Lovable-preview-specific dev plugins (SSR/server-fn error → custom Vite HMR events,
//     an asset proxy for the Lovable iframe, sandbox host/port detection) — all inert or
//     irrelevant outside Lovable's hosted sandbox, so dropped entirely rather than replicated.
// Everything else below (TanStack Start, Tailwind, tsconfig paths, Nitro, the `ws` stub alias)
// is preserved.
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig(async ({ command }) => {
  const plugins: PluginOption[] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      server: { entry: "server" },
    }),
  ];

  if (command === "build") {
    // nitro/vite defaults to targeting Cloudflare Workers when no preset is configured.
    // NITRO_PRESET=node-server (set by CI, the Dockerfile, and documented in README.md for
    // local builds) overrides this via Nitro's own env var — see CLAUDE.md's Deployment section.
    const { nitro } = await import("nitro/vite");
    plugins.push(nitro());
  }

  plugins.push(viteReact());

  return {
    // Matches this project's documented dev workflow (README.md): Vite tries 8080 first,
    // falling back to the next free port if it's taken.
    server: {
      host: "::",
      port: 8080,
    },
    resolve: {
      // Alias `ws` to a stub everywhere Vite itself resolves it (our server/client
      // bundles) — see src/lib/ws-stub.ts for why.
      alias: {
        ws: fileURLToPath(new URL("./src/lib/ws-stub.ts", import.meta.url)),
      },
      // Defensive: guards against duplicate React instances if a transitive dependency
      // ever resolves its own copy of react/react-dom.
      dedupe: ["react", "react-dom"],
    },
    plugins,
  };
});
