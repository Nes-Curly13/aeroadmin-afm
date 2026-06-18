import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __afmPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  const useSsl = process.env.DATABASE_SSL === "true";

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });
}

export function getDb() {
  if (!global.__afmPool) {
    global.__afmPool = createPool();
  }

  return global.__afmPool;
}
