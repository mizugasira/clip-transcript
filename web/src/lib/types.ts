export type JobStatus = "queued" | "fetching" | "transcribing" | "done" | "failed";

export const ACTIVE_STATUSES: JobStatus[] = ["queued", "fetching", "transcribing"];

export interface Clip {
  id: string;
  url: string;
  embedUrl: string;
  title: string;
  broadcasterId: string;
  broadcasterName: string;
  creatorName: string | null;
  gameId: string | null;
  language: string | null;
  thumbnailUrl: string | null;
  durationSec: number;
  clipCreatedAt: string | null;
  videoId: string | null;
  vodOffset: number | null;
  detectedLanguage: string | null;
  transcribedAt: string | null;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface JobInfo {
  status: JobStatus;
  error: string | null;
  updatedAt: string;
}

export interface ClipPayload {
  clip: Clip | null;
  job: JobInfo | null;
  segments: Segment[];
}
