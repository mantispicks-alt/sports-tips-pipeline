// -------------------------------------------------------------------------
// Cloudflare Worker types. Minimal D1 surface declared locally so the Worker
// typechecks WITHOUT pulling @cloudflare/workers-types as a dependency.
// (fetch/Request/Response/URL come from the DOM lib already in tsconfig.)
// -------------------------------------------------------------------------

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  exec(query: string): Promise<unknown>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface Env {
  DB: D1Database;
  // Secrets (set via `wrangler secret put NAME`) — never hardcode:
  API_SPORTS_KEY?: string;
  THE_ODDS_API_KEY?: string;
  BZZOIRO_API_KEY?: string;
  FORESPORTIA_API_KEY?: string;
  HIGHLIGHTLY_API_KEY?: string;
  // Fine-grained GitHub PAT (Actions: read+write) used to trigger the
  // GitHub Actions pipeline every 2h via workflow_dispatch. Inert if unset.
  GH_DISPATCH_TOKEN?: string;
  // Shared secret gating /api/subscriptions (the admin billing tracker).
  // Callers pass it as ?k=… — no key set means the endpoint refuses every request.
  ADMIN_KEY?: string;
  // Vars (wrangler.jsonc):
  INGEST_ENABLED?: string; // "true" to let the cron ingest
  FIXTURE_LIMIT?: string; // cap fixtures/predictions per run (quota safety)
}
