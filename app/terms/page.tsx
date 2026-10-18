import type { Metadata } from 'next'
import { LegalList, LegalPageShell, LegalSection } from '@/app/components/LegalPageShell'
import { OPERATOR_NAME, SITE_NAME, SITE_URL } from '@/lib/site'

export const metadata: Metadata = {
  title: '이용약관',
  description: `${SITE_NAME} 서비스 이용약관`,
  alternates: { canonical: `${SITE_URL}/terms` },
  robots: { index: true, follow: true },
}

export default function TermsPage() {
  return (
    <LegalPageShell title="이용약관">
      <LegalSection title="제1조 (목적)">
        <p>
          본 약관은 {OPERATOR_NAME}(이하 &ldquo;운영자&rdquo;)가 제공하는 {SITE_NAME}(이하 &ldquo;서비스&rdquo;)의
          이용 조건, 절차, 이용자와 운영자의 권리·의무 및 책임 사항을 규정함을 목적으로 합니다.
        </p>
      </LegalSection>

      <LegalSection title="제2조 (정의)">
        <LegalList
          items={[
            '“서비스”란 TFT(롤토체스) 전적 조회, 메타 통계, AI 분석 리포트 등 운영자가 웹으로 제공하는 일체의 기능을 말합니다.',
            '“이용자”란 본 약관에 따라 서비스를 이용하는 자를 말합니다.',
            '“Riot ID”란 Riot Games가 부여하는 게임명과 태그(예: 이름#KR1)를 말합니다.',
            '“계정”이란 Discord OAuth를 통해 생성되는 서비스 이용 식별자와 그에 연결된 플랜·사용량 정보를 말합니다.',
          ]}
        />
      </LegalSection>

      <LegalSection title="제3조 (Riot Games와의 관계)">
        <p>
          본 서비스는 Riot Games, Inc. 및 그 계열사와 제휴·후원·보증 관계가 없습니다. 서비스에서 표시되는
          게임 데이터와 이미지의 권리는 Riot Games에 있으며, 운영자는 Riot Games의 개발자 정책 및
          게임 콘텐츠 정책이 허용하는 범위에서 이를 사용합니다.
        </p>
        <p>
          {SITE_NAME} is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games
          or anyone officially involved in producing or managing Riot Games properties. Riot Games and all
          associated properties are trademarks or registered trademarks of Riot Games, Inc.
        </p>
      </LegalSection>

      <LegalSection title="제4조 (서비스의 제공 및 변경)">
        <LegalList
          items={[
            '서비스는 연중무휴 제공을 목표로 하나, 점검·장애·외부 API 정책 변경 등으로 일시 중단될 수 있습니다.',
            '운영자는 서비스의 내용을 변경하거나 종료할 수 있으며, 중대한 변경은 사전에 서비스 내 공지합니다.',
            'Riot API의 응답 지연·한도 초과·정책 변경으로 일부 기능이 제한될 수 있습니다.',
          ]}
        />
      </LegalSection>

      <LegalSection title="제5조 (이용자의 의무)">
        <p>이용자는 다음 행위를 하여서는 안 됩니다.</p>
        <LegalList
          items={[
            '자동화된 프로그램으로 과도한 요청을 보내 서비스 또는 외부 API에 부하를 주는 행위',
            '서비스의 소스코드·API를 역설계하거나 무단으로 복제·재배포하는 행위',
            '타인의 Riot ID를 도용하거나 타인에게 피해를 주는 행위',
            '법령 또는 공서양속에 반하는 행위',
          ]}
        />
      </LegalSection>

      <LegalSection title="제5조의2 (계정)">
        <LegalList
          items={[
            '계정은 Discord OAuth를 통해 생성되며, 이용자는 자신의 계정과 연결된 외부 계정을 안전하게 관리해야 합니다.',
            '타인의 계정을 사용하거나 계정을 양도·판매할 수 없습니다.',
            '무료/Pro 플랜의 쿼터와 제공 기능은 운영 정책에 따라 변경될 수 있으며, 중요한 변경은 사전에 공지합니다.',
            '현재 유료 결제 기능은 제공하지 않습니다. 결제 도입 시 별도 약관 개정 및 고지가 이루어집니다.',
          ]}
        />
      </LegalSection>

      <LegalSection title="제6조 (지식재산권)">
        <p>
          서비스의 UI, 분석 로직, 리포트 구성 등 운영자가 창작한 부분의 권리는 운영자에게 있습니다.
          Riot Games의 게임 콘텐츠(기물·아이템 이미지, 게임 데이터 등)에 대한 권리는 Riot Games에 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제7조 (AI 분석 결과의 한계)">
        <p>
          AI 코칭 리포트는 확률적 모델이 생성한 참고 자료로, 정확성·완전성·특정 결과의 달성을 보증하지 않습니다.
          이용자는 리포트를 게임 플레이 판단의 보조 수단으로만 사용해야 하며, 이를 근거로 한 의사결정의
          책임은 이용자에게 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제8조 (책임의 제한)">
        <p>
          운영자는 천재지변, 외부 API 장애, 통신 장애 등 운영자의 합리적 통제를 벗어난 사유로 발생한
          서비스 중단·데이터 손실에 대해 책임을 지지 않습니다. 운영자의 고의 또는 중대한 과실이 없는 한,
          서비스 이용과 관련하여 발생한 간접·특별·징벌적 손해에 대해서는 책임을 지지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="제9조 (준거법 및 분쟁)">
        <p>
          본 약관은 대한민국 법률에 따라 해석되며, 분쟁이 발생한 경우 운영자의 소재지를 관할하는
          법원을 제1심 전속 관할 법원으로 합니다.
        </p>
      </LegalSection>

      <LegalSection title="부칙">
        <p>본 약관은 2026년 10월 18일부터 시행합니다.</p>
      </LegalSection>
    </LegalPageShell>
  )
}
