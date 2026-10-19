-- TFT LAB: 전환 지시서 단계 3 — 검색 → 분석 → 한도 도달 → Pro 클릭 퍼널
-- Supabase SQL Editor 에서 실행한다. (events 는 insert-only 라 조회는 운영자 권한으로만 가능)
--
-- 지시서 이벤트 이름 ↔ 실제 기록 이름
--   search_run      → search_submit
--   analysis_run    → analysis_click   (props.scope = 'match' | 'overview')
--   limit_reached   → limit_reached    (props.scope)
--   pro_click       → pro_waitlist_click (props.surface = 'limit_modal' | 'pro_page')
--   waitlist_submit → (보류: 이메일 수집 미구현)

-- 1) 최근 7일, 날짜(KST)별 이벤트 수
select
  (created_at at time zone 'Asia/Seoul')::date as day_kst,
  name,
  count(*)                    as events,
  count(distinct visitor_id)  as visitors
from public.events
where created_at >= now() - interval '7 days'
  and name in ('search_submit', 'analysis_click', 'limit_reached', 'pro_waitlist_click')
group by 1, 2
order by 1 desc, 2;

-- 2) 최근 7일 방문자 기준 퍼널 (각 단계에 한 번이라도 도달한 방문자 수)
with v as (
  select
    visitor_id,
    bool_or(name = 'search_submit')                                      as searched,
    bool_or(name = 'analysis_click')                                     as analyzed,
    bool_or(name = 'limit_reached')                                      as hit_limit,
    bool_or(name = 'pro_waitlist_click' and props->>'surface' = 'limit_modal') as pro_from_limit
  from public.events
  where created_at >= now() - interval '7 days'
  group by visitor_id
)
select
  count(*) filter (where searched)        as searched,
  count(*) filter (where analyzed)        as analyzed,
  count(*) filter (where hit_limit)       as hit_limit,
  count(*) filter (where pro_from_limit)  as pro_click_from_limit,
  round(100.0 * count(*) filter (where pro_from_limit)
        / nullif(count(*) filter (where hit_limit), 0), 1) as pro_click_rate_pct
from v;

-- 3) 한도 도달이 어떤 분석에서 많이 일어나는지
select props->>'scope' as scope, count(*) as events, count(distinct visitor_id) as visitors
from public.events
where name = 'limit_reached'
  and created_at >= now() - interval '7 days'
group by 1
order by 2 desc;
