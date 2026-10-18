-- TFT LAB P3 유료화 게이트 집계 (2026-10-18)
-- 실행 위치: Supabase Dashboard → SQL Editor (postgres/service role)
-- 주의: public.events 는 insert-only RLS 이므로 anon/authenticated 키로는 SELECT 할 수 없다.
-- 일자 경계는 KST(Asia/Seoul) 기준이다.
--
-- 선행 조건
--   1) supabase/migrations/0002_events.sql 적용
--   2) supabase/migrations/0004_events_visitor.sql 적용 + 새 클라이언트 배포
--   3) D7 은 최소 13일치 데이터가 쌓인 뒤에 의미가 있다.

-- ---------------------------------------------------------------------------
-- 0) 데이터 품질 (visitor_id 폴백 비율)
--    visitor_id = session_id 인 행은 0004 이전/구버전 클라이언트의 폴백이다.
--    리텐션 쿼리는 이 행을 제외한다.
-- ---------------------------------------------------------------------------
select
  count(*) as total_events,
  count(*) filter (where visitor_id = session_id) as fallback_rows,
  round(
    100.0 * count(*) filter (where visitor_id = session_id) / nullif(count(*), 0),
    2
  ) as fallback_pct,
  min(created_at) as first_event_at,
  max(created_at) as last_event_at
from public.events
where created_at >= now() - interval '28 days';

-- ---------------------------------------------------------------------------
-- 1) DAU / 세션 / 이벤트 볼륨 (최근 28일)
-- ---------------------------------------------------------------------------
select
  timezone('Asia/Seoul', created_at)::date as day,
  count(*) as events,
  count(distinct visitor_id) as visitors,
  count(distinct session_id) as sessions
from public.events
where created_at >= now() - interval '28 days'
group by 1
order by 1 desc;

-- ---------------------------------------------------------------------------
-- 2) 검색 → AI 분석 실행률 (세션 기준, 최근 28일)
--    게이트 기준: analysis_rate_pct >= 30
--    - searched: search_submit 이 있는 세션
--    - analyzed: 같은 세션에서 analysis_click 이 있는 경우
--    - succeeded: 같은 세션에서 analysis_success 까지 간 경우
-- ---------------------------------------------------------------------------
with sessions as (
  select
    session_id,
    bool_or(name = 'search_submit') as searched,
    bool_or(name = 'analysis_click') as analyzed,
    bool_or(name = 'analysis_success') as succeeded
  from public.events
  where created_at >= now() - interval '28 days'
  group by session_id
)
select
  count(*) filter (where searched) as search_sessions,
  count(*) filter (where searched and analyzed) as analysis_sessions,
  count(*) filter (where searched and succeeded) as analysis_success_sessions,
  round(
    100.0 * count(*) filter (where searched and analyzed)
      / nullif(count(*) filter (where searched), 0),
    2
  ) as analysis_rate_pct,
  round(
    100.0 * count(*) filter (where searched and succeeded)
      / nullif(count(*) filter (where searched), 0),
    2
  ) as analysis_success_rate_pct
from sessions;

-- ---------------------------------------------------------------------------
-- 3) Pro 의향 클릭률 (방문자 기준, 최근 28일)
--    게이트 기준: pro_intent_pct_of_active >= 5
--    - 분모(active_visitors): 기간 내 이벤트가 1건 이상인 방문자
--    - 분자(pro_click_visitors): pro_waitlist_click 이 있는 방문자
--    - 검색자 기준 비율도 참고용으로 함께 출력한다.
-- ---------------------------------------------------------------------------
with visitors as (
  select
    visitor_id,
    bool_or(name = 'pro_waitlist_click') as pro_click,
    bool_or(name = 'search_submit') as searched
  from public.events
  where created_at >= now() - interval '28 days'
    and visitor_id <> session_id
  group by visitor_id
)
select
  count(*) as active_visitors,
  count(*) filter (where searched) as search_visitors,
  count(*) filter (where pro_click) as pro_click_visitors,
  round(
    100.0 * count(*) filter (where pro_click) / nullif(count(*), 0),
    2
  ) as pro_intent_pct_of_active,
  round(
    100.0 * count(*) filter (where pro_click)
      / nullif(count(*) filter (where searched), 0),
    2
  ) as pro_intent_pct_of_searchers
from visitors;

-- ---------------------------------------------------------------------------
-- 4) D1 / D7 리텐션 (방문자 기준)
--    게이트 기준: d7_pct >= 15
--    - cohort: 최근 35일 내 첫 이벤트, 최소 13일 경과 (D7+ 관측 완료 코호트)
--    - D1: 첫 방문 다음 날(KST) 활동
--    - D7 strict: 첫 방문 7일째 되는 날 활동
--    - D7+: 7~13일 사이 재방문 (표본이 적을 때 보조 지표)
--    - visitor_id = session_id 인 폴백 행은 제외한다. (구버전/0004 이전 데이터)
-- ---------------------------------------------------------------------------
with first_seen as (
  select visitor_id, min(created_at) as first_at
  from public.events
  where visitor_id <> session_id
  group by visitor_id
),
cohort as (
  select
    visitor_id,
    timezone('Asia/Seoul', first_at)::date as cohort_day
  from first_seen
  where first_at >= now() - interval '35 days'
    and first_at < now() - interval '13 days'
),
activity as (
  select distinct
    visitor_id,
    timezone('Asia/Seoul', created_at)::date as active_day
  from public.events
  where visitor_id <> session_id
),
retention as (
  select
    c.visitor_id,
    c.cohort_day,
    exists (
      select 1 from activity a
      where a.visitor_id = c.visitor_id
        and a.active_day = c.cohort_day + 1
    ) as d1,
    exists (
      select 1 from activity a
      where a.visitor_id = c.visitor_id
        and a.active_day = c.cohort_day + 7
    ) as d7,
    exists (
      select 1 from activity a
      where a.visitor_id = c.visitor_id
        and a.active_day between c.cohort_day + 7 and c.cohort_day + 13
    ) as d7plus
  from cohort c
)
select
  count(*) as cohort_size,
  count(*) filter (where d1) as d1_retained,
  round(100.0 * count(*) filter (where d1) / nullif(count(*), 0), 2) as d1_pct,
  count(*) filter (where d7) as d7_retained,
  round(100.0 * count(*) filter (where d7) / nullif(count(*), 0), 2) as d7_pct,
  count(*) filter (where d7plus) as d7plus_retained,
  round(100.0 * count(*) filter (where d7plus) / nullif(count(*), 0), 2) as d7plus_pct
from retention;

-- ---------------------------------------------------------------------------
-- 5) 게이트 요약 (설문 항목 제외)
--    - D7 리텐션 >= 15%
--    - 검색 → AI 분석 실행률 >= 30%
--    - Pro 의향 클릭률 >= 5%
--    - 사전 구매 의향(고유 방문자) >= 5명
--    표본이 30명 미만이면 INSUFFICIENT 로 표시한다.
--    "없으면 아쉽다" 설문은 events 로 측정할 수 없다 → docs/P3-GATE.md 참고.
-- ---------------------------------------------------------------------------
with params as (
  select now() - interval '28 days' as since
),
sessions as (
  select
    session_id,
    bool_or(name = 'search_submit') as searched,
    bool_or(name = 'analysis_click') as analyzed
  from public.events, params
  where created_at >= params.since
  group by session_id
),
visitors as (
  select
    visitor_id,
    bool_or(name = 'pro_waitlist_click') as pro_click
  from public.events, params
  where created_at >= params.since
    and visitor_id <> session_id
  group by visitor_id
),
first_seen as (
  select visitor_id, min(created_at) as first_at
  from public.events
  where visitor_id <> session_id
  group by visitor_id
),
cohort as (
  select visitor_id, timezone('Asia/Seoul', first_at)::date as cohort_day
  from first_seen
  where first_at >= now() - interval '35 days'
    and first_at < now() - interval '13 days'
),
activity as (
  select distinct visitor_id, timezone('Asia/Seoul', created_at)::date as active_day
  from public.events
  where visitor_id <> session_id
),
retention as (
  select
    c.visitor_id,
    exists (
      select 1 from activity a
      where a.visitor_id = c.visitor_id
        and a.active_day = c.cohort_day + 7
    ) as d7
  from cohort c
),
metrics as (
  select
    coalesce((
      select round(
        100.0 * count(*) filter (where searched and analyzed)
          / nullif(count(*) filter (where searched), 0),
        2
      )
      from sessions
    ), 0) as analysis_rate,
    (select count(*) filter (where searched) from sessions) as session_sample,
    coalesce((
      select round(100.0 * count(*) filter (where pro_click) / nullif(count(*), 0), 2)
      from visitors
    ), 0) as pro_rate,
    (select count(*) from visitors) as visitor_sample,
    (select count(*) filter (where pro_click) from visitors) as pro_count,
    coalesce((
      select round(100.0 * count(*) filter (where d7) / nullif(count(*), 0), 2)
      from retention
    ), 0) as d7_rate,
    (select count(*) from retention) as cohort_sample
)
select 1 as ord, 'D7 리텐션' as metric, d7_rate as metric_value, '%' as unit,
       15 as threshold,
       case when cohort_sample < 30 then 'INSUFFICIENT'
            when d7_rate >= 15 then 'PASS' else 'FAIL' end as status,
       cohort_sample as sample
from metrics
union all
select 2, '검색→AI 분석 실행률', analysis_rate, '%', 30,
       case when session_sample < 30 then 'INSUFFICIENT'
            when analysis_rate >= 30 then 'PASS' else 'FAIL' end,
       session_sample
from metrics
union all
select 3, 'Pro 의향 클릭률', pro_rate, '%', 5,
       case when visitor_sample < 30 then 'INSUFFICIENT'
            when pro_rate >= 5 then 'PASS' else 'FAIL' end,
       visitor_sample
from metrics
union all
select 4, '사전 구매 의향(고유 방문자)', pro_count, '명', 5,
       case when visitor_sample < 30 then 'INSUFFICIENT'
            when pro_count >= 5 then 'PASS' else 'FAIL' end,
       pro_count
from metrics
order by ord;
