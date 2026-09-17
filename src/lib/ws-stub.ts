// Aliased in for `ws` in the Nitro/server build (see vite.config.ts). `@google/genai`
// statically imports `ws` for its Node Live-API (streaming) WebSocket transport, which this
// app never uses — structure.server.ts only makes plain REST `generateContent` calls. In
// production that static import has intermittently ended up left as an unresolved runtime
// import ("Cannot find package 'ws'") instead of being bundled, apparently depending on how
// the tracer/bundler reacts to ws's optional native peers (bufferutil/utf-8-validate) — see
// CLAUDE.md "Deployment & CI/CD". Aliasing the specifier to this stub sidesteps that
// entirely: there is no real `ws` package left in the server module graph to trace or
// externalize.
export class WebSocket {
  constructor() {
    throw new Error(
      "ws is stubbed out in this build — the Gemini Live API is not used (see src/lib/ws-stub.ts).",
    );
  }
}

export default WebSocket;
