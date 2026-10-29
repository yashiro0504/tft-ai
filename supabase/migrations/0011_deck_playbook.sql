-- TFT LAB: 덱 플레이북 (2026-10-29 지시문 4) — 덱 × 스냅샷당 1행. 수집기가 덱 클러스터(stat_comp)를 다시 만든 직후 같은 보드로 계산한다.
-- 모든 수치는 tftlab 매치 보드에서 계산한다. 외부 가이드 사이트 텍스트는 저장하지 않는다 (external_links 는 [{source, url}] 만).
-- snapshot_id = '{patch}|{tier_min}|{stat_comp.updated_at epoch ms}' — 메타 페이지 덱과 같은 스냅샷인지 대조하는 키.

-- external_links 는 [{source, url}] 배열만 (다른 키 = 외부 텍스트가 섞일 자리 → 거부)
create or replace function public.deck_playbook_links_ok(p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p) = 'array' and not exists (
    select 1 from jsonb_array_elements(p) e
     where jsonb_typeof(e) <> 'object'
        or exists (select 1 from jsonb_object_keys(e) k where k not in ('source', 'url'))
  )
$$;

create table if not exists public.deck_playbook (
  patch text not null,
  tier_min text not null check (tier_min in ('CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND')),
  deck_key text not null,              -- stat_comp.comp_id (메타 덱 id)
  deck_name text not null,
  snapshot_id text not null,
  sample_n integer not null,
  avg numeric(4, 2),
  scope text not null check (scope in ('full', 'partial')),  -- full: 300판+ 전체 · partial: 100~299판 core_units·carry_bis 만
  core_units jsonb not null default '[]'::jsonb,
  carry_bis jsonb not null default '[]'::jsonb,
  three_star jsonb,
  flex_units jsonb,
  traits jsonb,
  level_profile jsonb,
  elim_profile jsonb,
  contested jsonb,
  augments jsonb,                      -- 보드에 증강 정보가 있을 때만, 없으면 null
  tips jsonb not null default '[]'::jsonb,            -- [{text, evidence: [필드 키]}] 근거 검증 통과분만 (3개 미만이면 [])
  external_links jsonb not null default '[]'::jsonb,  -- [{source, url}] — 텍스트 저장 금지
  version smallint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (patch, tier_min, deck_key),
  constraint deck_playbook_links_shape check (public.deck_playbook_links_ok(external_links))
);
create index if not exists deck_playbook_deck_idx on public.deck_playbook (deck_key, tier_min);

alter table public.deck_playbook enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'deck_playbook' and policyname = 'deck_playbook_public_read') then
    create policy deck_playbook_public_read on public.deck_playbook for select to anon, authenticated using (true);
  end if;
end
$$;

-- 패치 × 티어 단위 교체 (한 트랜잭션). 이전 패치 행은 남겨 새 패치 표본이 300판 미만인 동안 '이전 패치 기준'으로 쓴다.
create or replace function public.tft_replace_playbooks(p_patch text, p_tier_min text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.deck_playbook where patch = p_patch and tier_min = p_tier_min;
  insert into public.deck_playbook (
    patch, tier_min, deck_key, deck_name, snapshot_id, sample_n, avg, scope, core_units, carry_bis, three_star, flex_units,
    traits, level_profile, elim_profile, contested, augments, tips, external_links, version
  )
    select p_patch, p_tier_min, r.deck_key, r.deck_name, r.snapshot_id, r.sample_n, r.avg, r.scope,
           coalesce(r.core_units, '[]'::jsonb), coalesce(r.carry_bis, '[]'::jsonb), r.three_star, r.flex_units,
           r.traits, r.level_profile, r.elim_profile, r.contested, r.augments,
           coalesce(r.tips, '[]'::jsonb), coalesce(r.external_links, '[]'::jsonb), coalesce(r.version, 1)
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
        deck_key text, deck_name text, snapshot_id text, sample_n integer, avg numeric, scope text,
        core_units jsonb, carry_bis jsonb, three_star jsonb, flex_units jsonb, traits jsonb, level_profile jsonb,
        elim_profile jsonb, contested jsonb, augments jsonb, tips jsonb, external_links jsonb, version smallint
      );
  return jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
end;
$$;

revoke all on function public.tft_replace_playbooks(text, text, jsonb) from public, anon, authenticated;
comment on table public.deck_playbook is '덱 플레이북 (덱 × 스냅샷 1행, 수집기가 덱 클러스터 직후 교체). 수치는 tftlab 보드에서만 계산 · 외부 텍스트 저장 금지. docs/PLAYBOOK.md';
