"use client";

import { useEffect, useRef } from "react";
import { formatTwitchTime } from "@/lib/format";

/**
 * Twitch のインタラクティブ埋め込みプレーヤー（VOD用）。
 * https://dev.twitch.tv/docs/embed/video-and-clips/
 * クリップの iframe は秒数操作ができないため、行クリック時はこちらで元VODの該当秒数へ移動する。
 */

interface TwitchPlayer {
  seek(timestamp: number): void;
  play(): void;
  addEventListener(event: string, cb: () => void): void;
}

interface TwitchGlobal {
  Player: { new (id: string, opts: Record<string, unknown>): TwitchPlayer; READY: string };
}

declare global {
  interface Window {
    Twitch?: TwitchGlobal;
  }
}

const SCRIPT_SRC = "https://player.twitch.tv/js/embed/v1.js";
let scriptPromise: Promise<TwitchGlobal> | null = null;

function loadTwitchScript(): Promise<TwitchGlobal> {
  if (window.Twitch?.Player) return Promise.resolve(window.Twitch);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => (window.Twitch?.Player ? resolve(window.Twitch) : reject(new Error("Twitch embed not available")));
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error("Twitch埋め込みスクリプトの読み込みに失敗しました"));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export interface SeekTarget {
  sec: number;
  /** 同じ秒数を続けてクリックしてもシークさせるための連番 */
  nonce: number;
}

export function VodPlayer({ videoId, parent, target }: { videoId: string; parent: string; target: SeekTarget }) {
  const elementId = `twitch-vod-${videoId}`;
  const playerRef = useRef<TwitchPlayer | null>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<number | null>(null);
  const initialTarget = useRef(target);

  // プレーヤー生成（VOD・ドメインが変わったときだけ作り直す）
  useEffect(() => {
    let cancelled = false;
    readyRef.current = false;
    loadTwitchScript()
      .then((Twitch) => {
        if (cancelled) return;
        const player = new Twitch.Player(elementId, {
          video: `v${videoId}`,
          parent: [parent],
          width: "100%",
          height: "100%",
          autoplay: true,
          time: formatTwitchTime(initialTarget.current.sec),
        });
        player.addEventListener(Twitch.Player.READY, () => {
          readyRef.current = true;
          if (pendingRef.current !== null) {
            player.seek(pendingRef.current);
            pendingRef.current = null;
          }
        });
        playerRef.current = player;
      })
      .catch((e) => console.error(e));

    return () => {
      cancelled = true;
      playerRef.current = null;
      readyRef.current = false;
      const el = document.getElementById(elementId);
      if (el) el.innerHTML = "";
    };
  }, [elementId, videoId, parent]);

  // 行クリックごとにシーク
  useEffect(() => {
    if (target.nonce === initialTarget.current.nonce) return; // 初回は time オプションで指定済み
    if (playerRef.current && readyRef.current) {
      playerRef.current.seek(target.sec);
      playerRef.current.play();
    } else {
      pendingRef.current = target.sec;
    }
  }, [target]);

  return <div id={elementId} />;
}
