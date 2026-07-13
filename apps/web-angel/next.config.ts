import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 모노레포 루트를 명시 — 상위 폴더의 무관한 lockfile을 루트로 오인하지 않게.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
};

export default nextConfig;
