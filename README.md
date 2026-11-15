# Twitchクリップ文字起こし（MVP）

TwitchクリップのURLを貼ると、発言をタイムスタンプ付きで文字に起こし、閲覧・コピー・書き出しできるWebアプリ。
要件定義書の第1段階（F-01〜F-09）を実装している。

## 構成（無料サーバーだけで動かす構成）

```
ブラウザ ──POST /api/jobs──▶ web（Next.js / Vercel Hobby）──Get Clips──▶ Twitch API
   │  ▲                         │ ① jobs表に登録
   │  └─GET /api/clips/:id──────┤ ② after() でワーカーを呼ぶ（取りこぼしはポーリング時に再呼び出し）
   │      （2秒ごと）            ▼
   │                      worker（Python / Vercel Hobby の Python Function）
   │                        yt-dlp で動画取得 → Groq（Whisper large-v3 系）で文字起こし → 保存
   │                            │
   │                            ▼
   │                      PostgreSQL（Neon Free）
   └── Twitch埋め込み（クリップ / 元VOD）
```

| 役割 | サービス（無料枠） | 置くもの |
| --- | --- | --- |
| 画面・API | Vercel Hobby（プロジェクト1） | `web/` |
| 音声取得・文字起こし | Vercel Hobby（プロジェクト2、Python） | `worker/`（`app.py` が入口） |
| 文字起こしエンジン | Groq 無料枠 | `whisper-large-v3-turbo`（既定） |
| DB | Neon Free（休止しても次のアクセスで自動復帰） | `db/schema.sql` |

同じコードで、ワーカーを自分のPCに常駐させる構成（`python worker.py`、自前Whisper＝faster-whisper も可）にも切り替えられる。

## リポジトリ構成

| パス | 内容 |
| --- | --- |
| `web/` | Next.js 16（App Router, TypeScript）。画面とAPI |
| `worker/` | Python。`app.py`＝Vercel用の入口、`worker.py`＝常駐用の入口。`fetchers/`（音声取得方式）と `transcribers/`（文字起こしエンジン）は差し替え可能 |
| `db/schema.sql` | テーブル定義（`clips` / `segments` / `jobs`） |
| `docker-compose.yml` | ローカル用 PostgreSQL（＋常駐ワーカー） |

## 機能と実装箇所

| ID | 機能 | 実装 |
| --- | --- | --- |
| F-01 | URL入力・ID抽出・不正URLの即時エラー | `web/src/lib/clipUrl.ts`, `ClipInputForm.tsx` |
| F-02 | クリップ情報の表示 | `web/src/lib/twitch.ts`（Get Clips, App Access Token） |
| F-03 | 音声取得 | `worker/fetchers/ytdlp.py`（方式B）, `worker/audio.py`（ffmpegがあれば音声だけ抽出、無ければ動画のまま送る） |
| F-04 | 文字起こし（文単位の秒数付き） | `worker/transcribers/`（`groq` / `openai` / `faster_whisper`） |
| F-05 | 進捗表示・失敗理由・再試行 | `ClipView.tsx`（取得中→文字起こし中→完了） |
| F-06 | 埋め込み再生・行クリックで元VODの該当秒数へ | `ClipView.tsx`, `VodPlayer.tsx`（`vod_offset + 行の開始秒`） |
| F-07 | 全文コピー・TXT（時刻あり/なし）・SRT・JSON | `web/src/lib/format.ts`, `api/clips/[id]/export` |
| F-08 | 同一クリップはキャッシュを返す | `api/jobs`（`clips.transcribed_at` で判定） |
| F-09 | `/clip/<クリップID>` の共有URL | `web/src/app/clip/[id]/page.tsx` |

非機能要件の対応: IP単位レート制限（既定10本/時、IPはハッシュのみ保存）、長尺拒否（既定90秒超）、
月額上限（超過で新規受付停止。キャッシュ済みは引き続き表示）、APIキーはサーバー側のみ、
音声・動画は一時ディレクトリで処理後に削除、元クリップへのリンク常時表示、フッターに削除依頼窓口（`NEXT_PUBLIC_CONTACT_URL`）。

## 無料構成でのデプロイ手順

### 1. キーの用意
- **Twitch**: [Developer Console](https://dev.twitch.tv/console) でアプリを登録（2FA必須。Redirect URL は `https://localhost` でよい）→ Client ID / Client Secret
- **Groq**: [console.groq.com](https://console.groq.com) でアカウントを作り API Key を発行（`gsk_...`）
- **共有シークレット**: Web→ワーカーの呼び出し認証用。長いランダム文字列を1つ作る
  （例: `python -c "import secrets; print(secrets.token_urlsafe(32))"`）

### 2. Neon（DB）
1. プロジェクトを作成（リージョンは Vercel の関数の実行リージョンに近い場所にする）
2. SQL Editor で `db/schema.sql` の中身を実行
3. 「Connect」から接続文字列を取得。サーバーレスから使うので **Pooled connection**（ホスト名に `-pooler` が付く）を使う。
   `?sslmode=require` 付きのままでよい（node-pg は証明書検証付きで接続する）

Supabase も使えるが、無料プランは7日間アクセスが無いと一時停止し、手動での再開が必要になる。

### 3. Vercel にワーカーをデプロイ（プロジェクト2）
1. GitHubにこのリポジトリを置き、Vercelで「Add New Project」→ **Root Directory を `worker`** にする
2. Environment Variables:

   | 変数 | 値 |
   | --- | --- |
   | `DATABASE_URL` | Neon の接続文字列（Pooled） |
   | `TRANSCRIBER` | `groq` |
   | `GROQ_API_KEY` | Groq のキー |
   | `WORKER_SECRET` | 共有シークレット |
   | `AUDIO_EXTRACT` | `none`（Vercelに ffmpeg は無い） |
   | `STALE_JOB_MINUTES` | `6` |
3. デプロイ後、`https://<ワーカーのドメイン>/api/health` が `{"ok":true}` を返すことを確認

### 4. Vercel にWebをデプロイ（プロジェクト1）
1. 同じリポジトリでもう1つプロジェクトを作り、**Root Directory を `web`** にする
2. Environment Variables:

   | 変数 | 値 |
   | --- | --- |
   | `DATABASE_URL` | Neon の接続文字列（ワーカーと同じ） |
   | `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Twitch のキー |
   | `WORKER_URL` | `https://<ワーカーのドメイン>` |
   | `WORKER_SECRET` | 共有シークレット（ワーカーと同じ） |
   | `TRANSCRIBE_PRICE_PER_MINUTE_USD` | `0` |
   | `IP_HASH_SALT` | 任意のランダム文字列 |
   | `NEXT_PUBLIC_CONTACT_URL` | 削除依頼窓口（任意） |

## ローカルでの動かし方

前提: Node.js 20以降、Python 3.10以降、PostgreSQL（`docker compose up -d db` でポート54329に起動）。

```bash
# ワーカー
cd worker
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements-local.txt
cp .env.example .env                                # GROQ_API_KEY と WORKER_SECRET を設定

# (a) 無料構成と同じ形で動かす（Webから呼び出される）
flask --app app run -p 8001
#     → web/.env.local に WORKER_URL=http://127.0.0.1:8001 と同じ WORKER_SECRET を設定
#       （localhost ではなく 127.0.0.1 と書く。Node.js が IPv6 で接続して失敗するため）
# (b) 常駐ワーカーとして動かす（WORKER_URL は空にする）
python worker.py

# Web
cd ../web
npm install
cp .env.example .env.local                          # TWITCH_CLIENT_ID / SECRET 等を設定
npm run dev                                         # http://localhost:3000
```

### 自前Whisper（faster-whisper）を使う場合（自分のPCで動かすとき）

```bash
# CPUのみ
pip install -r requirements-local-whisper.txt
# NVIDIA GPU（CUDA 12）を使う場合はこちら（cuBLAS / cuDNN を pip で入れる。Windowsでは自動で読み込む）
pip install -r requirements-local-whisper-gpu.txt
```

```ini
# worker/.env
TRANSCRIBER=faster_whisper
TRANSCRIBE_MODEL=large-v3-turbo   # GPU推奨。CPUのみなら small
FW_DEVICE=cuda                    # CPUのみなら cpu
FW_COMPUTE_TYPE=float16           # CPUのみなら int8
```

常駐ワーカーとして `python worker.py` で起動し、`web/.env.local` の `WORKER_URL` は空にする。
初回はモデルを Hugging Face から自動ダウンロードする（large-v3-turbo / large-v3 は数GB）。

実測（RTX 3070 / Core i7-10700、59秒の日本語クリップ、モデル読み込み後の2回目）:

| モデル | 文字起こし時間 |
| --- | --- |
| CPU + small（int8） | 約13秒 |
| GPU + large-v3-turbo（float16） | 約2.5秒 |
| GPU + large-v3（float16） | 約22〜29秒 |

精度の比較は正解データが無いため未評価。large-v3 は遅く、要件の「30秒以内」に収まらない場合がある。
※ faster-whisper 1.2.1 は PyAV 19 と非互換のため `av<19` に固定している。

## テスト

```bash
cd web && npm test                  # URL解析・時刻/SRT整形
cd worker && pip install -r requirements-dev.txt
pytest                              # 単体テスト
TEST_DATABASE_URL=postgresql://... pytest   # 実DBでのキュー処理・HTTP入口の結合テスト（指定DBのテーブルを作り直すので空のDBを使うこと）
```

## 注意・既知の制約

- **方式B（yt-dlp）は非公開の仕組みに依存**しており、予告なく壊れうる（規約上もグレー）。壊れたらまず yt-dlp を更新（Vercelでは再デプロイで最新が入る）。
  一般公開する場合は要件定義書どおり方式A（公式 Get Clips Download、OAuth必須）を `worker/fetchers/` に追加して切り替える。
- **VercelのサーバーからTwitchの動画を取得できるかは未確認**（データセンターのIPが制限される可能性）。デプロイ後に最初に確認すること。
- **Groq の無料枠の上限**はアカウントの Limits 画面で確認すること。上限を超えると「文字起こしAPIの利用上限に達しました」で失敗する。
  ffmpeg の無い Vercel では低画質の動画ファイルごと Groq に送る（無料枠のファイル上限は25MB。60秒クリップは数MB）。
- **文字起こしモデル**: 秒数（セグメント）が必要。OpenAIでは `verbose_json` に対応する `whisper-1` のみ、Groq は Whisper large-v3 / large-v3-turbo が対応。モデルは `TRANSCRIBE_MODEL` で変更可能。
- **秒数ジャンプ**: Get Clips の `vod_offset` はクリップ作成から数分遅れて反映されることがあるため、未反映なら5分おきに取り直す。VODが削除済みならジャンプなし。
- **埋め込みサイズ**: Twitch公式は埋め込みの最小サイズを 400×300 としている。幅400px未満のスマホではこの条件を満たさない。
- **レート制限のIP**: `x-forwarded-for` の先頭を使う。Vercel等のプロキシ配下を前提とし、直接公開する場合は偽装されうる。
- 第2段階（F-10〜F-13：手修正、一括取り込み、全文検索、意味検索）は未実装。
