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
  deriveIdentityFromMnemonic,
  generateKeyPair,
  generateMessagingKeyPair,
  generateMnemonic,
  signerFromKeyPair,
  type KeyPair,
  type MembershipCertificate,
  type MessagingKeyPair,
  type Signer,
} from '@shvil/shared';

const DEVICE_KEY_STORE = 'shvil.deviceKey.v1';
const MEMBER_ID_STORE = 'shvil.memberId.v1';
const MSG_KEY_STORE = 'shvil.msgKey.v1';
/**
 * 니모닉(복구 문구) — 진실의 원천 (지시서 2.1, 보안 감사 L-2). 기기·메시징·백업 키가
 * 여기서 유도된다. SecureStore에 보관하되, 사용자에게 오프라인 백업(적어두기)을
 * 강력 권고한다(강제 아님 — 결정 대기 4번).
 */
const MNEMONIC_STORE = 'shvil.mnemonic.v1';
/** 니모닉 백업(적어두기) 안내를 사용자가 확인했는지 (강력 권고 UI 게이트). */
const MNEMONIC_ACK_STORE = 'shvil.mnemonicAck.v1';
/** 회원 증서·무결성 토큰은 민감·기기 결속 데이터 — SecureStore에 보관한다 (db 아님). */
const MEMBERSHIP_STORE = 'shvil.membership.v1';
const INTEGRITY_TOKEN_STORE = 'shvil.integrityToken.v1';

export interface Identity {
  memberId: string;
  address: string;
  signer: Signer;
  /** E2E 메신저 X25519 키쌍 — 디렉토리 프로필에 공개키를 등록한다. */
  messagingKeyPair: MessagingKeyPair;
  /** 지갑 백업 암복호 키 (hex) — 니모닉에서 유도. null이면 레거시(니모닉 없는) 키. */
  backupKeyHex: string | null;
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
  const legacyKeyJson = await SecureStore.getItemAsync(DEVICE_KEY_STORE);
  let keyPair: KeyPair;
  let messagingKeyPair: MessagingKeyPair;
  let backupKeyHex: string | null;

  if (legacyKeyJson) {
    // 레거시 지갑 (니모닉 이전) — 저장된 랜덤 키 유지. 백업 불가(니모닉 없음)로 표시.
    keyPair = JSON.parse(legacyKeyJson) as KeyPair;
    const msgJson = await SecureStore.getItemAsync(MSG_KEY_STORE);
    messagingKeyPair = msgJson ? (JSON.parse(msgJson) as MessagingKeyPair) : generateMessagingKeyPair();
    backupKeyHex = null;
  } else {
    // 신규 지갑 — 니모닉이 진실의 원천. 키는 저장 대신 니모닉에서 유도한다.
    let mnemonic = await SecureStore.getItemAsync(MNEMONIC_STORE);
    if (!mnemonic) {
      mnemonic = generateMnemonic();
      await SecureStore.setItemAsync(MNEMONIC_STORE, mnemonic);
    }
    const derived = deriveIdentityFromMnemonic(mnemonic);
    keyPair = derived.deviceKeyPair;
    messagingKeyPair = derived.messagingKeyPair;
    backupKeyHex = derived.backupKeyHex;
  }

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
    backupKeyHex,
    membership,
    integrityToken,
  };
}

// ── 니모닉 백업·복구 (지시서 2.1, 보안 감사 L-2) ─────────────────

/** 복구 문구를 조회한다 (레거시 지갑이면 null). "적어두기" 화면용. */
export async function getMnemonic(): Promise<string | null> {
  return SecureStore.getItemAsync(MNEMONIC_STORE);
}

/** 사용자가 복구 문구 백업을 확인했는지. */
export async function isMnemonicAcknowledged(): Promise<boolean> {
  return (await SecureStore.getItemAsync(MNEMONIC_ACK_STORE)) === 'true';
}

export async function acknowledgeMnemonic(): Promise<void> {
  await SecureStore.setItemAsync(MNEMONIC_ACK_STORE, 'true');
}

/**
 * 복구 문구로 지갑을 되살린다 (새 폰). 니모닉을 저장하면 다음 init에서 그 키가
 * 유도된다. 회원 번호는 백업 blob에서 복원되므로 여기서는 문구만 저장한다.
 * 반환: 유도된 기기 주소(백업 조회에 필요).
 */
export async function restoreFromMnemonic(mnemonic: string): Promise<{ backupKeyHex: string; devicePublicKey: string }> {
  const derived = deriveIdentityFromMnemonic(mnemonic); // 유효성 검증 포함(throw)
  await SecureStore.setItemAsync(MNEMONIC_STORE, mnemonic.trim());
  await SecureStore.deleteItemAsync(DEVICE_KEY_STORE); // 레거시 랜덤 키 제거 → 니모닉 파생 사용
  await SecureStore.setItemAsync(MNEMONIC_ACK_STORE, 'true'); // 복구 사용자는 이미 문구 보유
  return { backupKeyHex: derived.backupKeyHex, devicePublicKey: derived.deviceKeyPair.publicKeyHex };
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
