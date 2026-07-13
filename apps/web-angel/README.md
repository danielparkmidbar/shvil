# @shvil/web-angel — shvilangel.org (지시서 5장)

엔젤의 집: 랜딩 · 엔젤 지도 · 코인 마켓 · 투명성 페이지 (Next.js App Router).

## 원칙

- **공개(비서명) API만 소비한다**: `GET /angels` · `GET /courses` ·
  `GET /market/listings` · `GET /transparency/promo` · `GET /transparency/market`.
  지불·수령·가격 제시·승인은 전부 지갑 앱의 영역이다 — 이 웹에는 SHV 거래를
  승인·중계·기록하는 코드가 없다.
- 데이터 fetch는 전부 클라이언트 컴포넌트에서 한다 — 프리렌더가 디렉토리
  서버 가동에 의존하지 않고, 서버 미가동 시 안내 문구로 처리된다.
- 마켓 UI는 **가격 열의 부재**를 드러낸다 (무정가 리스팅 — 가격은 구매자가
  제시). 수수료 2.5%는 체결 시에만, 대면 지불은 영구 무료.
- 다국어(en/he/ko/es)는 M4 — 모든 문자열은 `src/i18n`의 `Strings` 계약을
  통해서만 사용하고, 히브리어 RTL은 `dirOf()`로 `<html dir>`에 이미 배선되어
  있다. 지금은 ko 사전만 구현.

## 페이지

| 경로 | 내용 |
|---|---|
| `/` | 비전 + 엔젤 등록 흐름 + 지갑 다운로드(플레이스홀더) |
| `/map` | maplibre-gl + OSM 래스터 타일, 엔젤 마커·서비스 필터·프로필 카드, 코스 폴리라인, `shvil://chat/{memberId}` 딥링크 |
| `/market` | 무정가 리스팅 (판매자·수량·등록일 — 가격 열 없음) |
| `/transparency` | 프로모션 발행·마켓 체결/수수료 공시 + 집계 준비 중 플레이스홀더 |

## 실행

```
npm run dev        # http://localhost:3000
npm run build      # 프로덕션 빌드
npm run typecheck  # tsc --noEmit
```

환경변수: `NEXT_PUBLIC_DIRECTORY_URL` — 디렉토리 서버 주소 (기본
`http://localhost:8787`). 디렉토리 서버는 `server/`에서 `npm run dev`.

참고: `dev`/`build`에 `--webpack` 플래그를 쓴다 — Next 16 기본 번들러인
Turbopack이 한글이 포함된 저장소 경로("쉬빌 프로젝트/쉬빌코인")에서 멀티바이트
문자를 바이트 인덱스로 자르다 패닉하는 버그가 있어(turbopack-core ident.rs
char boundary panic) webpack으로 우회한다. 버그 수정 후 플래그를 제거하면 된다.
