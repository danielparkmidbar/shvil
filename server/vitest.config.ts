import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@shvil/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    // 발행 개인키 봉인용 테스트 KEK (H-2). keystore.test는 이를 명시적으로 지워 검증한다.
    env: { SHVIL_KEK: 'test-key-encryption-key-0000000000000000000000000000000000000000' },
  },
});
