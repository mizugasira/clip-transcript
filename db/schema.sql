-- Twitchクリップ文字起こし DBスキーマ（PostgreSQL。Neon / Supabase 等でも共通）
-- Neon / Supabase では SQL Editor でこのファイルを実行する。

create table if not exists clips (
  id                  text primary key,          -- クリップID（slug）
  url                 text not null,
  embed_url           text not null,
  title               text not null,
  broadcaster_id      text not null,
  broadcaster_name    text not null,
  creator_name        text,
  game_id             text,
  language            text,                      -- Twitch側の配信言語
  thumbnail_url       text,
  duration_sec        real not null,
  clip_created_at     timestamptz,
  video_id            text,                      -- 元VODのID（無ければ NULL）
  vod_offset          integer,                   -- VOD内でのクリップ開始秒（未反映・削除済みなら NULL）
  detected_language   text,                      -- 文字起こしで判定された言語
  transcribed_at      timestamptz,               -- NULL 以外なら文字起こし済み（キャッシュ判定に使う）
  metadata_fetched_at timestamptz not null default now(),
  inserted_at         timestamptz not null default now()
);

create table if not exists segments (
  clip_id   text    not null references clips(id) on delete cascade,
  idx       integer not null,
  start_sec real    not null,
  end_sec   real    not null,
  text      text    not null,
  primary key (clip_id, idx)
);

create table if not exists jobs (
  id             bigserial primary key,
  clip_id        text not null references clips(id) on delete cascade,
  status         text not null default 'queued'
                 check (status in ('queued', 'fetching', 'transcribing', 'done', 'failed')),
  error          text,
  requester_hash text,                            -- IPのハッシュ（レート制限用。生IPは保存しない）
  audio_seconds  real,
  cost_usd       numeric(10, 6),
  transcriber    text,                            -- 使用した文字起こしエンジン/モデル
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  updated_at     timestamptz not null default now(),
  finished_at    timestamptz
);

-- 同一クリップで同時に動くジョブは1つだけ
create unique index if not exists jobs_one_active_per_clip
  on jobs (clip_id) where status in ('queued', 'fetching', 'transcribing');
create index if not exists jobs_queue on jobs (created_at) where status = 'queued';
create index if not exists jobs_requester on jobs (requester_hash, created_at);
create index if not exists jobs_clip on jobs (clip_id, created_at desc);

-- Supabase 等の公開API（anon key）からテーブルを直接読めないようにする（Neon では影響なし）。
-- アプリはサーバー側の DB 接続（テーブル所有者）で読み書きするため影響しない。
alter table clips    enable row level security;
alter table segments enable row level security;
alter table jobs     enable row level security;
