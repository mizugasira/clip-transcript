/**
 * F-01: クリップURLからクリップID（slug）を抽出する。
 *
 * 受け付ける形式:
 *   https://clips.twitch.tv/<slug>
 *   https://clips.twitch.tv/embed?clip=<slug>
 *   https://www.twitch.tv/<配信者>/clip/<slug>
 *   https://m.twitch.tv/<配信者>/clip/<slug>
 *   https://m.twitch.tv/clip/<slug>
 * スキーム省略（clips.twitch.tv/xxx）も可。
 */

const CLIP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;

export function isValidClipId(id: unknown): id is string {
  return typeof id === "string" && CLIP_ID_RE.test(id);
}

export function parseClipUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let raw = input.trim();
  if (!raw || raw.length > 500) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  let candidate: string | null = null;

  if (host === "clips.twitch.tv") {
    if (parts[0] === "embed") {
      candidate = url.searchParams.get("clip");
    } else if (parts.length === 1) {
      candidate = parts[0];
    }
  } else if (host === "twitch.tv" || host === "www.twitch.tv" || host === "m.twitch.tv") {
    // /<broadcaster>/clip/<slug>
    if (parts.length === 3 && parts[1] === "clip") {
      candidate = parts[2];
    }
    // /clip/<slug>（モバイル共有URL）
    else if (parts.length === 2 && parts[0] === "clip") {
      candidate = parts[1];
    }
  }

  if (!candidate) return null;
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  return isValidClipId(candidate) ? candidate : null;
}
