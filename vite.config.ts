// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      // Alias `ws` to a stub everywhere Vite itself resolves it (our server/client
      // bundles) — see src/lib/ws-stub.ts for why. TanStack Devtools' own, dev-only,
      // genuinely-used `ws` websocket server runs as plain Node code inside the vite
      // plugin itself, resolved by Node — not through Vite's resolver — so it's
      // unaffected by this alias.
      alias: {
        ws: fileURLToPath(new URL("./src/lib/ws-stub.ts", import.meta.url)),
      },
    },
  },
});
