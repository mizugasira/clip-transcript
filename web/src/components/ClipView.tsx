"use client";

import { useCallback, useEffect, useState } from "react";
import { addHistory } from "@/lib/history";
import { EXPORT_FORMATS, formatTimestamp, toPlainText, toTimestampedText } from "@/lib/format";
import type { ClipPayload, JobStatus } from "@/lib/types";
import { VodPlayer, type SeekTarget } from "./VodPlayer";

const POLL_MS = 2000;
const ACTIVE: JobStatus[] = ["queued", "fetching", "transcribing"];

type Phase = "unprocessed" | "processing" | "failed" | "done";

function phaseOf(p: ClipPayload): Phase {
  if (p.clip?.transcribedAt) return "done";
  if (p.job && ACTIVE.includes(p.job.status)) return "processing";
  if (p.job?.status === "failed") return "failed";
  return "unprocessed";
}

export function ClipView({ clipId, initial }: { clipId: string; initial: ClipPayload }) {
  const [payload, setPayload] = useState<ClipPayload>(initial);
  const [host, setHost] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [mode, setMode] = useState<"clip" | "vod">("clip");
  const [seek, setSeek] = useState<SeekTarget | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const phase = phaseOf(payload);
  const { clip, job, segments } = payload;

  // Twitch埋め込みの parent には表示中のドメインを指定する必要がある
  useEffect(() => setHost(window.location.hostname), []);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/clips/${encodeURIComponent(clipId)}`, { cache: "no-store" });
    if (res.ok) setPayload((await res.json()) as ClipPayload);
  }, [clipId]);

  // F-05: 処理中は数秒ごとに状態を問い合わせる
  useEffect(() => {
    if (phase !== "processing") return;
    const t = setInterval(() => {
      refresh().catch(() => {
        /* 一時的な通信失敗は次回のポーリングで回復させる */
      });
    }, POLL_MS);
    return () => clearInterval(t);
  }, [phase, refresh]);

  const clipKey = clip ? { id: clip.id, title: clip.title, broadcasterName: clip.broadcasterName } : null;
  const clipKeyJson = clipKey ? JSON.stringify(clipKey) : null;
  useEffect(() => {
    if (clipKeyJson) addHistory(JSON.parse(clipKeyJson));
  }, [clipKeyJson]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) setStartError(json.message ?? `登録に失敗しました (HTTP ${res.status})`);
      await refresh();
    } catch {
      setStartError("通信に失敗しました");
    } finally {
      setStarting(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast(`${label}をコピーしました`);
    } catch {
      setToast("コピーできませんでした");
    }
  }

  // F-06: 元VODがあり位置が分かっている場合のみ秒数ジャンプ可能
  const canSeek = Boolean(clip?.videoId && clip.vodOffset !== null);

  function onLineClick(idx: number, startSec: number) {
    if (!clip || !canSeek) return;
    setActiveIdx(idx);
    setMode("vod");
    setSeek((prev) => ({ sec: (clip.vodOffset ?? 0) + startSec, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  return (
    <>
      {clip ? (
        <section className="card">
          {canSeek && seek ? (
            <div className="player-tabs" role="group" aria-label="プレーヤー切り替え">
              <button type="button" className="btn" aria-pressed={mode === "clip"} onClick={() => setMode("clip")}>
                クリップ
              </button>
              <button type="button" className="btn" aria-pressed={mode === "vod"} onClick={() => setMode("vod")}>
                元VOD
              </button>
            </div>
          ) : null}
          <div className="player-wrap">
            {host && mode === "clip" ? (
              <iframe
                src={`${clip.embedUrl}${clip.embedUrl.includes("?") ? "&" : "?"}parent=${encodeURIComponent(host)}&autoplay=false`}
                title={clip.title}
                allowFullScreen
              />
            ) : null}
            {host && mode === "vod" && clip.videoId && seek ? (
              <VodPlayer videoId={clip.videoId} parent={host} target={seek} />
            ) : null}
          </div>
          <div className="clip-meta">
            <h1>{clip.title}</h1>
            <div className="sub">
              {clip.broadcasterName}
              {clip.clipCreatedAt ? ` ・ ${new Date(clip.clipCreatedAt).toLocaleDateString("ja-JP")}` : ""}
              {` ・ ${Math.round(clip.durationSec)}秒`}
              {" ・ "}
              <a href={clip.url} target="_blank" rel="noopener noreferrer">
                Twitchで元クリップを見る
              </a>
            </div>
          </div>
        </section>
      ) : (
        <section className="card">
          <h1>クリップ {clipId}</h1>
          <p className="muted">このクリップはまだ文字起こしされていません。</p>
        </section>
      )}

      <section className="card">
        <h2>文字起こし</h2>

        {phase === "processing" && job ? <Progress status={job.status} /> : null}

        {phase === "failed" ? (
          <>
            <div className="error-box" role="alert">
              文字起こしに失敗しました：{job?.error ?? "不明なエラー"}
            </div>
            <button type="button" className="btn btn-primary" onClick={start} disabled={starting}>
              {starting ? "登録中…" : "再試行"}
            </button>
          </>
        ) : null}

        {phase === "unprocessed" ? (
          <button type="button" className="btn btn-primary" onClick={start} disabled={starting}>
            {starting ? "登録中…" : "文字起こしする"}
          </button>
        ) : null}

        {startError ? (
          <p className="field-error" role="alert">
            {startError}
          </p>
        ) : null}

        {phase === "done" && clip ? (
          <>
            <div className="toolbar">
              <button type="button" className="btn" onClick={() => copy(toPlainText(segments), "全文")}>
                全文コピー
              </button>
              <button type="button" className="btn" onClick={() => copy(toTimestampedText(segments), "時刻付きテキスト")}>
                時刻付きでコピー
              </button>
              {EXPORT_FORMATS.map((f) => (
                <a
                  key={f.format}
                  className="btn"
                  style={{ textDecoration: "none" }}
                  href={`/api/clips/${encodeURIComponent(clip.id)}/export?format=${f.format}`}
                  download
                >
                  {f.label}
                </a>
              ))}
              {toast ? (
                <span className="toast" role="status">
                  {toast}
                </span>
              ) : null}
            </div>

            <p className="notice">
              {canSeek
                ? "行をクリックすると、元VODの該当秒数から再生します。"
                : clip.videoId
                  ? "元VODの位置情報がまだ反映されていないため、秒数ジャンプは利用できません（数分後に再読み込みしてください）。"
                  : "元VODが無い（削除済み等）ため、秒数ジャンプは利用できません。"}
            </p>

            {segments.length === 0 ? (
              <p className="muted">発言は検出されませんでした。</p>
            ) : (
              <ol className="transcript">
                {segments.map((s, i) => (
                  <li key={i}>
                    {canSeek ? (
                      <button
                        type="button"
                        className={`line${activeIdx === i ? " active" : ""}`}
                        onClick={() => onLineClick(i, s.start)}
                      >
                        <span className="ts">{formatTimestamp(s.start)}</span>
                        <span className="txt">{s.text}</span>
                      </button>
                    ) : (
                      <div className="line">
                        <span className="ts">{formatTimestamp(s.start)}</span>
                        <span className="txt">{s.text}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : null}
      </section>
    </>
  );
}

const STEPS: { key: string; label: string; statuses: JobStatus[] }[] = [
  { key: "fetch", label: "取得中", statuses: ["queued", "fetching"] },
  { key: "transcribe", label: "文字起こし中", statuses: ["transcribing"] },
  { key: "done", label: "完了", statuses: ["done"] },
];

function Progress({ status }: { status: JobStatus }) {
  const currentIdx = STEPS.findIndex((s) => s.statuses.includes(status));
  return (
    <div role="status" aria-live="polite">
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i < currentIdx ? "done" : i === currentIdx ? "current" : ""}>
            {s.label}
          </li>
        ))}
      </ol>
      <p className="muted" style={{ margin: 0 }}>
        <span className="spinner" aria-hidden />
        {status === "queued" ? "順番待ちです…" : status === "fetching" ? "音声を取得しています…" : "文字に起こしています…"}
      </p>
    </div>
  );
}
