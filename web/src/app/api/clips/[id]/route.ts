import { after, NextResponse } from "next/server";
import { isValidClipId } from "@/lib/clipUrl";
import { config } from "@/lib/config";
import { claimRetrigger, failStuckJobs, getClipPayload } from "@/lib/repository";
import { isWorkerTriggerEnabled, triggerWorker } from "@/lib/trigger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** クリップ情報・最新ジョブの状態・文字起こし結果を返す（ブラウザが数秒ごとにポーリングする） */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isValidClipId(id)) {
    return NextResponse.json({ error: "invalid_id", message: "不正なクリップIDです" }, { status: 400 });
  }
  try {
    await failStuckJobs(id, config.staleJobMinutes, config.queuedTimeoutMinutes);
    // ワーカー呼び出しの取りこぼし対策: 待機中のまま時間が経っていたら呼び直す
    if (isWorkerTriggerEnabled() && (await claimRetrigger(id, config.retriggerAfterSec))) {
      after(triggerWorker);
    }
    const payload = await getClipPayload(id);
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("GET /api/clips/[id] failed", e);
    return NextResponse.json({ error: "server_error", message: "読み込みに失敗しました" }, { status: 500 });
  }
}
