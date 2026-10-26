-- TFT LAB: AI 리포트 피드백 (👍/👎 + 한 줄 코멘트)
-- Supabase SQL Editor 에서 그대로 실행하세요. (0006 이후)
--
-- 설계 원칙
--  - **insert-only**: 클라이언트(anon/authenticated)는 INSERT 만 가능. 조회는 운영자 페이지(/owner/feedback)가
--    서버에서 service role key 로만 한다. (SUPABASE_SERVICE_ROLE_KEY, 운영자 쿠키로 보호)
--  - 개인정보 미수집: Riot ID / 이메일 / IP 는 저장하지 않는다. visitor_id 는 브라우저 임의 UUID.
--  - 중복 방지: 같은 방문자가 같은 리포트에 두 번 남기지 못한다 (unique index → 23505).

create table if not exists public.report_feedback (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  visitor_id text not null,
  report_key text not null,
  mode text not null,
  match_id text,
  rating smallint not null,
  comment text,
  patch text,
  -- 무엇을 평가했는지 나중에 볼 수 있게 남기는 리포트 요약 (총평·강의 주제·행동 3개 등)
  snapshot jsonb not null default '{}'::jsonb,
  constraint report_feedback_visitor_charset check (visitor_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  constraint report_feedback_key_len check (char_length(report_key) between 1 and 120),
  constraint report_feedback_mode check (mode in ('single', 'multi')),
  constraint report_feedback_match_len check (match_id is null or char_length(match_id) <= 40),
  constraint report_feedback_rating check (rating in (-1, 1)),
  constraint report_feedback_comment_len check (comment is null or char_length(comment) <= 200),
  constraint report_feedback_patch_len check (patch is null or char_length(patch) <= 16),
  constraint report_feedback_snapshot_size check (pg_column_size(snapshot) <= 8192)
);

comment on table public.report_feedback is
  'AI 리포트 피드백. insert-only, PII 미포함. 조회는 service role(운영자 페이지)에서만.';

create unique index if not exists report_feedback_unique_idx
  on public.report_feedback (visitor_id, report_key);

create index if not exists report_feedback_created_idx
  on public.report_feedback (created_at desc);

alter table public.report_feedback enable row level security;

drop policy if exists "report_feedback_insert_public" on public.report_feedback;
create policy "report_feedback_insert_public"
  on public.report_feedback for insert
  to anon, authenticated
  with check (true);

revoke all on public.report_feedback from anon, authenticated;
grant insert on public.report_feedback to anon, authenticated;
grant usage, select on sequence public.report_feedback_id_seq to anon, authenticated;

-- 운영 확인용
-- select date_trunc('day', created_at) as day,
--        count(*) filter (where rating = 1) as up,
--        count(*) filter (where rating = -1) as down
--   from public.report_feedback group by 1 order by 1 desc;
--
-- 강의 주제별 👎 비율
-- select snapshot->>'topic' as topic, count(*), avg((rating = -1)::int)::numeric(4,2) as down_rate
--   from public.report_feedback group by 1 order by 2 desc;
