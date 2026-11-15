"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clearHistory, loadHistory, type HistoryItem } from "@/lib/history";

export function RecentClips() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);

  useEffect(() => {
    setItems(loadHistory());
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <section className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2>最近処理したクリップ</h2>
        <button
          type="button"
          className="btn"
          style={{ padding: "2px 10px", fontSize: "0.8rem" }}
          onClick={() => {
            clearHistory();
            setItems([]);
          }}
        >
          履歴を消す
        </button>
      </div>
      <ul className="history">
        {items.map((h) => (
          <li key={h.id}>
            <Link href={`/clip/${encodeURIComponent(h.id)}`}>
              {h.title || h.id}
              <span className="sub">
                {h.broadcasterName} ・ {new Date(h.at).toLocaleString("ja-JP")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="notice" style={{ margin: "8px 0 0" }}>
        履歴はこのブラウザにだけ保存されます。
      </p>
    </section>
  );
}
