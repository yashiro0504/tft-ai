-- TFT LAB: P3 게이트용 익명 방문자 식별자 (2026-10-18)
-- Supabase SQL Editor 에서 0002_events.sql 이후에 실행하세요.
--
-- 왜 필요한가
--  - session_id 는 sessionStorage 기반이라 탭을 닫으면 사라진다. → D7 리텐션 계산 불가.
--  - visitor_id 는 localStorage 기반 임의 UUID 로, 같은 브라우저의 재방문을 묶는다.
--  - 개인정보(PII)가 아니며, 사이트 간 추적/광고에 사용하지 않는다.
--
-- 롤아웃 호환
--  - 구버전 클라이언트는 visitorId 를 보내지 않는다. API 가 sessionId 로 폴백하므로
--    배포 전환 중에도 insert 는 실패하지 않는다.
--  - 기존 행은 session_id 로 백필한다. (과거 데이터의 리텐션은 계산되지 않음)

alter table public.events add column if not exists visitor_id text;

-- 기존 행 백필 후 NOT NULL 로 고정
update public.events
   set visitor_id = session_id
 where visitor_id is null;

alter table public.events alter column visitor_id set not null;

-- 방어적 제약 (재실행 가능하도록 drop → add)
alter table public.events drop constraint if exists events_visitor_len;
alter table public.events
  add constraint events_visitor_len check (char_length(visitor_id) between 8 and 64);

alter table public.events drop constraint if exists events_visitor_charset;
alter table public.events
  add constraint events_visitor_charset check (visitor_id ~ '^[A-Za-z0-9_-]+$');

-- 집계용 인덱스: 방문자별 퍼널 / 코호트 리텐션
create index if not exists events_visitor_id_idx on public.events (visitor_id);
create index if not exists events_visitor_created_at_idx on public.events (visitor_id, created_at desc);

comment on column public.events.visitor_id is
  'localStorage 기반 익명 방문자 UUID (PII 아님). D7 리텐션/퍼널 집계용. 90일 보관 권장.';

-- 확인
-- select count(*) filter (where visitor_id = session_id) as fallback_rows, count(*) as total
--   from public.events;
