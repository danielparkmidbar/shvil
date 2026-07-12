# @shvil/shared — 쉬빌 코인 코어

M0 산출물. 앱(지갑)과 서버(디렉토리·마켓)가 동일 코드를 공유한다.
**서버에는 거래 승인 기능이 없다** — 이 패키지의 모든 검증은 수신 기기의 로컬 위조 검사다.

## 모듈 구성

| 모듈 | 내용 |
|---|---|
| `params.ts` | 확정 파라미터(1km=1SHV, 0.1 내림, 40 상한, 가격표, 보너스)와 결정 대기 파라미터(이탈 1/10, 일상 1/1,000, 난이도 ×4.0, 우회 5km — 제안 기본값) |
| `rates.ts` | 3단계 요율 + 난이도 계수 계산. 정수 microDshv 연산(부동소수점 금지) |
| `walkFilter.ts` | 걷기 판별 필터: 뛰기·차량 속도 제외, 걸음-거리 정합(흔들기 무력화), 케이던스 대역 |
| `ledger.ts` | `PendingWalkLedger` — 잠정 누적과 정산. 정산은 `settleOnSpend`(사용)·`settleManual`(본인 선언)뿐, 자동 정산 API 부재. 엔젤 우회 잠정→사용 시 확정. 일일 상한은 정산을 나눠도 유지 |
| `proof.ts` | `WalkSegmentProof` 생성·검증 — 구간 요약 + 기기 키 서명. 좌표·경로 필드 없음 |
| `coin.ts` | 코인 민팅(걷기/승인서)·이전(양측 서명 체인)·분할(잔돈)·로컬 검증(`verifyCoin`) |
| `humanLimits.ts` | 인간 한계 프로파일 검증 — 같은 회원 일 40 SHV/주 300 SHV 초과 거부 |
| `qr.ts` | QR 왕복 지불: 청구→지불→역스캔 확인→영수증. 서버 개입 0회, 오프라인 완결 |
| `crypto.ts` | ed25519/sha256 (순수 JS). 앱은 `Signer` 인터페이스를 보안 영역 키로 대체 구현 |

## M0 완료 기준 ↔ 테스트 매핑 (지시서 7장)

| 완료 기준 | 테스트 |
|---|---|
| 3단계 요율 (코스/이탈/일상) | `rates.test.ts`, `ledger.test.ts` "3단계 요율 통합" |
| 난이도 계수 적용 | `rates.test.ts` "난이도 계수", `ledger.test.ts` (×2.5 에베레스트 예) |
| 내림·40 상한 | `rates.test.ts`, `ledger.test.ts` "일일 상한 40 SHV" |
| 걷기 필터 (뛰기·차량 제외) | `walkFilter.test.ts` |
| 사용 시 정산·수동 정산·자동 정산 부재 | `ledger.test.ts` "잠정 누적과 정산" |
| 계보 검증 | `coin.test.ts`, `humanLimits.test.ts` |
| 위조 코인 거부 | `coin.test.ts` (변조·서명 위조·체인 조작), `qr.test.ts` (위조 코인 지불 거부) |

실행: `npm test` (68 tests), `npm run typecheck`.

## M1 연동 지점 (지갑 앱)

- `Signer`를 Secure Enclave / StrongBox 서명으로 구현.
- 회랑 판정 엔진(verification-engineer)이 좌표를 휘발성 버퍼에서 판정 후 `WalkSample`(거리·걸음·tier만)로 공급 — 좌표는 코어에 진입하지 않는다.
- `appIntegrityToken`에 Play Integrity / App Attest 실토큰 연결 (`requireIntegrityToken: true`로 검증).
- QR 용량 초과 시 앱 계층에서 분할 프레임(animated QR) 또는 BLE/NFC 폴백.
- 수신 지갑은 `verifyCoin` + `checkHumanLimits` + 코인 ID 중복(이중지불) 검사를 SQLite 원장과 함께 수행.
