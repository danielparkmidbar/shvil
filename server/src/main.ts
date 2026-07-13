import { buildApp } from './app';

const PORT = Number(process.env.PORT ?? 8787);

// 보안 감사 C-1: dev 라우트(OTP 코드 반환·dev-deposit·소명 수동 등재)는
// SHVIL_DEV_MODE=1을 명시할 때만 켜진다. 운영 기본은 꺼짐.
const devMode = process.env.SHVIL_DEV_MODE === '1';

// 보안 감사 H-2: 운영에서는 발행 개인키 봉인용 KEK가 필수다. buildApp이
// resolveKek로 검사하지만, 기동 시점에 명확한 안내를 남긴다.
if (!devMode && !process.env.SHVIL_KEK) {
  console.error('SHVIL_KEK 환경변수가 필요합니다 (발행 개인키 봉인용). 운영 기동을 중단합니다.');
  process.exit(1);
}

const app = buildApp({ dbPath: process.env.SHVIL_DB ?? 'shvil-directory.db', devMode });

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() =>
    console.log(
      `쉬빌 디렉토리 서버 — http://localhost:${PORT} (거래 승인 기능 없음)` +
        (devMode ? ' [DEV MODE — 운영 배포 금지]' : ''),
    ),
  )
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
