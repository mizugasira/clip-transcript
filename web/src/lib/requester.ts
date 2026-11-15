import "server-only";
import { createHash } from "node:crypto";
import { config } from "./config";

/**
 * リクエスト元IPを取得してハッシュ化する（生IPはDBに保存しない）。
 * Vercel等のプロキシ配下では x-forwarded-for の先頭がクライアントIP。
 * ※プロキシを介さず直接公開する場合、x-forwarded-for は偽装可能なので注意。
 */
export function requesterHash(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${config.ipHashSalt}:${ip}`).digest("hex").slice(0, 32);
}
