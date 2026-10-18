-- TFT LAB: 제품 이벤트 계측 (P0-1)
-- Supabase SQL Editor 에서 그대로 실행하세요. (0001_auth_quota.sql 이후)
--
-- 설계 원칙
--  - **insert-only**: 클라이언트(anon)는 INSERT 만 가능하고 SELECT/UPDATE/DELETE 는 불가.
--  - 개인정보 미수집: 이벤트 이름은 화이트리스트, props 는 서버에서 정제된 값만 들어온다.
--    (Riot ID / 이메일 / PUUID / IP 는 스키마·애플리케이션 양쪽에서 배제)
--  - 집계는 운영자(SQL Editor, service role, 대시보드)에서만 수행한다.

create table if not exists public.events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  name text not null,
  session_id text not null,
  route text,
  props jsonb not null default '{}'::jsonb,
  -- 방어적 제약: 애플리케이션 검증을 우회한 값도 저장되지 않게 한다.
  constraint events_name_len check (char_length(name) between 1 and 64),
  constraint events_session_len check (char_length(session_id) between 8 and 64),
  constraint events_session_charset check (session_id ~ '^[A-Za-z0-9_-]+$'),
  constraint events_route_len check (route is null or char_length(route) <= 120),
  constraint events_props_size check (pg_column_size(props) <= 4096)
);

comment on table public.events is
  '제품 이벤트 로그 (P0-1). insert-only, PII 미포함. 보관 90일 권장(아래 정리 쿼리 참고).';

-- 집계용 인덱스: 최근 이벤트 / 이벤트별 시계열
create index if not exists events_created_at_idx on public.events (created_at desc);
create index if not exists events_name_created_at_idx on public.events (name, created_at desc);
create index if not exists events_session_idx on public.events (session_id);

-- RLS: 정책이 없으면 아무도 접근할 수 없다. INSERT 정책만 추가한다.
alter table public.events enable row level security;

drop policy if exists "events_insert_public" on public.events;
create policy "events_insert_public"
  on public.events for insert
  to anon, authenticated
  with check (true);

-- 기본 권한 회수 후 INSERT 만 부여 (SELECT/UPDATE/DELETE 불가 = insert-only)
revoke all on public.events from anon, authenticated;
grant insert on public.events to anon, authenticated;

-- bigserial 시퀀스 사용 권한 (없으면 insert 가 permission denied 로 실패)
grant usage, select on sequence public.events_id_seq to anon, authenticated;

-- 운영 확인용
-- select name, count(*) from public.events
--  where created_at > now() - interval '7 days'
--  group by name order by 2 desc;
--
-- select date_trunc('day', created_at) as day, count(distinct session_id) as sessions
--   from public.events where created_at > now() - interval '14 days'
--   group by 1 order by 1 desc;
--
-- 보관 정리 (90일 초과 삭제, 운영자가 주기적으로 실행하거나 pg_cron 사용)
-- delete from public.events where created_at < now() - interval '90 days';
