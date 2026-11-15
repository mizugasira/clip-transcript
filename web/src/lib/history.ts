/** 最近処理したクリップの履歴（ブラウザの localStorage に保存。サーバーには送らない） */

export interface HistoryItem {
  id: string;
  title: string;
  broadcasterName: string;
  at: number;
}

const KEY = "clip-transcript:history";
const MAX = 20;

export function loadHistory(): HistoryItem[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as HistoryItem[]).filter((h) => h && typeof h.id === "string") : [];
  } catch {
    return [];
  }
}

export function addHistory(item: Omit<HistoryItem, "at">): void {
  try {
    const next = [{ ...item, at: Date.now() }, ...loadHistory().filter((h) => h.id !== item.id)].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // プライベートモード等で保存できなくても動作は続ける
  }
}

export function clearHistory(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
