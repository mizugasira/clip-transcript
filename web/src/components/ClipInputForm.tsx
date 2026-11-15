"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseClipUrl } from "@/lib/clipUrl";

export function ClipInputForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // F-01: 不正なURLはその場でエラー表示
    const clipId = parseClipUrl(value);
    if (!clipId) {
      setError("TwitchクリップのURLを入力してください（下の例を参照）");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      const json = (await res.json().catch(() => ({}))) as { clipId?: string; message?: string };
      if (!res.ok || !json.clipId) {
        setError(json.message ?? `登録に失敗しました (HTTP ${res.status})`);
        setSubmitting(false);
        return;
      }
      router.push(`/clip/${encodeURIComponent(json.clipId)}`);
    } catch {
      setError("通信に失敗しました。接続を確認して再度お試しください");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="url-form">
        <input
          type="url"
          inputMode="url"
          placeholder="https://clips.twitch.tv/…"
          aria-label="クリップURL"
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={submitting || !value.trim()}>
          {submitting ? (
            <>
              <span className="spinner" aria-hidden />
              登録中…
            </>
          ) : (
            "文字起こし"
          )}
        </button>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="examples">
        <li>
          <code>https://clips.twitch.tv/クリップID</code>
        </li>
        <li>
          <code>https://www.twitch.tv/配信者名/clip/クリップID</code>
        </li>
      </ul>
    </form>
  );
}
