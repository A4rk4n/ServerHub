import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Self-contained server bundle — the desktop shell spawns this directly,
  // which is what makes a single executable possible.
  output: "standalone",
  images: { unoptimized: true },
  // Server Hub uses Node's built-in `node:sqlite`, so Drizzle's static import of
  // the native `better-sqlite3` package is redirected to a stub (we always pass
  // our own adapted client). Keeps the packaged app free of native modules.
  turbopack: {
    resolveAlias: {
      "better-sqlite3": "./src/db/better-sqlite3-stub.ts",
    },
  },
};

export default nextConfig;
