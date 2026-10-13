/** @type {import('next').NextConfig} */
const nextConfig = {
  // ⚠️ 타입 에러를 숨기지 않습니다. (Phase 0: ignoreBuildErrors 제거)
  // 빌드 시 타입 체크가 실제로 수행되며, 타입 오류가 있으면 빌드가 실패합니다.
  reactStrictMode: true,
  images: {
    // 참고: 현재는 <img> 태그를 사용하므로 next/image 최적화는 비활성 상태입니다.
    // 향후 next/image 로 이전할 때 remotePatterns 를 아래와 같이 설정하세요.
    // remotePatterns: [
    //   { protocol: 'https', hostname: 'ddragon.leagueoflegends.com' },
    // ],
    unoptimized: true,
  },
}

export default nextConfig
