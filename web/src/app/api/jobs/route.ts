import { after, NextResponse } from "next/server";
import { isValidClipId, parseClipUrl } from "@/lib/clipUrl";
import { config } from "@/lib/config";
import {
  countRecentJobs,
  enqueueJob,
  getActiveJob,
  getClip,
  monthlySpendUsd,
  upsertClip,
} from "@/lib/repository";
import { requesterHash } from "@/lib/requester";
import { triggerWorker } from "@/lib/trigger";
import { fetchTwitchClip, TwitchConfigError } from "@/lib/twitch";

export const dynamic = "force-dynamic";
// after() でワーカーの完了を待つため、関数の最大実行時間を確保する（Vercel Hobby の上限は300秒）
export const maxDuration = 300;

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: code, message }, { status });
}

/**
 * 文字起こしジョブの登録。
 * body: { url: string } または { clipId: string }（結果ページからの開始・再試行用）
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { url?: unknown; clipId?: unknown } | null;
  const clipId =
    body?.clipId !== undefined ? (isValidClipId(body.clipId) ? body.clipId : null) : parseClipUrl(body?.url);
  if (!clipId) {
    return error(400, "invalid_url", "TwitchクリップのURLとして認識できませんでした");
  }

  try {
    // F-08: 文字起こし済みならキャッシュを返す
    const existing = await getClip(clipId);
    if (existing?.transcribedAt) {
      return NextResponse.json({ clipId, status: "done", cached: true });
    }
    const active = await getActiveJob(clipId);
    if (active) {
      return NextResponse.json({ clipId, status: active.status });
    }

    // 不正利用対策: IP単位のレート制限
    const hash = requesterHash(req.headers);
    if ((await countRecentJobs(hash)) >= config.rateLimitPerHour) {
      return error(429, "rate_limited", `文字起こしの登録は1時間あたり${config.rateLimitPerHour}本までです`);
    }

    // 月の上限額を超えていたら受付停止
    if (config.monthlyBudgetUsd > 0 && (await monthlySpendUsd(config.pricePerMinuteUsd)) >= config.monthlyBudgetUsd) {
      return error(503, "budget_exceeded", "今月の処理上限に達したため、新しい文字起こしの受付を停止しています");
    }

    // F-02: クリップ情報の取得（存在確認を兼ねる）
    const tc = await fetchTwitchClip(clipId);
    if (!tc) {
      return error(404, "clip_not_found", "クリップが見つかりません（削除済み、または非公開の可能性があります）");
    }
    const clip = await upsertClip(tc);
    if (clip.durationSec > config.maxClipSeconds) {
      return error(400, "too_long", `${config.maxClipSeconds}秒を超える動画は受け付けていません`);
    }

    await enqueueJob(clipId, hash);
    // サーバーレスワーカーを使う構成では、レスポンスを返した後にワーカーを呼び出す
    after(triggerWorker);
    const job = await getActiveJob(clipId);
    return NextResponse.json({ clipId, status: job?.status ?? "queued" }, { status: 202 });
  } catch (e) {
    if (e instanceof TwitchConfigError) {
      console.error(e);
      return error(500, "server_misconfigured", "サーバーの設定に問題があります");
    }
    console.error("POST /api/jobs failed", e);
    return error(502, "upstream_error", e instanceof Error ? e.message : "処理に失敗しました");
  }
}
