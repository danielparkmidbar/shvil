# @shvil/server — 쉬빌 디렉토리 서버 (M2)

**이 서버에는 거래 승인 기능이 없다.** 지불·수령·코인 검증은 전부 두 기기의
로컬에서 완결된다 (지시서 1장). 통합 테스트가 승인 엔드포인트의 부재를 검증한다.

## 담당 (지시서 1장의 4가지 + 가입)

| 기능 | 엔드포인트 |
|---|---|
| 가입 (전화 OTP + 이메일 — 의무 정보는 이 둘뿐) | `POST /auth/otp` · `POST /auth/register` → 회원 번호 발급 |
| 엔젤 디렉토리 (지도·프로필·서비스) | `GET /angels` · `PUT /angels/me` (공개 on/off = 엔젤의 자율) |
| 메신저 릴레이 (E2E 암호문만 중계·저장) | `POST /messages` · `GET /messages?sinceId=` |
| 코스 데이터 배포 | `GET /courses` |
| 프로모션 발행 (등록 20 + 첫 접대 30 SHV, 수량 한정 서명 키) | `PUT /angels/me` 응답 · `POST /angels/first-hosting` · `GET /keys/promo` |
| 코인 마켓 (M3): 무정가 리스팅 → 가격 제시 → 승인 → 에스크로 | `POST/GET /market/listings` · `POST /market/listings/:id/offers` · `POST /market/offers/:id/approve` · `/market/escrows/:id` (coins/ack) |
| 코스 등록부 (M4): 제안 → 100명 완주 → 공식 승격 | `POST/GET /courses/proposals` · `POST /courses/:id/completions` |
| 클레임 게시판 (M4): 24h 접수·월 2회·5표 승인·자동 산정 발행 | `POST/GET /claims` · `POST /claims/:id/vote` |
| 완주 인증 (M4): 격려 코인 완주 10/구간 3 SHV, 1인 1코스 1회 | `POST/GET /certificates` |
| 탑 100 리더보드 (M4, 본인 동의·위치 없음) + 기준선 배포 | `POST /leaderboard/enroll` · `GET /leaderboard` · `GET /limits/baseline` |
| 소명 대기 목록 배포 (지갑 수령 보류용) | `GET /limits/flagged` |
| 신뢰 발행 키 목록 (프로모·클레임·격려) | `GET /keys` |
| 투명성 공시 | `GET /transparency/promo` · `/market` · `/community` |

- 인증: 세션·비밀번호 없음. 가입 시 등록한 기기 키로 요청을 서명
  (`buildAuthHeaders`, 경로는 쿼리스트링 제외).
- 첫 접대 보너스의 코인 증빙 검사는 **프로모션 지급 자격 확인**이지 거래 승인이
  아니다 — 거래는 제출 전에 이미 완결되어 있다.
- 저장소: node:sqlite. 전화번호는 해시만 저장. 사용자 이동 궤적·거래·잔고는
  어떤 테이블에도 없다.

## 실행

```
npm run dev     # tsx watch, http://localhost:8787 (개발 — SHVIL_DEV_MODE=1 권장)
npm test        # 통합·마켓·커뮤니티·회원증서·봉인키 테스트
```

### 운영 환경변수 (보안 감사)
- `SHVIL_KEK` — **운영 필수.** 발행 개인키 봉인용 키 암호화 키(16자 이상, 권장 hex 64자).
  없으면 기동 실패(fail-closed, H-2). DB에는 봉인문만 저장되고 KEK는 저장하지 않는다.
- `SHVIL_DEV_MODE=1` — dev 라우트(OTP 코드 반환·dev-deposit·소명 수동 등재·무결성 모의)
  활성화. 운영에서는 설정하지 말 것 (C-1).

## 마켓·에스크로 (M3)

- 흐름: 엔젤 무정가 리스팅 → 구매자 가격 제시 → 엔젤 승인 → 에스크로
  (USDC 예치 확인 → 코인 이전 **두 지갑의 서명 체인** → 방출, 수수료 2.5% 제안).
- 서버의 역할은 에스크로 상태 관리뿐 — SHV 이전은 판매자의 지불 서명과
  구매자의 확인 서명으로 완결되며 서버는 승인하지 않는다.
- 체인 어댑터(`src/chain.ts`): 협약 스테이블코인·체인 확정(결정 대기 1번,
  권고 USDC on Base) 전까지 Mock. 확정 후 동일 인터페이스로 테스트넷 어댑터 교체.

## 남은 항목 (M4~)

- 실체인(USDC 테스트넷) 어댑터 — 결정 대기 1번 확정 후
- 클레임 구제·격려 코인 발행 API — M4 (shvilist.org 연동)
- 실 SMS·이메일 발송 연동, 소명 대기 목록 배포, 동기화 통계 수집(익명)
- 에스크로 타임아웃·환불 플로우 (REFUNDED 상태 전이)
