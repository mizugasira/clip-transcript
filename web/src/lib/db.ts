import "server-only";
import { Pool, type QueryResultRow } from "pg";

declare global {
  // 開発時のホットリロードで Pool が増えないよう globalThis に保持する
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL が設定されていません");
  }
  // DATABASE_SSL=no-verify: 証明書検証なしでSSL接続（Supabase等で証明書エラーになる場合の逃げ道）
  const ssl = process.env.DATABASE_SSL === "no-verify" ? { rejectUnauthorized: false } : undefined;
  return new Pool({ connectionString, ssl, max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
}

export function getPool(): Pool {
  if (!globalThis.__pgPool) globalThis.__pgPool = createPool();
  return globalThis.__pgPool;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}
