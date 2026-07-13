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
| 투명성 공시 | `GET /transparency/promo` · `GET /transparency/market` |

- 인증: 세션·비밀번호 없음. 가입 시 등록한 기기 키로 요청을 서명
  (`buildAuthHeaders`, 경로는 쿼리스트링 제외).
- 첫 접대 보너스의 코인 증빙 검사는 **프로모션 지급 자격 확인**이지 거래 승인이
  아니다 — 거래는 제출 전에 이미 완결되어 있다.
- 저장소: node:sqlite. 전화번호는 해시만 저장. 사용자 이동 궤적·거래·잔고는
  어떤 테이블에도 없다.

## 실행

```
npm run dev     # tsx watch, http://localhost:8787
npm test        # M2 완료 기준 통합 테스트 (가입→등록→지도→채팅→접대→보너스)
```

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
