-- AI 분석 횟수는 새 리포트 생성이 성공해 저장된 뒤에만, 멱등 키당 한 번만 차감한다 (2026-10-29 지시문 2).
-- 캐시 적중·생성 실패·타임아웃은 차감하지 않고, 더블클릭·재시도로 같은 키가 두 번 와도 1회만 센다.
create table if not exists public.quota_charges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  bucket text not null,
  idem_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day, bucket, idem_key)
);

alter table public.quota_charges enable row level security;
-- 사용자가 직접 읽거나 쓰지 않는다 (아래 security definer 함수로만)

create or replace function public.charge_user_quota(
  p_bucket text,
  p_idem_key text,
  p_free_limit integer default 3,
  p_pro_limit integer default 10
)
returns table (charged boolean, used integer, quota_limit integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text;
  v_limit integer;
  v_used integer;
  v_new integer;
  v_day date := (now() at time zone 'Asia/Seoul')::date;
begin
  if v_uid is null then
    return query select false, 0, 0;
    return;
  end if;

  select plan into v_plan from public.profiles where id = v_uid;
  v_limit := case when v_plan = 'pro' then p_pro_limit else p_free_limit end;

  insert into public.quota_charges (user_id, day, bucket, idem_key)
  values (v_uid, v_day, p_bucket, p_idem_key)
  on conflict do nothing;
  get diagnostics v_new = row_count;

  if v_new = 1 then
    insert into public.usage_daily (user_id, day, bucket, used)
    values (v_uid, v_day, p_bucket, 1)
    on conflict (user_id, day, bucket)
    do update set used = public.usage_daily.used + 1
    returning public.usage_daily.used into v_used;
  else
    select u.used into v_used from public.usage_daily u
     where u.user_id = v_uid and u.day = v_day and u.bucket = p_bucket;
  end if;

  return query select (v_new = 1), coalesce(v_used, 0), v_limit;
end;
$$;

revoke all on function public.charge_user_quota(text, text, integer, integer) from public;
grant execute on function public.charge_user_quota(text, text, integer, integer) to authenticated;
