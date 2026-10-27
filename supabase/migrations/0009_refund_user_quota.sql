-- AI 제공자 장애(DeepSeek 잔액 소진 등)로 규칙 기반 폴백 리포트만 준 경우,
-- 이미 소모한 일일 쿼터 1회를 되돌린다. 0 아래로는 내려가지 않는다.
create or replace function public.refund_user_quota(p_bucket text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Seoul')::date;
begin
  if v_uid is null then
    return;
  end if;

  update public.usage_daily
     set used = greatest(used - 1, 0)
   where user_id = v_uid and day = v_day and bucket = p_bucket;
end;
$$;

revoke all on function public.refund_user_quota(text) from public;
grant execute on function public.refund_user_quota(text) to authenticated;
