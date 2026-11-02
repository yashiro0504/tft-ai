-- AI 리포트 영구 저장 (2026-11-02 지시문 1).
-- 경기 분석 리포트는 Redis 캐시(24시간)에만 있어서, 이틀 뒤 같은 경기의 "이 경기 AI 분석"이 안내 없이 새로 생성·차감됐다.
-- 한 번 만든 리포트는 여기에 남겨 두고, 캐시가 비어도 이 표에서 꺼내 보여 준다 (LLM 호출·차감 없음).
-- 서버(service role)만 읽고 쓴다 — 사용자가 직접 접근하지 않는다.
create table if not exists public.analysis_reports (
  cache_key text primary key,
  kind text not null default 'match',
  generator_version text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists analysis_reports_updated_at_idx on public.analysis_reports (updated_at desc);

alter table public.analysis_reports enable row level security;
-- 정책 없음: anon·authenticated 는 읽기·쓰기 모두 불가 (service role 은 RLS 를 우회한다)
