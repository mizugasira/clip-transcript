import "server-only";

/**
 * Twitch Helix API（Get Clips）クライアント。
 * App Access Token（Client Credentials）を使う。キーはサーバー側のみで保持する。
 * https://dev.twitch.tv/docs/api/reference/clips#get-clips
 */

export interface TwitchClip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_id: string;
  broadcaster_name: string;
  creator_id: string;
  creator_name: string;
  video_id: string; // VODが無い場合は空文字
  game_id: string;
  language: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
  vod_offset: number | null;
  is_featured?: boolean;
}

export class TwitchConfigError extends Error {}

let cachedToken: { value: string; expiresAt: number } | null = null;

function credentials() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new TwitchConfigError("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET が設定されていません");
  }
  return { clientId, clientSecret };
}

async function getAppToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const { clientId, clientSecret } = credentials();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Twitchトークン取得に失敗しました (HTTP ${res.status})`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

/** クリップIDからメタデータを取得。存在しなければ null */
export async function fetchTwitchClip(clipId: string): Promise<TwitchClip | null> {
  const { clientId } = credentials();
  const url = `https://api.twitch.tv/helix/clips?id=${encodeURIComponent(clipId)}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAppToken(attempt > 0);
    const res = await fetch(url, {
      headers: { "Client-Id": clientId, Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 401 && attempt === 0) continue; // トークン失効 → 取り直して再試行
    if (res.status === 429) throw new Error("Twitch APIのリクエスト上限に達しました。しばらく待って再試行してください");
    if (!res.ok) throw new Error(`Twitch APIエラー (HTTP ${res.status})`);
    const json = (await res.json()) as { data: TwitchClip[] };
    return json.data[0] ?? null;
  }
  throw new Error("Twitch APIの認証に失敗しました");
}
