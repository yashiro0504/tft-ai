-- TFT LAB: 기물 빌드 (아이템 3개 세트) — 메타 BIS 탭 "3개 함께 든 판"
-- Supabase SQL Editor 에서 그대로 실행하세요. (0006 이후, 여러 번 실행해도 안전)
-- 설계: docs/DATA-PLATFORM.md §6 · lib/unitBuilds.ts
--
-- 원칙
--  - 기물×아이템(stat_unit_item_daily)은 아이템 1개 단위라 "BIS 3개를 함께 들면 몇 등인가"를 답하지 못한다.
--  - 기물 × 아이템 3개 조합은 종류가 많아(하루 수만 행) 일별 영구 집계로 두면 용량이 계속 는다.
--    그래서 덱 클러스터(stat_comp)처럼 패치 × 티어 필터 단위로 수집기가 하루 1회 교체한다 (기간 필터 없음).
--  - 기물마다 판 수 많은 세트 상위 10개(5판 이상)만 남긴다 (scripts/collect/builds.js).
--  - 쓰기는 service role 만 (수집기 RPC). 읽기는 공개(anon) — 닉네임·PUUID 가 없는 합계뿐이다.
--  - 이 마이그레이션 전에는 수집기가 경고만 남기고 덱 클러스터는 그대로 만든다. 앱은 JSON(lib/unitBuilds.json)으로 폴백하고,
--    DB 통계 화면에는 출처가 다른 세트를 섞지 않는다 (MetaDashboard).

create table if not exists public.stat_unit_build (
  patch text not null,
  tier_min text not null check (tier_min in ('CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND')),
  unit text not null,                  -- tft_dict.api_id (kind='unit')
  items text[] not null check (array_length(items, 1) = 3),  -- 아이템 api_id 3개, 정렬 (같은 세트 = 같은 키)
  games integer not null,
  placement_sum integer not null,
  top4 integer not null,
  wins integer not null,
  unit_games integer not null,         -- 같은 패치 × 티어 필터에서 이 기물이 나온 수 (채용률 분모)
  updated_at timestamptz not null default now(),
  primary key (patch, tier_min, unit, items)
);

alter table public.stat_unit_build enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stat_unit_build' and policyname = 'stat_unit_build_public_read') then
    create policy stat_unit_build_public_read on public.stat_unit_build for select to anon, authenticated using (true);
  end if;
end
$$;

-- 패치 × 티어 필터 단위 교체 (한 트랜잭션)
create or replace function public.tft_replace_builds(p_patch text, p_tier_min text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.stat_unit_build where patch = p_patch and tier_min = p_tier_min;
  insert into public.stat_unit_build (patch, tier_min, unit, items, games, placement_sum, top4, wins, unit_games)
    select p_patch, p_tier_min, r.unit, r.items, r.games, r.placement_sum, r.top4, r.wins, r.unit_games
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
        unit text, items text[], games integer, placement_sum integer, top4 integer, wins integer, unit_games integer
      );
  return jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
end;
$$;

revoke all on function public.tft_replace_builds(text, text, jsonb) from public, anon, authenticated;

comment on table public.stat_unit_build is '기물 빌드(아이템 3개 세트) — 패치 × 티어 필터, 수집기가 하루 1회 교체. 기물마다 상위 10개(5판 이상). lib/unitBuilds.ts';
