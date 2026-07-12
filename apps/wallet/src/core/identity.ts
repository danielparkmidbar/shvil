/**
 * 기기 키·회원 번호 관리.
 *
 * - 개인키는 SecureStore(iOS Keychain / Android Keystore 암호화 저장)에 보관한다.
 *   TODO(보안 감사): Secure Enclave/StrongBox 하드웨어 비추출 키 + Play Integrity /
 *   App Attest 실토큰 연동은 M2~ 보안 강화 단계에서. 현재 구조는 Signer 인터페이스
 *   뒤에 숨겨져 있어 교체 시 앱 코드 변경이 없다.
 * - 회원 번호: 정식 발급은 M2 디렉토리 서버 가입(전화 OTP + 이메일)에서.
 *   M1은 로컬 임시 번호(M-로 시작)를 쓴다.
 */
import * as SecureStore from 'expo-secure-store';
import {
  addressFromPublicKey,
  generateKeyPair,
  signerFromKeyPair,
  type KeyPair,
  type Signer,
} from '@shvil/shared';

const DEVICE_KEY_STORE = 'shvil.deviceKey.v1';
const MEMBER_ID_STORE = 'shvil.memberId.v1';

export interface Identity {
  memberId: string;
  address: string;
  signer: Signer;
}

function randomMemberId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const num = Array.from(bytes, (b) => (b % 10).toString()).join('');
  return `M-${num}`; // 임시 — M2에서 서버 발급 번호로 대체
}

export async function loadOrCreateIdentity(): Promise<Identity> {
  let keyJson = await SecureStore.getItemAsync(DEVICE_KEY_STORE);
  if (!keyJson) {
    const kp = generateKeyPair();
    keyJson = JSON.stringify(kp);
    await SecureStore.setItemAsync(DEVICE_KEY_STORE, keyJson);
  }
  const keyPair = JSON.parse(keyJson) as KeyPair;

  let memberId = await SecureStore.getItemAsync(MEMBER_ID_STORE);
  if (!memberId) {
    memberId = randomMemberId();
    await SecureStore.setItemAsync(MEMBER_ID_STORE, memberId);
  }

  const signer = signerFromKeyPair(keyPair);
  return { memberId, address: addressFromPublicKey(signer.publicKeyHex), signer };
}
