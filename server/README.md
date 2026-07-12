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
| 투명성 공시 | `GET /transparency/promo` |

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

## 남은 항목 (M3~)

- 마켓 에스크로 (리스팅→가격 제시→승인→USDC) — M3
- 클레임 구제·격려 코인 발행 API — M4 (shvilist.org 연동)
- 실 SMS·이메일 발송 연동, 소명 대기 목록 배포, 동기화 통계 수집(익명)
