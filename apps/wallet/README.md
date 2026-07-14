# @shvil/wallet — 쉬빌 지갑 앱 (M1 리스트 모드 + M2 엔젤 모드·메신저 + M3 마켓)

React Native (Expo SDK 57) + TypeScript. 코인 코어는 `@shvil/shared` 공유.
하나의 앱, 두 모드 — 모드 전환은 토글 한 번 (더보기 → 내 포인트).

## 구조

```
src/
  walk/            회랑 판정 (좌표는 여기의 휘발성 버퍼에서만 존재)
    geo.ts           하버사인·폴리라인 투영 (반환은 거리뿐)
    courses.ts       코스 데이터 스키마 (회랑 폭·난이도 = 구간 속성)
    corridorEngine.ts 창 단위 판정: 코스 위/이탈/일상/엔젤 우회 → WalkSample 방출 후 좌표 폐기
    data/            내장 코스 (쉬빌 이스라엘 북부 샘플 — 파일럿 확정 시 교체)
  core/
    identity.ts      니모닉(진실의 원천)→기기·메시징·백업 키 유도, 회원 번호, 복구 (L-2)
    db.ts            SQLite 로컬 원장 — 코인·잠정 스냅숏·영수증·대화 (좌표 컬럼 없음)
    walletService.ts 잠정 누적→정산(사용/수동만)→민팅, QR 지불/수령, 모드, grant 민팅,
                     마켓 커스터디(리스팅 선택→에스크로 이전 서명→ESCROWED 잠금→완료 정리)
    walkService.ts   GPS+만보기 → 회랑 엔진 → 60초 창 → 원장 (코스·엔젤 캐시 사용)
    api.ts           디렉토리 서버 타입드 클라이언트 (순수 TS — 거래 승인 API 없음)
    coinSelection.ts 코인 선택·분할 계산 (순수 로직 — 오래된 것부터, 잔돈 분할 계획)
    amounts.ts       금액 파싱·표기 (dSHV·USDC micro 정수만 — 부동소수점 없음)
    directory.ts     서버 URL(kv 오버라이드)·프로모 키·코스/엔젤 캐시 wiring
    angelService.ts  엔젤 프로필(자발 공개 포인트)·등록 20/첫 접대 30 SHV 보너스
    chatService.ts   E2E 메신저 — sealMessage/openMessage, 10초 폴링, 평문은 기기 안에서만
  screens/         홈 · 걷기(여기서 정산) · 지갑(엔젤 모드 "판매하기" 진입) · 거래(지불/수령)
                   · 더보기: 엔젤 지도 · 메시지/채팅 · 내 포인트(엔젤) · 마켓 · 가입/설정
```

## 디렉토리 서버 연동 (server/ — 거래 승인 기능 없음)

- 기본 URL `http://localhost:8787` — 더보기 → 가입/설정에서 변경 (실기기는 LAN IP).
- 서버가 꺼져 있어도 걷기·정산·QR 지불 전 과정이 동작한다 (오프라인 우선).
- 서명 인증: 기기 키로 요청 서명 (`buildAuthHeaders`, pathname은 쿼리 제외).
- 보너스 민팅은 기기에서 — 서버는 SignedGrant 승인서만 발행 (지시서 2.4).

## 코인 마켓 (M3 — 더보기 → 마켓, 온라인 전용)

- 무정가 리스팅(엔젤, 수량만) → 구매자 가격 제시(USDC) → 엔젤 승인 → 에스크로.
- 에스크로: USDC 예치(개발 모드 시뮬레이션) → 판매자 코인 이전 서명(createTransfer,
  해당 코인 ESCROWED 잠금) → 구매자 확인 서명(acknowledgeTransfer + 로컬 위조·인간
  한계·이중 수령 검사) → USDC 방출(수수료 차감) → 판매자 코인 SPENT 정리.
- 서버의 역할은 에스크로 상태 관리뿐 — SHV 이전은 두 지갑의 서명으로 완결된다.
- 구매 코인은 'RECEIVED' 계보로 저장 — 걸음 코인과 영구 구분. 대면 지불은 영구 무료.
- 상태 갱신은 화면 focus + 수동 새로고침뿐. 오프라인이면 온라인 전제 안내.

## 실행·테스트

```
npm start        # Expo 개발 서버 (Expo Go로 실행)
npm test         # 회랑 판정·API 서명 헤더·코인 선택/분할·금액 파싱 테스트 (vitest)
npm run typecheck
```

실기기 검증 절차: `docs/M1_실기기_테스트_가이드.md`

## 남은 항목

- MapLibre + OSM 오프라인 지도 팩 (엔젤 지도 실지도) · 진행 방향 앞쪽 엔젤 정렬
- 백그라운드 상시 추적 (expo-task-manager + 개발 빌드) · 배터리 절약 모드
- Play Integrity / App Attest 실토큰 첨부 (결정 대기 3번)
- 니모닉 백업 UI (결정 대기 4번) · 지문/페이스 인증 후 지불
- 대용량 지불의 분할 프레임 QR (또는 BLE/NFC 폴백)
- 메신저 푸시 알림 (폴링 → 푸시 전환)
- USDC 실체인 지갑(주소 생성·잔액·수신) — 결정 대기 1번(체인 확정) 후
- 사용자 패턴 학습 이상 탐지 모델 (verification-engineer, 온디바이스)
