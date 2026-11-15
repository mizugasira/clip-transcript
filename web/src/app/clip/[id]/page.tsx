import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ClipView } from "@/components/ClipView";
import { isValidClipId } from "@/lib/clipUrl";
import { getClipPayload } from "@/lib/repository";

export const dynamic = "force-dynamic";

// generateMetadata とページ本体で同じ読み込みを1回にまとめる
const loadPayload = cache(getClipPayload);

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!isValidClipId(id)) return {};
  const { clip } = await loadPayload(id).catch(() => ({ clip: null }));
  return clip ? { title: `${clip.title} - ${clip.broadcasterName} | クリップ文字起こし` } : {};
}

/** F-09: /clip/<クリップID> で結果ページを開ける */
export default async function ClipPage({ params }: Props) {
  const { id } = await params;
  if (!isValidClipId(id)) notFound();
  const initial = await loadPayload(id);
  return <ClipView clipId={id} initial={initial} />;
}
