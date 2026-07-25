/**
 * 앱 무결성 토큰 획득 (보안 감사 C-2, 지시서 3장 방어선 1선).
 *
 * 서버는 이 토큰으로 기기 무결성(Play Integrity / App Attest)을 판정하고,
 * 통과하면 회원 증서(MembershipCertificate)를 루트 키로 서명해 발급한다. 토큰은
 * 가입·증서 갱신 시점에만 서버로 제출된다 — 이후 거래·민팅은 계속 오프라인이다
 * (무결성 담보는 발급된 증서에 각인되어 코인 계보를 따라 이동한다).
 *
 * ── 왜 이것이 방어의 뿌리인가 (다니엘 쌤 2026-07-26) ──────────────────────
 * "앱 코드를 바꾸면 앱 무결성이 손상되잖아" — 정확한 지적이다. 이 앱 안의 어떤 검사도
 * (생체 인증·인간 한계·회랑 판정) 변조 앱이 지우면 그만이다. 무결성 토큰만이 앱 **바깥**
 * (Google/Apple)에서 "이 앱·이 기기가 진짜인가"를 증언하므로, 이것이 있어야 변조라는
 * 선택지가 값을 잃는다 — 변조 앱은 VERIFIED를 못 받고 그 코인은 수신 지갑이 거부한다.
 *
 * ── 재생·중계 방어 (서버 챌린지 결속) ─────────────────────────────────────
 * 토큰만 훔쳐 다른 기기에서 쓰지 못하도록, 서버가 1회용 챌린지를 발급하고 기기 공개키를
 * 함께 묶어 nonce를 만든다(integrityNonce.ts — 서버와 같은 식). Google이 토큰 안에 그
 * nonce를 되돌려주므로 서버가 (내 챌린지인가 / 소비 전인가 / 이 기기인가)를 대조한다.
 *
 * ── 0층 불변 (실패는 무해하다) ───────────────────────────────────────────
 * 토큰 획득에 실패해도(GMS 없는 기기, 오프라인, API 오류, Expo Go) 앱은 그대로 동작한다.
 * UNVERIFIED 증서를 받게 될 뿐이며 기본 걷기·코인 생성은 계속된다 — 등급에 따른 제약은
 * 서버·수신 지갑 정책의 몫이지, 이 모듈이 앱을 멈추는 것이 아니다.
 */
import { Platform } from 'react-native';
import { buildIntegrityNonce } from './integrityNonce';

export interface IntegrityToken {
  /** 무결성 API 종류를 서버가 구분하도록 플랫폼을 함께 전달한다. */
  platform: string;
  /** 무결성 증명 토큰 — 서버가 검증 후 증서를 발급한다. */
  token: string;
  /** 서버가 발급한 챌린지 — 서버가 nonce 대조에 쓴다. */
  challenge?: string;
  /**
   * 실토큰을 못 받은 사유 (진단용 — 자연어 아님). 값이 있으면 이 토큰은 실증명이
   * 아니며 서버가 UNVERIFIED로 판정한다. 화면이 사용자에게 상태를 정직하게 알리는
   * 데 쓴다(제3조) — "이 기기는 인증되지 않아 코인이 거부될 수 있습니다".
   */
  reason?: string;
}

/**
 * Play Integrity 네이티브 모듈을 지연 로드한다.
 *
 * Expo Go에는 없고 **개발 빌드/EAS 빌드에서만** 존재한다. 없으면 null을 돌려 호출부가
 * 조용히 폴백하게 한다(0층 불변 — 모듈 부재로 앱이 죽지 않는다).
 */
async function loadPlayIntegrity(): Promise<{
  requestIntegrityToken: (opts: { nonce: string }) => Promise<string>;
} | null> {
  try {
    // 동적 import — 모듈이 없는 환경(Expo Go, iOS)에서 번들·실행 오류를 내지 않는다.
    // ★모듈명을 변수로 감싼다: 아직 설치 전이라 정적 import면 타입 검사가 깨지고,
    //   설치 후에도 iOS 번들에 불필요한 의존을 만들지 않기 위해서다.
    const moduleName = 'react-native-google-play-integrity';
    const mod = (await import(/* @vite-ignore */ moduleName)) as unknown as {
      requestIntegrityToken?: (opts: { nonce: string }) => Promise<string>;
      default?: { requestIntegrityToken?: (opts: { nonce: string }) => Promise<string> };
    };
    const fn = mod.requestIntegrityToken ?? mod.default?.requestIntegrityToken;
    return fn ? { requestIntegrityToken: fn } : null;
  } catch {
    return null;
  }
}

/**
 * 무결성 토큰을 획득한다.
 *
 * @param challenge        서버에서 받은 1회용 챌린지 (POST /auth/integrity-challenge).
 * @param devicePublicKey  이 기기의 공개키 — nonce에 결속된다.
 *
 * Android(운영): Play Integrity로 nonce를 실어 실토큰을 받는다.
 * iOS: App Attest 미연동 (Apple 개발자 계정 필요) — 서버가 UNVERIFIED로 판정한다.
 *      이 한계는 숨기지 않고 화면에 표시한다(제3조 정직화).
 * 실패: 개발 토큰으로 폴백 — 운영 서버는 이를 거부하므로 결과는 UNVERIFIED다.
 */
export async function getIntegrityToken(
  challenge?: string,
  devicePublicKey?: string,
): Promise<IntegrityToken> {
  const platform = Platform.OS;

  if (platform === 'android' && challenge && devicePublicKey) {
    const play = await loadPlayIntegrity();
    if (play) {
      try {
        const nonce = buildIntegrityNonce(challenge, devicePublicKey);
        const token = await play.requestIntegrityToken({ nonce });
        return { platform, token, challenge };
      } catch {
        // 획득 실패(GMS 없음·오프라인·쿼터 초과) — 아래 폴백. 앱은 계속 동작한다.
      }
    }
  }

  // ★실토큰 획득 실패 — 정직하게 사유를 담아 돌려준다 (적대적 검증 지적 시정).
  //   이전 구현은 무조건 'dev-verified'를 반환해, 네이티브 모듈이 아예 없는 상태에서도
  //   "무결성 연동 완료"처럼 보였다. 실제로는 단 한 번도 실토큰이 만들어지지 않았다.
  //   개발 토큰은 __DEV__ 빌드에서만 쓰고, 배포 빌드는 빈 토큰 + 사유를 보낸다 —
  //   서버는 이를 UNVERIFIED로 판정하며, 그것이 사실이다.
  const reason = platform === 'ios' ? 'IOS_NOT_INTEGRATED' : 'MODULE_UNAVAILABLE';
  if (__DEV__) {
    return { platform, token: 'dev-verified', reason, ...(challenge !== undefined ? { challenge } : {}) };
  }
  return { platform, token: '', reason, ...(challenge !== undefined ? { challenge } : {}) };
}
