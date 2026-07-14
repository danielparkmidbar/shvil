import { describe, expect, it } from 'vitest';
import { generateKeyPair, signerFromKeyPair } from '../crypto';
import { generateMessagingKeyPair, openMessage, sealMessage, type MessageEnvelope } from '../messaging';
import { buildAuthHeaders, verifyAuthHeaders, AUTH_HEADER_SIG, AUTH_HEADER_TS } from '../apiAuth';
import { T0 } from './helpers';

const aliceDevice = signerFromKeyPair(generateKeyPair());
const aliceMsg = generateMessagingKeyPair();
const bobDevice = signerFromKeyPair(generateKeyPair());
const bobMsg = generateMessagingKeyPair();

function aliceToBob(plaintext: string): MessageEnvelope {
  return sealMessage({
    plaintext,
    fromMemberId: 'm-alice',
    toMemberId: 'm-bob',
    senderMsgKeyPair: aliceMsg,
    recipientMsgPublicKey: bobMsg.publicKeyHex,
    deviceSigner: aliceDevice,
    now: T0,
  });
}

describe('종단간 암호화 메신저 (지시서 0-4 — 서버는 중계만)', () => {
  it('수신자만 복호화할 수 있고 발신자 서명이 검증된다', () => {
    const env = aliceToBob('오늘 저녁 7시쯤 도착 예정입니다 🌵');
    const opened = openMessage(env, bobMsg);
    expect(opened.plaintext).toBe('오늘 저녁 7시쯤 도착 예정입니다 🌵');
    expect(opened.signatureValid).toBe(true);
  });

  it('봉투(서버가 저장하는 전부)에는 평문이 없다', () => {
    const secret = '비밀-메시지-플레인텍스트';
    const env = aliceToBob(secret);
    expect(JSON.stringify(env)).not.toContain(secret);
    expect(JSON.stringify(env)).not.toContain(Buffer.from(secret, 'utf8').toString('hex'));
  });

  it('엉뚱한 키(도청자)는 복호화할 수 없다', () => {
    const env = aliceToBob('비밀');
    const eve = generateMessagingKeyPair();
    expect(() => openMessage(env, eve)).toThrow();
  });

  it('암호문 변조는 복호화 실패로 드러난다 (AEAD)', () => {
    const env = aliceToBob('변조 감지 테스트');
    // 첫 hex 문자를 확실히 다른 값으로 뒤집는다 (끝자리가 우연히 같아 무변조되는 flaky 방지).
    const first = env.ciphertextHex[0] === '0' ? '1' : '0';
    const tampered = { ...env, ciphertextHex: first + env.ciphertextHex.slice(1) };
    expect(() => openMessage(tampered, bobMsg)).toThrow();
  });

  it('발신자 위장(서명 필드 조작)은 서명 검증에서 걸린다', () => {
    const env = aliceToBob('안녕하세요');
    const forged = { ...env, fromMemberId: 'm-mallory' };
    const opened = openMessage(forged, bobMsg);
    expect(opened.signatureValid).toBe(false);
  });
});

describe('서명 요청 인증 (디렉토리 서버 API)', () => {
  it('올바른 서명은 통과, 본문·경로 변조는 거부', () => {
    const body = JSON.stringify({ visible: true });
    const headers = buildAuthHeaders('m-alice', aliceDevice, 'PUT', '/angels/me', body, T0);
    const base = {
      memberId: 'm-alice',
      timestampHeader: headers[AUTH_HEADER_TS]!,
      signatureHeader: headers[AUTH_HEADER_SIG]!,
      method: 'PUT',
      path: '/angels/me',
      bodyText: body,
      devicePublicKey: aliceDevice.publicKeyHex,
      now: T0,
    };
    expect(verifyAuthHeaders(base)).toBe(true);
    expect(verifyAuthHeaders({ ...base, bodyText: JSON.stringify({ visible: false }) })).toBe(false);
    expect(verifyAuthHeaders({ ...base, path: '/angels/other' })).toBe(false);
    expect(verifyAuthHeaders({ ...base, devicePublicKey: bobDevice.publicKeyHex })).toBe(false);
  });

  it('시계 오차 허용 범위(±10분)를 넘으면 거부 (재전송 방지)', () => {
    const headers = buildAuthHeaders('m-alice', aliceDevice, 'GET', '/messages', '', T0);
    const base = {
      memberId: 'm-alice',
      timestampHeader: headers[AUTH_HEADER_TS]!,
      signatureHeader: headers[AUTH_HEADER_SIG]!,
      method: 'GET',
      path: '/messages',
      bodyText: '',
      devicePublicKey: aliceDevice.publicKeyHex,
      now: T0 + 11 * 60 * 1000,
    };
    expect(verifyAuthHeaders(base)).toBe(false);
    expect(verifyAuthHeaders({ ...base, now: T0 + 5 * 60 * 1000 })).toBe(true);
  });
});
