# Supabase 계정 · 플랜 · 사용자 쿼터 설정

2026-10-18 추가. 로그인은 **선택 사항**이며, Supabase가 설정되지 않아도 사이트는 기존처럼
익명(IP 기준) 쿼터로 동작한다.

## 1. Supabase 프로젝트

1. https://supabase.com/dashboard → New project
   - 리전: **Northeast Asia (Seoul)** 또는 Tokyo
   - DB 비밀번호는 금고에 보관
2. SQL Editor 에서 `supabase/migrations/0001_auth_quota.sql` 전체 실행

생성되는 것:
- `public.profiles` (id, display_name, avatar_url, plan)
- `public.usage_daily` (user_id, day, bucket, used) — KST 기준
- 신규 가입 시 프로필 자동 생성 트리거
- `consume_user_quota(bucket, free_limit, pro_limit)` RPC

## 2. Discord OAuth

1. https://discord.com/developers/applications → New Application
2. OAuth2 → Client ID / Client Secret 복사
3. OAuth2 → Redirects 에 추가:
   `https://<project-ref>.supabase.co/auth/v1/callback`
4. Supabase Dashboard → Authentication → Providers → **Discord** 활성화 후 ID/Secret 입력

## 3. Supabase URL 설정

Authentication → URL Configuration

- **Site URL**: `https://www.tftlab.kr`
- **Redirect URLs**:
  - `https://www.tftlab.kr/auth/callback`
  - `http://localhost:3000/auth/callback`

## 4. Vercel 환경변수

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
```

- `NEXT_PUBLIC_*` 는 **빌드 타임 인라인** → 등록 후 **재배포**(새 커밋 권장)
- Secret 타입이 아니라 **Config/Plain** 으로 저장해야 클라이언트 번들에 들어간다
- **service role key 는 사용하지 않는다.** RLS + security definer RPC 로 처리

## 5. 확인

1. `/login` → Discord 로그인 → `/auth/callback` → 홈 복귀
2. `/api/me`:
   ```json
   {
     "configured": true,
     "user": { "id": "...", "displayName": "...", "avatarUrl": "..." },
     "plan": "free",
     "usage": { "search": 0, "analysis": 0, "overview": 0 },
     "limits": { "search": 50, "analysis": 3, "overview": 3 }
   }
   ```
3. `/api/health` → `integrations.supabase = true`
4. AI 분석 1회 실행 후 `usage_daily` 의 `analysis` 증가 확인
5. 로그아웃 → 다시 익명 쿼터로 동작

## 6. Pro 플랜 부여 (수동)

```sql
update public.profiles set plan = 'pro' where id = '<user-uuid>';
```

- Pro 한도는 환경변수로 조정:
  `QUOTA_SEARCH_PRO_PER_DAY=200`, `QUOTA_ANALYSIS_PRO_PER_DAY=10`, `QUOTA_OVERVIEW_PRO_PER_DAY=10`
- 결제 연동 전까지는 운영자가 수동으로 부여한다.

## 7. 보안 메모

- `profiles` 는 **본인 SELECT 만** 허용, UPDATE 정책 없음 → 사용자가 스스로 Pro 로 변경 불가
- `usage_daily` 는 본인 SELECT 만 허용, 쓰기는 RPC(security definer)만 가능
- RPC 는 `search_path = public` 고정, `authenticated` 에만 실행 권한
- Supabase/Vercel/GitHub/Cloudflare **2FA** 필수
- Supabase RPC 오류 시 IP 쿼터로 폴백한다(fail-open). `quota_user_rpc_failed` 로그를 모니터링

## 8. 한계 / 다음 단계

- 결제(구독)는 아직 없음. Pro 는 수동 부여
- Discord 외 로그인 제공자 미지원
- 계정 삭제는 문의 메일로 접수 → `auth.users` 삭제 시 프로필/사용량 cascade
- 향후: Stripe/토스 결제, 플랜 변경 이력, 팀/코치 플랜
