/**
 * Build-time stub for `better-sqlite3`.
 *
 * Drizzle's `drizzle-orm/better-sqlite3` entrypoint statically imports the
 * native `better-sqlite3` package, but we pass our own `node:sqlite`-backed
 * client to `drizzle()` and never construct the native client. Next.js aliases
 * this module over the real one (see next.config.ts) so the bundler resolves
 * without shipping a native dependency.
 */
export default class BetterSqlite3Stub {
  constructor() {
    throw new Error("better-sqlite3 stub: Server Hub uses node:sqlite instead");
  }
}
