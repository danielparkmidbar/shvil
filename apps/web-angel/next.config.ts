import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 정적 내보내기 (Cloudflare Pages 등 정적 호스팅용) — 서버 API·SSR 미사용,
  // 데이터는 전부 클라이언트에서 fetch하므로 순수 정적 HTML/JS로 빌드된다.
  // 서버 URL은 빌드 시 NEXT_PUBLIC_DIRECTORY_URL로 인라인된다.
  output: 'export',
  images: { unoptimized: true },
  // @shvil/shared는 raw TypeScript를 노출하는 워크스페이스 패키지 —
  // 지역 카탈로그(regions.ts)를 웹에서 import하므로 컴파일 대상으로 명시한다.
  transpilePackages: ['@shvil/shared'],
  // 모노레포 루트를 명시 — 상위 폴더의 무관한 lockfile을 루트로 오인하지 않게.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
};

export default nextConfig;
