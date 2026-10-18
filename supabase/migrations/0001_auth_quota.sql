-- TFT LAB: 계정/플랜/일일 사용량
-- Supabase SQL Editor 에서 그대로 실행하세요.

-- 1) 프로필 (auth.users 1:1)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- 플랜은 사용자가 직접 수정할 수 없다. (service role / SQL 로만 변경)

-- 2) 일일 사용량 (KST 기준)
create table if not exists public.usage_daily (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  bucket text not null,
  used integer not null default 0,
  primary key (user_id, day, bucket)
);

alter table public.usage_daily enable row level security;

drop policy if exists "usage_select_own" on public.usage_daily;
create policy "usage_select_own"
  on public.usage_daily for select
  using (auth.uid() = user_id);

-- 3) 신규 가입 시 프로필 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'user_name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) 원자적 일일 쿼터 소모
--    free/pro 한도를 인자로 받아 profiles.plan 에 따라 적용한다.
create or replace function public.consume_user_quota(
  p_bucket text,
  p_free_limit integer default 10,
  p_pro_limit integer default 50
)
returns table (allowed boolean, used integer, quota_limit integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text;
  v_limit integer;
  v_used integer;
  v_day date := (now() at time zone 'Asia/Seoul')::date;
begin
  if v_uid is null then
    return query select false, 0, 0;
    return;
  end if;

  select plan into v_plan from public.profiles where id = v_uid;
  v_limit := case when v_plan = 'pro' then p_pro_limit else p_free_limit end;

  insert into public.usage_daily (user_id, day, bucket, used)
  values (v_uid, v_day, p_bucket, 1)
  on conflict (user_id, day, bucket)
  do update set used = public.usage_daily.used + 1
  returning used into v_used;

  return query select (v_used <= v_limit), v_used, v_limit;
end;
$$;

revoke all on function public.consume_user_quota(text, integer, integer) from public;
grant execute on function public.consume_user_quota(text, integer, integer) to authenticated;

-- 5) 운영 확인용
-- select * from public.profiles;
-- select * from public.usage_daily order by day desc limit 20;
