/**
 * 기기 키·메시징 키·회원 번호 관리.
 *
 * - 개인키는 SecureStore(iOS Keychain / Android Keystore 암호화 저장)에 보관한다.
 *   TODO(보안 감사): Secure Enclave/StrongBox 하드웨어 비추출 키 + Play Integrity /
 *   App Attest 실토큰 연동은 보안 강화 단계에서. 현재 구조는 Signer 인터페이스
 *   뒤에 숨겨져 있어 교체 시 앱 코드 변경이 없다.
 * - 메시징 키(X25519): E2E 메신저 봉투용. 기기 서명 키(ed25519)와 별도 보관.
 * - 회원 번호: 정식 발급은 디렉토리 서버 가입(전화 OTP + 이메일)에서 — "SHV-123456".
 *   가입 전에는 로컬 임시 번호(M-로 시작)를 쓰며, 임시 번호로도 앱 전체(걷기·지불)가
 *   동작한다. 서버는 편의 기능일 뿐이다 (오프라인 우선).
 */
import * as SecureStore from 'expo-secure-store';
import {
  addressFromPublicKey,
  generateKeyPair,
  generateMessagingKeyPair,
  signerFromKeyPair,
  type KeyPair,
  type MembershipCertificate,
  type MessagingKeyPair,
  type Signer,
} from '@shvil/shared';

const DEVICE_KEY_STORE = 'shvil.deviceKey.v1';
const MEMBER_ID_STORE = 'shvil.memberId.v1';
const MSG_KEY_STORE = 'shvil.msgKey.v1';
/** 회원 증서·무결성 토큰은 민감·기기 결속 데이터 — SecureStore에 보관한다 (db 아님). */
const MEMBERSHIP_STORE = 'shvil.membership.v1';
const INTEGRITY_TOKEN_STORE = 'shvil.integrityToken.v1';

export interface Identity {
  memberId: string;
  address: string;
  signer: Signer;
  /** E2E 메신저 X25519 키쌍 — 디렉토리 프로필에 공개키를 등록한다. */
  messagingKeyPair: MessagingKeyPair;
  /**
   * 회원 증서 (보안 감사 C-2) — 회원 번호↔기기 키 결속. 온라인 가입 시 서버 발급.
   * 미가입·오프라인이면 null (증서 없이도 걷기·정산·지불 전 과정 동작 — 점진 전환).
   */
  membership: MembershipCertificate | null;
  /** 마지막 증서 발급 시 서버에 제출한 무결성 토큰 참조 — 민팅 증명에 첨부. */
  integrityToken: string | null;
}

/** 미가입(로컬 임시 번호) 여부 — 정식 번호는 서버 가입 시 "SHV-123456" 형식으로 발급. */
export function isProvisionalMemberId(memberId: string): boolean {
  return memberId.startsWith('M-');
}

function randomMemberId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const num = Array.from(bytes, (b) => (b % 10).toString()).join('');
  return `M-${num}`; // 임시 — 가입 시 서버 발급 번호로 대체
}

export async function loadOrCreateIdentity(): Promise<Identity> {
  let keyJson = await SecureStore.getItemAsync(DEVICE_KEY_STORE);
  if (!keyJson) {
    const kp = generateKeyPair();
    keyJson = JSON.stringify(kp);
    await SecureStore.setItemAsync(DEVICE_KEY_STORE, keyJson);
  }
  const keyPair = JSON.parse(keyJson) as KeyPair;

  let msgJson = await SecureStore.getItemAsync(MSG_KEY_STORE);
  if (!msgJson) {
    msgJson = JSON.stringify(generateMessagingKeyPair());
    await SecureStore.setItemAsync(MSG_KEY_STORE, msgJson);
  }
  const messagingKeyPair = JSON.parse(msgJson) as MessagingKeyPair;

  let memberId = await SecureStore.getItemAsync(MEMBER_ID_STORE);
  if (!memberId) {
    memberId = randomMemberId();
    await SecureStore.setItemAsync(MEMBER_ID_STORE, memberId);
  }

  const membership = await loadMembershipCertificate();
  const integrityToken = await SecureStore.getItemAsync(INTEGRITY_TOKEN_STORE);

  const signer = signerFromKeyPair(keyPair);
  return {
    memberId,
    address: addressFromPublicKey(signer.publicKeyHex),
    signer,
    messagingKeyPair,
    membership,
    integrityToken,
  };
}

/** 가입 성공 시 서버 발급 회원 번호로 갱신 (SecureStore 영속화). */
export async function persistMemberId(memberId: string): Promise<void> {
  await SecureStore.setItemAsync(MEMBER_ID_STORE, memberId);
}

// ── 회원 증서 (보안 감사 C-2) — 민감·기기 결속이라 SecureStore에 보관 ──

/** 서버가 발급한 회원 증서를 저장한다 (가입·갱신 시). */
export async function saveMembershipCertificate(cert: MembershipCertificate): Promise<void> {
  await SecureStore.setItemAsync(MEMBERSHIP_STORE, JSON.stringify(cert));
}

/** 보관 중인 회원 증서를 로드한다 (없거나 손상 시 null). */
export async function loadMembershipCertificate(): Promise<MembershipCertificate | null> {
  const json = await SecureStore.getItemAsync(MEMBERSHIP_STORE);
  if (!json) return null;
  try {
    return JSON.parse(json) as MembershipCertificate;
  } catch {
    return null;
  }
}

/** 증서 발급 시 제출한 무결성 토큰을 저장한다 (민팅 첨부용 참조). */
export async function saveIntegrityToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(INTEGRITY_TOKEN_STORE, token);
}
