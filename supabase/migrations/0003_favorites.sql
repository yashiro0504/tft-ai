-- TFT LAB: 즐겨찾기 (P0-3)
-- Supabase SQL Editor 에서 그대로 실행하세요. (0001, 0002 이후)
--
-- 설계 원칙
--  - 로그인 사용자만 사용한다(anon 권한 없음). RLS 로 **본인 행만** CRUD 가능.
--  - service role key 를 쓰지 않는다. (anon key + 사용자 세션 + RLS)
--  - 중복 방지: (user_id, region, lower(game_name), upper(tag_line)) 유니크 인덱스.
--  - 개수 상한(20)은 애플리케이션에서 강제한다.

create table if not exists public.favorites (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  region text not null default 'kr',
  game_name text not null,
  tag_line text not null,
  created_at timestamptz not null default now(),
  -- 방어적 제약: API 검증을 우회한 값도 저장되지 않게 한다.
  constraint favorites_region_len check (char_length(region) between 2 and 8),
  constraint favorites_name_len check (char_length(game_name) between 1 and 32),
  constraint favorites_tag_len check (char_length(tag_line) between 1 and 10)
);

comment on table public.favorites is
  '로그인 사용자의 즐겨찾기 소환사 (P0-3). RLS: 본인만 SELECT/INSERT/DELETE.';

-- 중복 방지 (대소문자 무시). 같은 소환사를 두 번 저장할 수 없다.
create unique index if not exists favorites_unique_idx
  on public.favorites (user_id, region, lower(game_name), upper(tag_line));

-- 목록 조회(최신순)용
create index if not exists favorites_user_created_idx
  on public.favorites (user_id, created_at desc);

alter table public.favorites enable row level security;

drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own"
  on public.favorites for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own"
  on public.favorites for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own"
  on public.favorites for delete
  to authenticated
  using (auth.uid() = user_id);

-- UPDATE 정책은 만들지 않는다. (즐겨찾기는 추가/삭제만 있고 수정 개념이 없다)

-- 기본 권한 회수 후 최소 권한만 부여 (anon 은 아무 권한도 없음)
revoke all on public.favorites from anon, authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant usage, select on sequence public.favorites_id_seq to authenticated;

-- 운영 확인용
-- select user_id, region, game_name, tag_line, created_at
--   from public.favorites order by created_at desc limit 20;
--
-- 사용자별 개수
-- select user_id, count(*) from public.favorites group by user_id order by 2 desc;
