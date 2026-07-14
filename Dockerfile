# 쉬빌 디렉토리 서버 컨테이너 (Render 등 Node 호스팅용).
# 모노레포 루트 기준 — @shvil/shared 워크스페이스 링크를 위해 전체를 설치한다.
# 서버는 tsx로 TS 소스를 직접 실행하므로 별도 빌드 단계가 없다.
#
# node:sqlite는 Node 24에서 안정화 — 24 이미지 사용.
FROM node:24-slim

WORKDIR /app

# 워크스페이스 설치에 필요한 매니페스트만 먼저 복사 (레이어 캐시).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY apps/wallet/package.json apps/wallet/
COPY apps/web-angel/package.json apps/web-angel/
COPY apps/web-list/package.json apps/web-list/

# 서버·공유 패키지 실행에 필요한 의존성 설치 (tsx는 devDependency라 dev 포함).
RUN npm install --no-audit --no-fund

# 소스 복사 (서버 + 공유 코어).
COPY packages/shared ./packages/shared
COPY server ./server
COPY tsconfig.base.json ./

# Render 등은 PORT를 주입한다. server/src/main.ts가 process.env.PORT를 읽는다.
ENV PORT=8787
EXPOSE 8787

# 운영 필수 환경변수(호스팅 대시보드에서 설정):
#   SHVIL_KEK       발행 개인키 봉인 키 (필수 — 없으면 기동 실패, 보안 감사 H-2)
#   SHVIL_DEV_MODE  '1'이면 dev 라우트 활성 (닫힌 시험용 — 공개 운영 금지, C-1)
#   SHVIL_DB        SQLite 경로 (미지정 시 shvil-directory.db — 무료 티어는 재시작 시 초기화)
CMD ["npm", "run", "start", "-w", "@shvil/server"]
