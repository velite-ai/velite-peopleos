import postgres from "postgres";

const globalForDb = globalThis as unknown as { veliteSql?: ReturnType<typeof postgres> };

export function db() {
  if (!globalForDb.veliteSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    globalForDb.veliteSql = postgres(url, {
      max: Number(process.env.DB_POOL_SIZE || 10),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: true,
      transform: { undefined: null },
    });
  }
  return globalForDb.veliteSql;
}

export type Sql = ReturnType<typeof postgres>;
