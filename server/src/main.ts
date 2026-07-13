import { buildApp } from './app';

const PORT = Number(process.env.PORT ?? 8787);

// 보안 감사 C-1: dev 라우트(OTP 코드 반환·dev-deposit·소명 수동 등재)는
// SHVIL_DEV_MODE=1을 명시할 때만 켜진다. 운영 기본은 꺼짐.
const devMode = process.env.SHVIL_DEV_MODE === '1';

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
