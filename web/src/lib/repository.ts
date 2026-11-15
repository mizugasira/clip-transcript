import "server-only";
import { query } from "./db";
import { fetchTwitchClip, type TwitchClip } from "./twitch";
import type { Clip, ClipPayload, JobInfo, JobStatus, Segment } from "./types";

interface ClipRow {
  id: string;
  url: string;
  embed_url: string;
  title: string;
  broadcaster_id: string;
  broadcaster_name: string;
  creator_name: string | null;
  game_id: string | null;
  language: string | null;
  thumbnail_url: string | null;
  duration_sec: number;
  clip_created_at: Date | null;
  video_id: string | null;
  vod_offset: number | null;
  detected_language: string | null;
  transcribed_at: Date | null;
  metadata_fetched_at: Date;
}

function toClip(r: ClipRow): Clip {
  return {
    id: r.id,
    url: r.url,
    embedUrl: r.embed_url,
    title: r.title,
    broadcasterId: r.broadcaster_id,
    broadcasterName: r.broadcaster_name,
    creatorName: r.creator_name,
    gameId: r.game_id,
    language: r.language,
    thumbnailUrl: r.thumbnail_url,
    durationSec: r.duration_sec,
    clipCreatedAt: r.clip_created_at?.toISOString() ?? null,
    videoId: r.video_id,
    vodOffset: r.vod_offset,
    detectedLanguage: r.detected_language,
    transcribedAt: r.transcribed_at?.toISOString() ?? null,
  };
}

async function getClipRow(clipId: string): Promise<ClipRow | null> {
  const rows = await query<ClipRow>("select * from clips where id = $1", [clipId]);
  return rows[0] ?? null;
}

export async function getClip(clipId: string): Promise<Clip | null> {
  const row = await getClipRow(clipId);
  return row ? toClip(row) : null;
}

/** Twitchのメタデータを clips に保存（既存なら更新。文字起こし結果は保持） */
export async function upsertClip(tc: TwitchClip): Promise<Clip> {
  const rows = await query<ClipRow>(
    `insert into clips (id, url, embed_url, title, broadcaster_id, broadcaster_name, creator_name,
                        game_id, language, thumbnail_url, duration_sec, clip_created_at, video_id, vod_offset,
                        metadata_fetched_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     on conflict (id) do update set
       url = excluded.url, embed_url = excluded.embed_url, title = excluded.title,
       broadcaster_id = excluded.broadcaster_id, broadcaster_name = excluded.broadcaster_name,
       creator_name = excluded.creator_name, game_id = excluded.game_id, language = excluded.language,
       thumbnail_url = excluded.thumbnail_url, duration_sec = excluded.duration_sec,
       clip_created_at = excluded.clip_created_at, video_id = excluded.video_id,
       vod_offset = excluded.vod_offset, metadata_fetched_at = now()
     returning *`,
    [
      tc.id,
      tc.url,
      tc.embed_url,
      tc.title,
      tc.broadcaster_id,
      tc.broadcaster_name,
      tc.creator_name || null,
      tc.game_id || null,
      tc.language || null,
      tc.thumbnail_url || null,
      tc.duration,
      tc.created_at || null,
      tc.video_id || null,
      tc.vod_offset ?? null,
    ],
  );
  return toClip(rows[0]);
}

/**
 * vod_offset はクリップ作成から数分遅れて反映されることがある（Twitch公式ドキュメント記載）。
 * VODがあるのに offset 未反映で、前回取得から一定時間経っていればメタデータを取り直す。
 */
async function refreshVodOffsetIfStale(row: ClipRow): Promise<ClipRow> {
  const STALE_MS = 5 * 60_000;
  if (!row.video_id || row.vod_offset !== null) return row;
  if (Date.now() - row.metadata_fetched_at.getTime() < STALE_MS) return row;
  try {
    const tc = await fetchTwitchClip(row.id);
    if (!tc) return row;
    await upsertClip(tc);
    return (await getClipRow(row.id)) ?? row;
  } catch {
    return row; // 取り直しに失敗しても表示は続ける
  }
}

interface JobRow {
  status: JobStatus;
  error: string | null;
  updated_at: Date;
}

export async function getLatestJob(clipId: string): Promise<JobInfo | null> {
  const rows = await query<JobRow>(
    "select status, error, updated_at from jobs where clip_id = $1 order by created_at desc, id desc limit 1",
    [clipId],
  );
  const r = rows[0];
  return r ? { status: r.status, error: r.error, updatedAt: r.updated_at.toISOString() } : null;
}

export async function getActiveJob(clipId: string): Promise<JobInfo | null> {
  const job = await getLatestJob(clipId);
  return job && ["queued", "fetching", "transcribing"].includes(job.status) ? job : null;
}

export async function getSegments(clipId: string): Promise<Segment[]> {
  const rows = await query<{ start_sec: number; end_sec: number; text: string }>(
    "select start_sec, end_sec, text from segments where clip_id = $1 order by idx",
    [clipId],
  );
  return rows.map((r) => ({ start: r.start_sec, end: r.end_sec, text: r.text }));
}

export async function getClipPayload(clipId: string): Promise<ClipPayload> {
  let row = await getClipRow(clipId);
  if (!row) return { clip: null, job: null, segments: [] };
  row = await refreshVodOffsetIfStale(row);
  const [job, segments] = await Promise.all([
    getLatestJob(clipId),
    row.transcribed_at ? getSegments(clipId) : Promise.resolve([]),
  ]);
  return { clip: toClip(row), job, segments };
}

/**
 * 止まったジョブの片付け（サーバーレス構成では常駐プロセスが無いため、閲覧時に行う）。
 *  - 処理中のまま staleMinutes 以上更新が無い → 失敗（ワーカーが途中で強制終了した等）
 *  - 待機中のまま queuedMinutes 以上経過 → 失敗（ワーカーが動いていない等）
 */
export async function failStuckJobs(clipId: string, staleMinutes: number, queuedMinutes: number): Promise<void> {
  await query(
    `update jobs set status = 'failed', finished_at = now(), updated_at = now(),
            error = case when status = 'queued'
                         then '処理が開始されませんでした。再試行してください'
                         else '処理がタイムアウトしました。再試行してください' end
      where clip_id = $1
        and ((status in ('fetching','transcribing') and updated_at < now() - make_interval(secs => $2))
          or (status = 'queued' and created_at < now() - make_interval(secs => $3)))`,
    [clipId, staleMinutes * 60, queuedMinutes * 60],
  );
}

/**
 * 待機中のまま afterSec 秒以上経ったジョブがあれば、そのジョブの時刻を更新して true を返す。
 * （ワーカー呼び出しの取りこぼし対策。時刻を更新するので再呼び出しは afterSec 秒に1回まで）
 */
export async function claimRetrigger(clipId: string, afterSec: number): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update jobs set updated_at = now()
      where clip_id = $1 and status = 'queued' and updated_at < now() - make_interval(secs => $2)
      returning id`,
    [clipId, afterSec],
  );
  return rows.length > 0;
}

/** 新しいジョブを登録。同じクリップの処理中ジョブが既にあれば作らない（部分ユニークインデックス） */
export async function enqueueJob(clipId: string, requesterHash: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `insert into jobs (clip_id, status, requester_hash) values ($1, 'queued', $2)
     on conflict (clip_id) where status in ('queued','fetching','transcribing') do nothing
     returning id`,
    [clipId, requesterHash],
  );
  return rows.length > 0;
}

export async function countRecentJobs(requesterHash: string): Promise<number> {
  const rows = await query<{ n: string }>(
    "select count(*) as n from jobs where requester_hash = $1 and created_at > now() - interval '1 hour'",
    [requesterHash],
  );
  return Number(rows[0]?.n ?? 0);
}

/** 今月の文字起こしコスト（確定分 + 処理待ちの見積もり） */
export async function monthlySpendUsd(pricePerMinuteUsd: number): Promise<number> {
  const rows = await query<{ spent: string | null; pending_sec: number | null }>(
    `select
       (select coalesce(sum(cost_usd), 0) from jobs
         where status = 'done' and finished_at >= date_trunc('month', now())) as spent,
       (select coalesce(sum(c.duration_sec), 0) from jobs j join clips c on c.id = j.clip_id
         where j.status in ('queued','fetching','transcribing')) as pending_sec`,
  );
  const spent = Number(rows[0]?.spent ?? 0);
  const pendingSec = Number(rows[0]?.pending_sec ?? 0);
  return spent + (pendingSec / 60) * pricePerMinuteUsd;
}
