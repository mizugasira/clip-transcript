import { ClipInputForm } from "@/components/ClipInputForm";
import { RecentClips } from "@/components/RecentClips";

export default function HomePage() {
  return (
    <>
      <h1>Twitchクリップを文字起こし</h1>
      <section className="card">
        <p style={{ marginTop: 0 }}>クリップのURLを貼ると、発言をタイムスタンプ付きの文字に起こします。</p>
        <ClipInputForm />
      </section>
      <RecentClips />
    </>
  );
}
