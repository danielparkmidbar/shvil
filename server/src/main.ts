import { buildApp } from './app';

const PORT = Number(process.env.PORT ?? 8787);

const app = buildApp({ dbPath: process.env.SHVIL_DB ?? 'shvil-directory.db', devMode: true });

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => console.log(`쉬빌 디렉토리 서버 — http://localhost:${PORT} (거래 승인 기능 없음)`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
