import type { Clip, Segment } from "./types";

/** 行一覧用: 12.3 → "00:12"、3725 → "1:02:05" */
export function formatTimestamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** SRT用: 12.345 → "00:00:12,345" */
export function formatSrtTime(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/** Twitch VODプレーヤーの time パラメータ形式: 3725 → "1h2m5s" */
export function formatTwitchTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h${m}m${s}s`;
}

export function toPlainText(segments: Segment[]): string {
  return segments.map((s) => s.text).join("\n");
}

export function toTimestampedText(segments: Segment[]): string {
  return segments.map((s) => `${formatTimestamp(s.start)} ${s.text}`).join("\n");
}

export function toSrt(segments: Segment[]): string {
  return (
    segments
      .map((s, i) => {
        // 終了が開始以前になっている壊れたセグメントは最低0.5秒表示する
        const end = s.end > s.start ? s.end : s.start + 0.5;
        return `${i + 1}\n${formatSrtTime(s.start)} --> ${formatSrtTime(end)}\n${s.text}\n`;
      })
      .join("\n")
  );
}

export function toJson(clip: Clip, segments: Segment[]): string {
  return JSON.stringify(
    {
      clip: {
        id: clip.id,
        url: clip.url,
        title: clip.title,
        broadcaster: clip.broadcasterName,
        createdAt: clip.clipCreatedAt,
        durationSec: clip.durationSec,
        videoId: clip.videoId,
        vodOffset: clip.vodOffset,
        language: clip.detectedLanguage,
      },
      segments: segments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
    },
    null,
    2,
  );
}

export type ExportFormat = "txt" | "txt-plain" | "srt" | "json";

export const EXPORT_FORMATS: { format: ExportFormat; label: string; ext: string; mime: string }[] = [
  { format: "txt", label: "TXT（時刻あり）", ext: "txt", mime: "text/plain" },
  { format: "txt-plain", label: "TXT（時刻なし）", ext: "txt", mime: "text/plain" },
  { format: "srt", label: "SRT", ext: "srt", mime: "application/x-subrip" },
  { format: "json", label: "JSON", ext: "json", mime: "application/json" },
];

export function renderExport(format: ExportFormat, clip: Clip, segments: Segment[]): string {
  switch (format) {
    case "txt":
      return toTimestampedText(segments);
    case "txt-plain":
      return toPlainText(segments);
    case "srt":
      return toSrt(segments);
    case "json":
      return toJson(clip, segments);
  }
}
