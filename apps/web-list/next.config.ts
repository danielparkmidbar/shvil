import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 정적 내보내기 (Cloudflare Pages 등) — 서버 API·SSR 미사용, 클라이언트 fetch만.
  // 서버 URL은 빌드 시 NEXT_PUBLIC_DIRECTORY_URL로 인라인된다.
  output: 'export',
  images: { unoptimized: true },
  // 모노레포 루트를 명시 — 상위 폴더의 무관한 lockfile을 루트로 오인하지 않게.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
};

export default nextConfig;
