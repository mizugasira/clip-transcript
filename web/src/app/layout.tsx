import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "クリップ文字起こし",
  description: "TwitchクリップのURLを貼るだけで、発言をタイムスタンプ付きで文字に起こします",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const contactUrl = process.env.NEXT_PUBLIC_CONTACT_URL;
  return (
    <html lang="ja">
      <body>
        <header className="site-header">
          <Link href="/" className="logo">
            クリップ文字起こし
          </Link>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <p>
            発言内容の権利は各配信者に帰属します。本サービスは動画・音声を再配信しません。
            {contactUrl ? (
              <>
                {" "}
                掲載の削除依頼は
                <a href={contactUrl} target="_blank" rel="noopener noreferrer">
                  こちら
                </a>
                。
              </>
            ) : null}
          </p>
          <p className="muted">Twitchとは無関係の非公式ツールです。</p>
        </footer>
      </body>
    </html>
  );
}
