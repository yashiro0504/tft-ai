import type { Config } from 'tailwindcss'

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
        background: '#090D16',
        // 테마 토큰 (globals.css 의 CSS 변수 → 라이트/다크 전환)
        app: 'rgb(var(--app-bg) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',
        elev: 'rgb(var(--elev) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-soft': 'rgb(var(--ink-soft) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
      },
      // 가독성: 기본 타입 스케일을 한 단계 키우고 행간을 넉넉히
      fontSize: {
        xs: ['13px', { lineHeight: '1.6' }],
        sm: ['15px', { lineHeight: '1.65' }],
        base: ['16px', { lineHeight: '1.7' }],
        lg: ['18px', { lineHeight: '1.6' }],
        xl: ['20px', { lineHeight: '1.55' }],
        '2xl': ['24px', { lineHeight: '1.45' }],
        '3xl': ['30px', { lineHeight: '1.35' }],
        '4xl': ['38px', { lineHeight: '1.25' }],
      },
    },
  },
  plugins: [],
}

export default config

