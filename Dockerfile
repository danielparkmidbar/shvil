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
#   SHVIL_ROOT_SEED       ★발행 키 유도 시드 (필수 — 없으면 기동 실패).
#                         모든 발행 키가 여기서 결정적으로 유도되므로 DB가 초기화돼도
#                         같은 키가 나온다. 생성: node tools/시드생성.mjs
#                         ★종이에 적어 보관할 것. 잃어버리면 발행 권위가 영구히 사라진다.
#   SHVIL_EXPECT_DIST_KEY_ID  ★선택 — 종이에 적어 둔 배포 열쇠 이름. 유도 결과가 다르면
#                         기동을 거부한다(시드 오타 방지). 비밀이 아니다(/keys에 공개된 값).
#                         시드는 한 글자를 틀려도 서버가 **정상 기동**하므로 이 관문이 아니면
#                         사람이 /health를 종이와 대조하는 것 외에 잡을 방법이 없다.
#   SHVIL_KEY_GENERATION  키 세대 (미지정 시 0). 회전할 때만 1씩 올린다.
#                         ★시드가 유출된 경우에는 세대를 올려도 소용없다(유출자가 같은
#                         시드로 다음 세대를 그대로 유도한다). docs/서버_키_지속성.md 6장.
#   SHVIL_ALLOW_EPHEMERAL_KEYS  '1'이면 시드 없이도 기동(권장하지 않음 — 재배포마다 키가 바뀐다)
#   SHVIL_KEK       발행 개인키 봉인 키 (필수 — 없으면 기동 실패, 보안 감사 H-2)
#   SHVIL_DEV_MODE  '1'이면 dev 라우트 활성 (닫힌 시험용 — 공개 운영 금지, C-1)
#   SHVIL_DB        SQLite 경로 (미지정 시 shvil-directory.db — 무료 티어는 재시작 시 초기화)
#                   ★시드 도입 후에도 회원 명부·증서 기록·지갑 백업·에스크로·발행 수량
#                   카운터·스팟 예치 회계는 여전히 재시작마다 사라진다(시드는 원장을 살리지 않는다).
CMD ["npm", "run", "start", "-w", "@shvil/server"]
