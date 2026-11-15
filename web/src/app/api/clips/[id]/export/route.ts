import { isValidClipId } from "@/lib/clipUrl";
import { EXPORT_FORMATS, renderExport, type ExportFormat } from "@/lib/format";
import { getClip, getSegments } from "@/lib/repository";

export const dynamic = "force-dynamic";

/** F-07: TXT（時刻あり/なし）・SRT・JSON のダウンロード */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") as ExportFormat | null;
  const spec = EXPORT_FORMATS.find((f) => f.format === format);
  if (!isValidClipId(id) || !spec) {
    return new Response("bad request", { status: 400 });
  }

  const clip = await getClip(id);
  if (!clip?.transcribedAt) {
    return new Response("not found", { status: 404 });
  }
  const segments = await getSegments(id);
  const body = renderExport(spec.format, clip, segments);
  const suffix = spec.format === "txt-plain" ? "-plain" : "";
  const filename = `${id}${suffix}.${spec.ext}`;

  // Windowsのメモ帳等でも文字化けしないよう、TXTはBOM付きUTF-8で返す（SRT/JSONはBOMなし）
  const withBom = spec.format === "txt" || spec.format === "txt-plain" ? `﻿${body}` : body;
  return new Response(withBom, {
    headers: {
      "Content-Type": `${spec.mime}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
