-- TFT LAB: 데이터 플랫폼 v2 — Phase B (일별 집계 · 덱 클러스터 · 공개 조회 RPC)
-- Supabase SQL Editor 에서 그대로 실행하세요. (0005 이후, 여러 번 실행해도 안전)
-- 설계: docs/DATA-PLATFORM.md §6
--
-- 원칙
--  - 집계 테이블은 영구 보관한다. 원본(tft_boards)은 최근 N 패치만 남지만 집계는 지우지 않는다.
--  - 쓰기는 service role 만 (수집기). 읽기는 공개(anon) — 닉네임·PUUID 가 없는 합계뿐이다.
--  - 집계 키는 (game_date, patch, tier_bucket) 이다. 수집기는 이번 실행에 바뀐 조합만 tft_refresh_rollup 으로 다시 계산한다.
--  - 수치 규칙은 scripts/buildMetaStats.js 와 같다:
--      기물 = 보드 위 기물 1개당 1건 (star=0 합계, star=1..4 성급별)
--      아이템 = 기물이 든 아이템 1개당 1건 · 기물×아이템 = 같은 규칙
--      시너지 = 활성 시너지 1개당 1건 (tier=0 합계, tier=1.. 단계별)

-- 1) 일별 판 수 (픽률 분모 · 필터 목록)
create table if not exists public.stat_daily_totals (
  game_date date not null,
  patch text not null,
  tier_bucket text not null,
  matches integer not null,
  boards integer not null,
  updated_at timestamptz not null default now(),
  primary key (game_date, patch, tier_bucket)
);

-- 2) 기물
create table if not exists public.stat_unit_daily (
  game_date date not null,
  patch text not null,
  tier_bucket text not null,
  unit smallint not null,              -- tft_dict.id (kind='unit')
  star smallint not null,              -- 0 = 성급 무관 합계
  games integer not null,
  placement_sum integer not null,
  top4 integer not null,
  wins integer not null,
  primary key (game_date, patch, tier_bucket, unit, star)
);

-- 3) 아이템
create table if not exists public.stat_item_daily (
  game_date date not null,
  patch text not null,
  tier_bucket text not null,
  item smallint not null,
  games integer not null,
  placement_sum integer not null,
  top4 integer not null,
  wins integer not null,
  primary key (game_date, patch, tier_bucket, item)
);

-- 4) 시너지
create table if not exists public.stat_trait_daily (
  game_date date not null,
  patch text not null,
  tier_bucket text not null,
  trait smallint not null,
  tier smallint not null,              -- 0 = 단계 무관 합계
  games integer not null,
  placement_sum integer not null,
  top4 integer not null,
  wins integer not null,
  primary key (game_date, patch, tier_bucket, trait, tier)
);

-- 5) 기물 × 아이템 (BIS 근거)
create table if not exists public.stat_unit_item_daily (
  game_date date not null,
  patch text not null,
  tier_bucket text not null,
  unit smallint not null,
  item smallint not null,
  games integer not null,
  placement_sum integer not null,
  top4 integer not null,
  wins integer not null,
  primary key (game_date, patch, tier_bucket, unit, item)
);

-- 6) 덱 클러스터 (수집기가 하루 1회 패치 × 티어 필터별로 다시 만든다)
--    tier_min 은 누적 구간이다: 'MASTER' = 마스터 이상(마스터+그마+챌) 판으로 묶은 덱.
create table if not exists public.stat_comp (
  patch text not null,
  tier_min text not null check (tier_min in ('CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND')),
  comp_id text not null,               -- ladder-{캐리}-{시너지}
  core_units text[] not null,          -- 대표 구성 기물 키
  games integer not null,
  placement_sum integer not null,
  top4 integer not null,
  wins integer not null,
  total_boards integer not null,       -- 픽률 분모 (이 패치 × 티어 필터의 전체 보드)
  deck jsonb not null,                 -- lib/decksData.json 의 덱 1개와 같은 모양 (화면에서 그대로 쓴다)
  updated_at timestamptz not null default now(),
  primary key (patch, tier_min, comp_id)
);

alter table public.stat_daily_totals enable row level security;
alter table public.stat_unit_daily enable row level security;
alter table public.stat_item_daily enable row level security;
alter table public.stat_trait_daily enable row level security;
alter table public.stat_unit_item_daily enable row level security;
alter table public.stat_comp enable row level security;

-- 공개 select (쓰기 정책은 두지 않는다 → service role 만 쓴다)
do $$
declare
  t text;
begin
  foreach t in array array['stat_daily_totals', 'stat_unit_daily', 'stat_item_daily', 'stat_trait_daily',
                           'stat_unit_item_daily', 'stat_comp']
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_public_read') then
      execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_public_read', t);
    end if;
  end loop;
end
$$;

-- 7) (game_date, patch, tier_bucket) 한 조합을 원본에서 다시 계산한다.
--    조합 단위로 지우고 다시 넣으므로(한 트랜잭션) 몇 번을 돌려도 결과가 같고,
--    티어 상향으로 판이 다른 구간으로 옮겨 가 사라진 키도 남지 않는다.
--    그 패치의 원본이 이미 정리됐다면(tft_prune_raw) 영구 집계를 지우지 않도록 아무것도 하지 않는다.
create or replace function public.tft_refresh_rollup(p_game_date date, p_patch text, p_tier text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_boards integer;
begin
  if not exists (select 1 from public.tft_matches where patch = p_patch) then
    return -1;
  end if;

  delete from public.stat_daily_totals    where game_date = p_game_date and patch = p_patch and tier_bucket = p_tier;
  delete from public.stat_unit_daily      where game_date = p_game_date and patch = p_patch and tier_bucket = p_tier;
  delete from public.stat_item_daily      where game_date = p_game_date and patch = p_patch and tier_bucket = p_tier;
  delete from public.stat_trait_daily     where game_date = p_game_date and patch = p_patch and tier_bucket = p_tier;
  delete from public.stat_unit_item_daily where game_date = p_game_date and patch = p_patch and tier_bucket = p_tier;

  create temporary table if not exists _rollup_boards (
    match_id text, placement smallint, units smallint[], traits smallint[]
  ) on commit drop;
  truncate _rollup_boards;
  insert into _rollup_boards
    select b.match_id, b.placement, b.units, b.traits
      from public.tft_boards b
      join public.tft_matches m on m.match_id = b.match_id
     where m.game_date = p_game_date and m.patch = p_patch and m.tier_bucket = p_tier;

  select count(*) into v_boards from _rollup_boards;
  if v_boards = 0 then
    return 0;
  end if;

  insert into public.stat_daily_totals (game_date, patch, tier_bucket, matches, boards)
    select p_game_date, p_patch, p_tier, count(distinct match_id), count(*) from _rollup_boards;

  -- 기물 5칸 [기물, 성급, 아이템1, 아이템2, 아이템3] 펼치기
  create temporary table if not exists _rollup_units (
    placement smallint, unit smallint, star smallint, i1 smallint, i2 smallint, i3 smallint
  ) on commit drop;
  truncate _rollup_units;
  insert into _rollup_units
    select b.placement, b.units[s + 1], b.units[s + 2], b.units[s + 3], b.units[s + 4], b.units[s + 5]
      from _rollup_boards b
     cross join lateral generate_series(0, coalesce(array_length(b.units, 1), 0) - 5, 5) as s;

  insert into public.stat_unit_daily (game_date, patch, tier_bucket, unit, star, games, placement_sum, top4, wins)
    select p_game_date, p_patch, p_tier, unit, coalesce(star, 0)::smallint,
           count(*), sum(placement), count(*) filter (where placement <= 4), count(*) filter (where placement = 1)
      from _rollup_units
     group by grouping sets ((unit), (unit, star))
    having unit is not null;

  insert into public.stat_unit_item_daily (game_date, patch, tier_bucket, unit, item, games, placement_sum, top4, wins)
    select p_game_date, p_patch, p_tier, u.unit, it.item,
           count(*), sum(u.placement), count(*) filter (where u.placement <= 4), count(*) filter (where u.placement = 1)
      from _rollup_units u
     cross join lateral unnest(array[u.i1, u.i2, u.i3]) as it(item)
     where it.item <> 0
     group by u.unit, it.item;

  insert into public.stat_item_daily (game_date, patch, tier_bucket, item, games, placement_sum, top4, wins)
    select p_game_date, p_patch, p_tier, item, sum(games), sum(placement_sum), sum(top4), sum(wins)
      from public.stat_unit_item_daily
     where game_date = p_game_date and patch = p_patch and tier_bucket = p_tier
     group by item;

  -- 시너지 3칸 [시너지, 인원, 단계] 펼치기
  insert into public.stat_trait_daily (game_date, patch, tier_bucket, trait, tier, games, placement_sum, top4, wins)
    select p_game_date, p_patch, p_tier, trait, coalesce(tier, 0)::smallint,
           count(*), sum(placement), count(*) filter (where placement <= 4), count(*) filter (where placement = 1)
      from (
        select b.placement, b.traits[s + 1] as trait, b.traits[s + 3] as tier
          from _rollup_boards b
         cross join lateral generate_series(0, coalesce(array_length(b.traits, 1), 0) - 3, 3) as s
      ) t
     where tier > 0
     group by grouping sets ((trait), (trait, tier));

  return v_boards;
end;
$$;

-- 7-1) 원본에 있는 모든 (game_date, patch, tier_bucket) — 수집기가 하루 1회 전체를 다시 계산할 때 쓴다
--      (0006 적용 전에 적재된 판, 중간에 실패한 실행의 판도 이걸로 메워진다)
create or replace function public.tft_raw_combos()
returns table (game_date date, patch text, tier_bucket text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct m.game_date, m.patch, m.tier_bucket from public.tft_matches m order by 1, 2, 3;
$$;

-- 8) 티어 필터 → 누적 구간 (challenger | grandmaster | master | diamond → 그 이상 전부)
create or replace function public.tft_tier_buckets(p_tier_min text)
returns text[]
language sql
immutable
as $$
  select case upper(coalesce(p_tier_min, 'MASTER'))
    when 'CHALLENGER' then array['CHALLENGER']
    when 'GRANDMASTER' then array['CHALLENGER', 'GRANDMASTER']
    when 'DIAMOND' then array['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND']
    else array['CHALLENGER', 'GRANDMASTER', 'MASTER']
  end;
$$;

-- 9) 공개 조회: 필터(패치 · 티어 · 최근 N일) 합계. p_days = 0 이면 패치 전체.
--    KST 오늘을 포함해 N일 (3 → 오늘·어제·그제). p_today 는 테스트용.
--    반환 키는 tft_dict.api_id 문자열이다 (화면에서 번역).
--      unit      : key1=기물, extra1=성급 합(평균 성급용), extra2=3성 수
--      item      : key1=아이템
--      trait     : key1=시너지, extra1=단계 합(평균 단계용)
--      unit_item : key1=기물, key2=아이템 (p_min_games 미만 제외 — 응답 크기 제한)
create or replace function public.tft_stat_query(
  p_type text,
  p_patch text,
  p_tier_min text default 'MASTER',
  p_days integer default 7,
  p_min_games integer default 1,
  p_today date default null
)
returns table (key1 text, key2 text, games bigint, placement_sum bigint, top4 bigint, wins bigint, extra1 bigint, extra2 bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tiers text[] := public.tft_tier_buckets(p_tier_min);
  v_since date := case when coalesce(p_days, 0) > 0
                       then coalesce(p_today, (now() at time zone 'Asia/Seoul')::date) - (p_days - 1)
                       else date '1970-01-01' end;
  v_min integer := greatest(coalesce(p_min_games, 1), 1);
begin
  if p_type = 'unit' then
    return query
      select d.api_id, null::text,
             sum(s.games) filter (where s.star = 0), sum(s.placement_sum) filter (where s.star = 0),
             sum(s.top4) filter (where s.star = 0), sum(s.wins) filter (where s.star = 0),
             sum(s.games * s.star) filter (where s.star > 0), sum(s.games) filter (where s.star = 3)
        from public.stat_unit_daily s
        join public.tft_dict d on d.id = s.unit
       where s.patch = p_patch and s.tier_bucket = any (v_tiers) and s.game_date >= v_since
       group by d.api_id
      having coalesce(sum(s.games) filter (where s.star = 0), 0) >= v_min;
  elsif p_type = 'item' then
    return query
      select d.api_id, null::text, sum(s.games), sum(s.placement_sum), sum(s.top4), sum(s.wins), null::bigint, null::bigint
        from public.stat_item_daily s
        join public.tft_dict d on d.id = s.item
       where s.patch = p_patch and s.tier_bucket = any (v_tiers) and s.game_date >= v_since
       group by d.api_id
      having sum(s.games) >= v_min;
  elsif p_type = 'trait' then
    return query
      select d.api_id, null::text,
             sum(s.games) filter (where s.tier = 0), sum(s.placement_sum) filter (where s.tier = 0),
             sum(s.top4) filter (where s.tier = 0), sum(s.wins) filter (where s.tier = 0),
             sum(s.games * s.tier) filter (where s.tier > 0), null::bigint
        from public.stat_trait_daily s
        join public.tft_dict d on d.id = s.trait
       where s.patch = p_patch and s.tier_bucket = any (v_tiers) and s.game_date >= v_since
       group by d.api_id
      having coalesce(sum(s.games) filter (where s.tier = 0), 0) >= v_min;
  elsif p_type = 'unit_item' then
    return query
      select du.api_id, di.api_id, sum(s.games), sum(s.placement_sum), sum(s.top4), sum(s.wins), null::bigint, null::bigint
        from public.stat_unit_item_daily s
        join public.tft_dict du on du.id = s.unit
        join public.tft_dict di on di.id = s.item
       where s.patch = p_patch and s.tier_bucket = any (v_tiers) and s.game_date >= v_since
       group by du.api_id, di.api_id
      having sum(s.games) >= v_min;
  elsif p_type = 'total' then
    -- 같은 필터의 전체 판 수 / 보드 수 (픽률 분모)
    return query
      select null::text, null::text, sum(t.boards)::bigint, null::bigint, null::bigint, null::bigint, sum(t.matches)::bigint, null::bigint
        from public.stat_daily_totals t
       where t.patch = p_patch and t.tier_bucket = any (v_tiers) and t.game_date >= v_since;
  else
    raise exception 'unknown stat type: %', p_type;
  end if;
end;
$$;

-- 10) 공개 조회: 사용 가능한 패치 · 티어 구간별 판 수 · 날짜 범위 (필터 목록)
create or replace function public.tft_stat_filters()
returns table (patch text, tier_bucket text, matches bigint, first_date date, last_date date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.patch, t.tier_bucket, sum(t.matches)::bigint, min(t.game_date), max(t.game_date)
    from public.stat_daily_totals t
   group by t.patch, t.tier_bucket
   order by max(t.game_date) desc, t.patch desc, t.tier_bucket;
$$;

-- 11) 덱 클러스터 교체 (패치 × 티어 필터 단위, 한 트랜잭션)
create or replace function public.tft_replace_comps(p_patch text, p_tier_min text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.stat_comp where patch = p_patch and tier_min = p_tier_min;
  insert into public.stat_comp (patch, tier_min, comp_id, core_units, games, placement_sum, top4, wins, total_boards, deck)
    select p_patch, p_tier_min, r.comp_id, r.core_units, r.games, r.placement_sum, r.top4, r.wins, r.total_boards, r.deck
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
        comp_id text, core_units text[], games integer, placement_sum integer, top4 integer, wins integer,
        total_boards integer, deck jsonb
      );
  return jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
end;
$$;

revoke all on function public.tft_refresh_rollup(date, text, text) from public, anon, authenticated;
revoke all on function public.tft_raw_combos() from public, anon, authenticated;
revoke all on function public.tft_replace_comps(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.tft_stat_query(text, text, text, integer, integer, date) to anon, authenticated;
grant execute on function public.tft_stat_filters() to anon, authenticated;
grant execute on function public.tft_tier_buckets(text) to anon, authenticated;

comment on table public.stat_unit_daily is '일별 기물 집계 (영구). star=0 은 성급 무관 합계. 키 = tft_dict.id. docs/DATA-PLATFORM.md §6';
comment on table public.stat_comp is '덱 클러스터 (패치 × 티어 필터, 수집기가 하루 1회 교체). deck = decksData.json 덱 1개 모양';
