import { describe, expect, it } from 'vitest';
import { generateKeyPair, signerFromKeyPair, type Signer } from '../crypto';
import { PendingWalkLedger } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import { buildMembershipCertificate, verifyMembershipCertificate } from '../membership';
import { mintWalkCoin, verifyCoin } from '../coin';
import type { Coin } from '../types';
import { T0, walkKm } from './helpers';

const ROOT_KEY_ID = 'membership-root-2026';
const root = signerFromKeyPair(generateKeyPair());
const roots = { [ROOT_KEY_ID]: root.publicKeyHex };
const device = signerFromKeyPair(generateKeyPair());
const NOW = T0 + 86_400_000;

function cert(overrides: Partial<Parameters<typeof buildMembershipCertificate>[0]> = {}, signer: Signer = root) {
  return buildMembershipCertificate(
    {
      memberId: 'SHV-100001',
      devicePublicKey: device.publicKeyHex,
      integrity: 'VERIFIED',
      issuedAt: T0,
      expiresAt: T0 + 30 * 86_400_000,
      issuerKeyId: ROOT_KEY_ID,
      ...overrides,
    },
    signer,
  );
}

function walkCoin(memberId: string, signer: Signer, membership = cert()): Coin {
  const ledger = new PendingWalkLedger({ memberId });
  const end = walkKm(ledger, 5);
  return mintWalkCoin(
    buildWalkSegmentProof(ledger.settleOnSpend(end)!, signer, { appIntegrityToken: 'play-integrity', membership }),
  );
}

describe('회원 증서 검증 (보안 감사 C-2)', () => {
  it('신뢰 루트가 서명한 증서는 검증을 통과한다', () => {
    expect(verifyMembershipCertificate(cert(), roots, NOW).valid).toBe(true);
  });

  it('신뢰 목록에 없는 루트 → 거부', () => {
    const rogue = signerFromKeyPair(generateKeyPair());
    expect(verifyMembershipCertificate(cert({}, rogue), roots, NOW)).toMatchObject({ valid: false, reason: 'UNTRUSTED_ROOT' });
  });

  it('만료된 증서 → 거부', () => {
    const expired = cert({ expiresAt: T0 + 1000 });
    expect(verifyMembershipCertificate(expired, roots, NOW)).toMatchObject({ valid: false, reason: 'EXPIRED' });
  });

  it('증서 내용 변조 → 서명 불일치', () => {
    const tampered = { ...cert(), memberId: 'SHV-999999' };
    expect(verifyMembershipCertificate(tampered, roots, NOW)).toMatchObject({ valid: false, reason: 'BAD_SIGNATURE' });
  });
});

describe('WALK 코인의 회원 증서 결속 (무한 복제 차단)', () => {
  it('필수 모드: 유효 증서를 품은 코인은 통과', () => {
    const coin = walkCoin('SHV-100001', device);
    const verdict = verifyCoin(coin, { requireIntegrityToken: true, trustedRootKeys: roots, now: NOW });
    expect(verdict.valid).toBe(true);
  });

  it('필수 모드: 증서 없는 코인은 거부 (위조 앱 차단)', () => {
    const ledger = new PendingWalkLedger({ memberId: 'SHV-100001' });
    const end = walkKm(ledger, 5);
    const noCert = mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(end)!, device));
    const verdict = verifyCoin(noCert, { requireIntegrityToken: true, trustedRootKeys: roots, now: NOW });
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('MISSING_INTEGRITY_TOKEN');
  });

  it('임의 회원 번호 위조 차단: 증서의 회원 번호와 코인 회원 번호가 다르면 거부', () => {
    // 공격자가 새 기기 키로 다른 회원 번호를 주장하지만, 증서는 SHV-100001/device에 묶여 있음
    const attacker = signerFromKeyPair(generateKeyPair());
    // 증서는 attacker 기기 키를 증언하지 않는다 → 결속 불일치
    const forgedCert = cert({ devicePublicKey: attacker.publicKeyHex }); // 루트가 서명했다고 가정한 시나리오
    const coin = walkCoin('SHV-100001', device, forgedCert);
    const verdict = verifyCoin(coin, { requireIntegrityToken: true, trustedRootKeys: roots, now: NOW });
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('MEMBERSHIP_MISMATCH');
  });

  it('무결성 미검증(BASIC/UNVERIFIED) 증서는 필수 모드에서 거부', () => {
    const coin = walkCoin('SHV-100001', device, cert({ integrity: 'UNVERIFIED' }));
    const verdict = verifyCoin(coin, { requireIntegrityToken: true, trustedRootKeys: roots, now: NOW });
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('MISSING_INTEGRITY_TOKEN');
  });

  it('증서 바꿔치기 차단: 증명 서명 대상에 증서가 포함되어 다른 증서로 교체하면 서명 깨짐', () => {
    const coin = walkCoin('SHV-100001', device);
    if (coin.provenance.kind !== 'WALK') throw new Error('unexpected');
    const other = cert({ memberId: 'SHV-100001', integrity: 'VERIFIED', issuedAt: T0 + 5 });
    const swapped: Coin = {
      ...coin,
      provenance: { kind: 'WALK', proof: { ...coin.provenance.proof, membership: other } },
    };
    const verdict = verifyCoin(swapped, { requireIntegrityToken: true, trustedRootKeys: roots, now: NOW });
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('BAD_PROOF_SIGNATURE');
  });

  it('점진 전환: 루트 미지정·비필수 모드에서는 기존 코인(증서 유무 무관) 통과 (하위 호환)', () => {
    const legacy = (() => {
      const ledger = new PendingWalkLedger({ memberId: 'SHV-100001' });
      const end = walkKm(ledger, 5);
      return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(end)!, device));
    })();
    expect(verifyCoin(legacy).valid).toBe(true); // M1~M4 기존 동작 유지
  });
});
