/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Package version injected via vite `define`; the per-build sha and time come from index.html
// (vite.config.ts · buildStampMeta, read by lib/buildInfo).
declare const __APP_VERSION__: string
