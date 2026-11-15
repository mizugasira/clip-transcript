import "server-only";
import { config } from "./config";

/**
 * サーバーレスワーカーを呼び出してキューを処理させる。
 * Next.js の after() から呼び、レスポンスを返した後に実行する（ブラウザは待たされない）。
 * ワーカーは処理が終わるまで応答しないため、最大実行時間（300秒）まで待つ。
 */
export async function triggerWorker(): Promise<void> {
  if (!config.workerUrl) return;
  if (!config.workerSecret) {
    console.error("WORKER_URL is set but WORKER_SECRET is empty");
    return;
  }
  try {
    const res = await fetch(`${config.workerUrl}/api/process`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.workerSecret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(295_000),
    });
    if (!res.ok) {
      console.error(`worker returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  } catch (e) {
    // タイムアウト等。ジョブは残っているので、次のポーリング時に再度呼び出される
    console.error("failed to trigger worker", e);
  }
}

export function isWorkerTriggerEnabled(): boolean {
  return Boolean(config.workerUrl);
}
