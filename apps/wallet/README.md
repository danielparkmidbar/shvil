# @shvil/wallet — 쉬빌 지갑 앱 (M1: 리스트 모드)

React Native (Expo SDK 57) + TypeScript. 코인 코어는 `@shvil/shared` 공유.

## 구조

```
src/
  walk/            회랑 판정 (좌표는 여기의 휘발성 버퍼에서만 존재)
    geo.ts           하버사인·폴리라인 투영 (반환은 거리뿐)
    courses.ts       코스 데이터 스키마 (회랑 폭·난이도 = 구간 속성)
    corridorEngine.ts 창 단위 판정: 코스 위/이탈/일상/엔젤 우회 → WalkSample 방출 후 좌표 폐기
    data/            내장 코스 (쉬빌 이스라엘 북부 샘플 — 파일럿 확정 시 교체)
  core/
    identity.ts      기기 키(SecureStore)·임시 회원 번호 (정식 발급은 M2 가입)
    db.ts            SQLite 로컬 원장 — 코인·잠정 스냅숏·영수증 (좌표 컬럼 없음)
    walletService.ts 잠정 누적→정산(사용/수동만)→민팅, QR 지불/수령, 이중사용·인간한계 검사
    walkService.ts   GPS+만보기 → 회랑 엔진 → 60초 창 → 원장
  screens/         홈 · 걷기(여기서 정산) · 지갑(생성/구매 구분+계보) · 지불 · 수령
```

## 실행·테스트

```
npm start        # Expo 개발 서버 (Expo Go로 실행)
npm test         # 회랑 판정·위치 비저장·필터 연동 테스트 (vitest)
npm run typecheck
```

실기기 검증 절차: `docs/M1_실기기_테스트_가이드.md`

## M1 이후 남은 항목

- 백그라운드 상시 추적 (expo-task-manager + 개발 빌드) · 배터리 절약 모드
- Play Integrity / App Attest 실토큰 첨부 (결정 대기 3번)
- 니모닉 백업 UI (결정 대기 4번) · 지문/페이스 인증 후 지불
- 대용량 지불의 분할 프레임 QR (또는 BLE/NFC 폴백)
- MapLibre + OSM 오프라인 지도 팩 (엔젤 지도 화면)
- 사용자 패턴 학습 이상 탐지 모델 (verification-engineer, 온디바이스)
