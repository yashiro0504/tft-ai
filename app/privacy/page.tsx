import type { Metadata } from 'next'
import { LegalList, LegalPageShell, LegalSection } from '@/app/components/LegalPageShell'
import { CONTACT_EMAIL, OPERATOR_NAME, SITE_NAME, SITE_URL } from '@/lib/site'

export const metadata: Metadata = {
  title: '개인정보처리방침',
  description: `${SITE_NAME} 개인정보처리방침`,
  alternates: { canonical: `${SITE_URL}/privacy` },
  robots: { index: true, follow: true },
}

export default function PrivacyPage() {
  return (
    <LegalPageShell title="개인정보처리방침">
      <LegalSection title="1. 총칙">
        <p>
          {OPERATOR_NAME}(이하 &ldquo;운영자&rdquo;)는 {SITE_NAME}(이하 &ldquo;서비스&rdquo;) 이용자의 개인정보를
          관련 법령에 따라 안전하게 처리합니다. 본 방침은 서비스가 어떤 정보를 수집하고 어떻게 이용·보관·파기하는지
          설명합니다.
        </p>
      </LegalSection>

      <LegalSection title="2. 수집하는 정보">
        <LegalList
          items={[
            '이용자가 입력한 Riot ID(게임명 및 태그)',
            '소셜 로그인(선택, 카카오·Google·Discord) 시: 해당 서비스의 사용자 ID, 이메일(제공에 동의한 경우), 표시 이름(닉네임), 프로필 이미지 URL',
            '서비스 이용 과정에서 자동 생성되는 정보: IP 주소, 브라우저/기기 정보(User-Agent), 요청 시각, 접속 기록',
            '서비스 개선을 위한 이용 이벤트: 검색·AI 분석·탭 전환·덱 열람·공유·로그인 클릭 등의 발생 사실과 시각, 익명 세션 식별자(브라우저 세션 단위 임의 문자열)',
            '로그인 사용자가 직접 저장한 즐겨찾기: 소환사 이름(게임명)과 태그, 저장 시각',
            '브라우저 로컬 저장소(localStorage)에 저장되는 테마 설정값(다크/라이트)',
            '브라우저 로컬 저장소(localStorage)에 저장되는 최근 검색 5건(소환사 이름·태그)',
            '브라우저 세션 저장소(sessionStorage)에 저장되는 익명 세션 식별자',
            '재방문 추이 집계를 위해 브라우저 로컬 저장소(localStorage)에 저장되는 익명 방문자 식별자(임의 문자열, 개인정보 미포함)',
          ]}
        />
        <p className="text-xs text-subtle">
          서비스는 비밀번호, 주민등록번호, 결제 정보, 위치 정보 등 민감정보를 수집하지 않습니다. 이용 이벤트에는
          Riot ID, 이메일, PUUID 등 이용자를 식별할 수 있는 정보를 기록하지 않으며, 어떤 화면에서 어떤 동작이
          발생했는지만 집계합니다.
        </p>
      </LegalSection>

      <LegalSection title="3. 이용 목적">
        <LegalList
          items={[
            'Riot ID를 이용한 전적·메타 데이터 조회 및 AI 분석 리포트 생성',
            '로그인 사용자의 계정 식별, 플랜(무료/Pro) 관리, 일일 사용 쿼터 산정',
            '서비스 오류 대응, 성능 모니터링, 비정상 트래픽(남용) 방지',
            '이용 이벤트 분석을 통한 화면 구성·기능 개선 및 서비스 기획',
            '이용자 문의 응대 및 분쟁 처리',
          ]}
        />
      </LegalSection>

      <LegalSection title="4. 보관 기간 및 파기">
        <LegalList
          items={[
            '검색 결과 캐시: 최대 60초',
            'Riot 계정 식별 정보(PUUID) 캐시: 최대 24시간',
            '소환사 레벨/아이콘 캐시: 최대 6시간',
            '정규화된 매치 데이터 캐시: 최대 30일 (불변 경기 데이터)',
            'AI 분석 리포트 캐시: 최대 24시간',
            '계정 정보(프로필, 플랜): 회원 탈퇴 또는 삭제 요청 시까지',
            '즐겨찾기: 이용자가 직접 삭제하거나 회원 탈퇴할 때까지',
            '일일 사용량 기록: 최대 90일',
            '이용 이벤트 기록: 최대 90일',
            '익명 방문자 식별자(localStorage): 이용자가 브라우저 데이터를 삭제할 때까지 (서버 이벤트 기록은 최대 90일)',
            '접속 기록 및 오류 로그: 호스팅 사업자의 보관 정책에 따르며, 운영 목적 달성 시 지체 없이 파기',
          ]}
        />
        <p>
          보관 기간이 지나거나 처리 목적이 달성된 정보는 복구할 수 없는 방법으로 파기합니다. 다만 법령에서
          보존을 요구하는 경우 해당 기간 동안 보관합니다.
        </p>
      </LegalSection>

      <LegalSection title="5. 제3자 제공 및 처리 위탁">
        <p>
          서비스는 원활한 기능 제공을 위해 아래 외부 서비스를 이용하며, 이 과정에서 최소한의 정보가 국외로
          이전될 수 있습니다.
        </p>
        <LegalList
          items={[
            'Riot Games API — Riot ID/PUUID 기반 전적 조회 (서비스 제공을 위한 필수 처리)',
            'DeepSeek — AI 분석 프롬프트 생성 (경기 요약 데이터 및 소환사명 포함, 분석 결과 생성 목적)',
            'Google Gemini — DeepSeek 실패 시 대체 분석 (선택적, 동일 목적)',
            'Vercel — 웹 호스팅 및 접속 로그 처리',
            'Upstash — 캐시 저장 (설정된 경우에 한함)',
            'Cloudflare Turnstile — 자동화 요청(봇) 차단을 위한 브라우저 검증 (IP 주소·브라우저 정보 처리, 검색 시)',
            'Supabase — 로그인 인증 및 계정/사용량/즐겨찾기 데이터 저장 (로그인 사용 시)',
            '카카오 — OAuth 로그인 인증 (카카오 로그인 사용 시)',
            'Google — OAuth 로그인 인증 (Google 로그인 사용 시)',
            'Discord — OAuth 로그인 인증 (Discord 로그인 사용 시)',
          ]}
        />
        <p className="text-xs text-subtle">
          각 사업자의 소재지 및 개인정보 처리방침은 해당 사업자의 공식 문서를 참고하시기 바랍니다.
          운영자는 위 목적 외로 정보를 제3자에게 판매하거나 제공하지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="6. 쿠키 및 로컬 저장소">
        <p>
          서비스는 광고·추적 목적의 쿠키를 사용하지 않습니다. 테마 설정을 유지하기 위해 브라우저
          localStorage에 값을 저장하며, 브라우저 설정에서 언제든지 삭제할 수 있습니다.
        </p>
        <p>
          검색 편의를 위해 최근 검색한 소환사(이름·태그) 최대 5건을 localStorage에 저장합니다. 이 값은
          브라우저에만 남고 서버로 전송되지 않으며, 검색창 아래 칩의 × 버튼이나 브라우저 데이터 삭제로
          언제든지 지울 수 있습니다.
        </p>
        <p>
          또한 서비스 개선을 위한 이용 이벤트를 묶어서 보기 위해 sessionStorage에 익명 세션 식별자(임의의
          문자열)를 저장합니다. 이 값에는 개인정보가 포함되지 않으며, 브라우저 탭을 닫으면 사라집니다.
          브라우저 설정에서 저장 데이터를 삭제하면 언제든지 초기화됩니다.
        </p>
        <p>
          재방문 추이(리텐션)를 집계하기 위해 localStorage에 익명 방문자 식별자(임의 문자열)를 저장합니다.
          이 값은 개인정보를 포함하지 않으며, 사이트 간 추적이나 광고에 사용하지 않습니다. 브라우저
          데이터를 삭제하면 새 식별자가 발급됩니다.
        </p>
        <p>
          검색 또는 봇 검증을 통과한 브라우저임을 확인하기 위해 서명된 쿠키(tftlg)를 2시간 동안 저장합니다.
          이 쿠키에는 발급 시각과 서명만 들어 있고 개인정보는 포함되지 않으며, 만료되면 자동으로 삭제됩니다.
        </p>
      </LegalSection>

      <LegalSection title="7. 이용자의 권리">
        <p>
          이용자는 자신의 정보에 대한 열람·정정·삭제·처리 정지를 요청할 수 있습니다. 로그인 사용자는
          계정 삭제를 요청할 수 있으며, 비로그인 이용자는 Riot ID를 함께 알려주시면 캐시 및 관련 기록을
          확인 후 처리합니다.
        </p>
        <LegalList
          items={[
            <>
              문의 이메일:{' '}
              <a className="underline hover:text-ink" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
            </>,
            '요청 접수 후 영업일 기준 7일 이내에 처리 결과를 회신합니다.',
          ]}
        />
      </LegalSection>

      <LegalSection title="8. 아동의 개인정보">
        <p>
          만 14세 미만 아동이 서비스를 이용하려는 경우 법정대리인의 동의가 필요합니다. 운영자는 만 14세 미만
          아동의 개인정보를 알면서 수집하지 않으며, 확인되는 즉시 파기합니다.
        </p>
      </LegalSection>

      <LegalSection title="9. 안전성 확보 조치">
        <LegalList
          items={[
            '전송 구간 암호화(HTTPS) 적용',
            '외부 API 키를 서버 환경변수로만 보관하고 클라이언트에 노출하지 않음',
            '요청 빈도 제한 및 비정상 트래픽 모니터링',
            '보관 기간이 짧은 캐시 정책을 통한 최소 수집',
          ]}
        />
      </LegalSection>

      <LegalSection title="10. 방침의 변경">
        <p>
          본 방침이 변경되는 경우 시행 7일 전부터 서비스 내에 공지합니다. 중요한 변경이 있는 경우에는
          별도의 방법으로 안내할 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="11. 문의처">
        <p>
          개인정보 관련 문의: {OPERATOR_NAME} ·{' '}
          <a className="underline hover:text-ink" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}
