import "server-only";

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  /** IPあたり1時間に登録できる文字起こしジョブ数（キャッシュヒットは数えない） */
  rateLimitPerHour: num("RATE_LIMIT_PER_HOUR", 10),
  /** これより長いクリップは拒否する（秒） */
  maxClipSeconds: num("MAX_CLIP_SECONDS", 90),
  /** 月の文字起こしコスト上限（USD）。0以下で無制限 */
  monthlyBudgetUsd: num("MONTHLY_BUDGET_USD", 10),
  /** 受付時の見積もりに使う1分あたりの単価（USD）。実費は worker が記録する */
  pricePerMinuteUsd: num("TRANSCRIBE_PRICE_PER_MINUTE_USD", 0.006),
  ipHashSalt: process.env.IP_HASH_SALT ?? "",
  /**
   * サーバーレスワーカー（worker/app.py を Vercel にデプロイしたもの）のURL。
   * 未設定なら呼び出さない（常駐ワーカーが jobs 表をポーリングする構成）。
   */
  workerUrl: (process.env.WORKER_URL ?? "").replace(/\/+$/, ""),
  workerSecret: process.env.WORKER_SECRET ?? "",
  /** 処理中のまま更新が止まったジョブを失敗扱いにするまでの分数（Vercelの最大実行は5分） */
  staleJobMinutes: num("STALE_JOB_MINUTES", 6),
  /** 待機中のまま放置されたジョブを失敗扱いにするまでの分数 */
  queuedTimeoutMinutes: num("QUEUED_TIMEOUT_MINUTES", 10),
  /** 待機中のジョブがこの秒数を超えたら、ワーカーの呼び出しを再試行する */
  retriggerAfterSec: num("RETRIGGER_AFTER_SEC", 15),
};
