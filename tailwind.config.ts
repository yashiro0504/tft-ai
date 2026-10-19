import type { Config } from 'tailwindcss'

// globals.css 의 hex 토큰을 Tailwind 색으로 노출한다. color-mix 로 감싸서 `bg-accent/10` 같은 투명도 표기도 동작한다.
const token = (name: string) =>
  `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`

const PRETENDARD = [
  '"Pretendard Variable"',
  'Pretendard',
  '-apple-system',
  'BlinkMacSystemFont',
  'system-ui',
  'sans-serif',
]

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 테마 토큰 (디자인 가이드 1장 → 라이트/다크 전환)
        app: token('bg'),
        panel: token('surface'),
        sunken: token('surface-2'),
        elev: token('surface-2'),
        ink: token('text'),
        'ink-soft': token('text'),
        muted: token('text-2'),
        subtle: token('text-3'),
        line: token('border'),
        accent: token('accent'),
        'accent-bg': token('accent-bg'),
        'on-accent': token('on-accent'),
        // 데이터 의미 색
        good: token('good'),
        bad: token('bad'),
        gold: token('gold'),
        'cost-1': token('cost-1'),
        'cost-2': token('cost-2'),
        'cost-3': token('cost-3'),
        'cost-4': token('cost-4'),
        'cost-5': token('cost-5'),
      },
      // 글자색으로 쓸 때만 대비를 확보한 값으로 바꾼다 (띠·막대·테두리·바탕은 원래 값)
      textColor: {
        good: token('good-text'),
        bad: token('bad-text'),
        gold: token('gold-text'),
      },
      fontFamily: {
        sans: PRETENDARD,
        pretendard: PRETENDARD,
        mono: PRETENDARD,
      },
      borderRadius: {
        card: 'var(--radius-card)',
        control: 'var(--radius-control)',
        chip: 'var(--radius-chip)',
      },
      boxShadow: {
        card: 'var(--shadow)',
      },
      // 디자인 가이드 2장 글자 크기 (이보다 작게 쓰지 않는다)
      fontSize: {
        xs: ['12px', { lineHeight: '1.6' }], // 칩, 아이콘 이름
        sm: ['14px', { lineHeight: '1.65' }], // 본문, 표 숫자
        base: ['15px', { lineHeight: '1.65' }], // 덱 이름, 카드 제목
        lg: ['15px', { lineHeight: '1.6' }],
        xl: ['20px', { lineHeight: '1.5' }], // 섹션 제목
        '2xl': ['24px', { lineHeight: '1.4' }],
        '3xl': ['28px', { lineHeight: '1.35' }], // 페이지 제목
        '4xl': ['28px', { lineHeight: '1.3' }],
      },
    },
  },
  plugins: [],
}

export default config
