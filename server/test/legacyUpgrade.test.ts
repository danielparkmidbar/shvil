/**
 * ★업그레이드해도 옛 화폐가 죽지 않는다 — 배포 순서 지뢰의 제거 (적대검증 F1).
 *
 * ── 무엇이 위험했나 ──────────────────────────────────────────────────
 * 앞선 설계는 "옛 이름(`membership-root-2026`)은 **이미 이력에 남아 있을 것**"이라는
 * 전제 위에 서 있었다. 그 전제는 배포 순서에 걸려 있다 — 이력을 도입한 버전이 운영에서
 * 한 번도 기동하지 않은 채 이번 버전이 올라가면, 이력이 빈 채로 시작하고 **옛 이름을
 * 적는 코드 경로가 저장소 어디에도 없다.** 적대검증이 실측한 결과:
 *   · `/keys`에 `membership-root-2026`이 없다
 *   · 서버 자신이 옛 코인을 `UNKNOWN_MEMBERSHIP_ROOT`로 판정한다
 *   · 캐시가 빈 새 지갑도 마찬가지 → **그 배포의 옛 코인이 전량 죽는다**
 *
 * ── 지금은 왜 안 죽는가 ──────────────────────────────────────────────
 * 검증이 **이름이 아니라 공개키**로 판정하기 때문이다. 옛 증서는 자기를 검증할 공개키를
 * 들고 다니고, 그 공개키는 키 재료가 그대로인 한(회전하지 않았으면) 유도 이름으로
 * `/keys`에 실려 있다. 그래서 옛 이름이 목록에 **한 칸도 없어도** 옛 증서가 통과한다.
 *
 * 이 파일은 그것을 **진짜 서버**로 확인한다: 파일 DB로 배포를 세우고, 이력을 비우고
 * (= 이력 도입 버전이 배포된 적 없는 상태), 봉인된 루트 키를 KEK로 열어 옛 코드와
 * 똑같은 모양의 옛 증서를 만들고, 그 코인을 서버가 지금 게시하는 `/keys`로 검증한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PendingWalkLedger,
  acceptKeyBindings,
  buildMembershipCertificate,
  buildWalkSegmentProof,
  deriveKeyId,
  generateKeyPair,
  mintWalkCoin,
  openSecret,
  signerFromKeyPair,
  verifyCoin,
  type Coin,
  type KeyPair,
  type MembershipCertificate,
  type Signer,
  type WalkSample,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { createDb, kvGet, kvSet } from '../src/db';
import { resolveKek } from '../src/keystore';

const T0 = Date.parse('2026-07-10T06:00:00Z');

interface KeyInfo {
  keyId: string;
  publicKey: string;
  purpose: string;
}

const dir = mkdtempSync(join(tmpdir(), 'shvil-upgrade-'));
const dbPath = join(dir, 'legacy.db');

let rootSigner: Signer;
let device: Signer;
let keys: KeyInfo[];

/** 2026-07-26 이전 코드가 발급하던 모양 — 이름이 하드코딩 문자열이다. */
function oldCert(memberId: string): MembershipCertificate {
  return buildMembershipCertificate(
    {
      memberId,
      devicePublicKey: device.publicKeyHex,
      integrity: 'VERIFIED',
      issuedAt: T0,
      expiresAt: T0 + 30 * 86_400_000,
      issuerKeyId: 'membership-root-2026',
    },
    rootSigner,
  );
}

function walkCoin(memberId: string, membership: MembershipCertificate): Coin {
  const ledger = new PendingWalkLedger({ memberId });
  let t = membership.issuedAt + 3600_000;
  for (let i = 0; i < 50; i++) {
    const sample: WalkSample = {
      durationS: 72,
      distanceM: 100,
      steps: 140,
      tier: 'ON_COURSE',
      timestamp: t,
      courseId: 'shvil-israel',
    };
    ledger.recordSample(sample);
    t += 72_000;
  }
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(t)!, device, { membership }));
}

beforeAll(async () => {
  // 1) 배포를 한 번 세워 키 재료를 만든다 (= 옛 버전이 이미 돌고 있던 배포).
  const first = buildApp({ dbPath, devMode: true });
  await first.ready();
  await first.close();

  // 2) 이력을 비운다 — 이력 도입 버전이 운영에 배포된 적 없는 상태의 재현.
  const db = createDb(dbPath);
  kvSet(db, 'publicKeyArchive', '[]');
  // 3) 봉인된 루트 개인키를 KEK로 열어, 옛 코드와 똑같이 옛 이름으로 서명한다.
  const sealed = kvGet(db, 'membershipRootKey')!;
  rootSigner = signerFromKeyPair(JSON.parse(openSecret(sealed, resolveKek(true))) as KeyPair);
  db.close();
  device = signerFromKeyPair(generateKeyPair());

  // 4) 오늘 코드로 재기동 — 이력은 유도 이름만으로 다시 채워진다.
  const upgraded = buildApp({ dbPath, devMode: true });
  await upgraded.ready();
  const res = await upgraded.inject({ method: 'GET', url: '/keys' });
  keys = (res.json() as { keys: KeyInfo[] }).keys;
  await upgraded.close();
});

afterAll(() => {
  // 윈도우는 sqlite WAL 핸들을 늦게 놓아 준다 — 지우지 못해도 테스트가 실패할 일은 아니다.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 임시 디렉토리는 OS가 정리한다 */
  }
});

describe('업그레이드 후 서버가 게시하는 목록', () => {
  it('옛 이름은 한 칸도 없다 (아무도 그 칸을 새로 적지 않는다)', () => {
    expect(keys.some((k) => k.keyId.endsWith('-2026'))).toBe(false);
    expect(keys).toHaveLength(6);
  });

  it('여섯 개 전부 자기 공개키에서 유도된 이름이다', () => {
    for (const k of keys) expect(k.keyId).toBe(deriveKeyId(k.purpose, k.publicKey));
  });

  it('루트 키 재료는 그대로다 — 회전이 아니라 이름만 바뀐 것이다', () => {
    const root = keys.find((k) => k.purpose === 'MEMBERSHIP_ROOT')!;
    expect(root.publicKey).toBe(rootSigner.publicKeyHex);
    expect(root.keyId).toBe(deriveKeyId('MEMBERSHIP_ROOT', rootSigner.publicKeyHex));
  });
});

describe('★그래도 옛 코인은 한 개도 죽지 않는다', () => {
  it('옛 이름 증서를 단 WALK 코인이 업그레이드된 목록에서 유효하다', () => {
    const trustedRootKeys = Object.fromEntries(
      keys.filter((k) => k.purpose === 'MEMBERSHIP_ROOT').map((k) => [k.keyId, k.publicKey]),
    );
    expect(verifyCoin(walkCoin('SHV-100001', oldCert('SHV-100001')), { trustedRootKeys })).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it('캐시가 빈 새 지갑이 `/keys`를 받아 병합해도 같다 (지갑 관문을 그대로 통과)', () => {
    const merged = acceptKeyBindings(keys);
    const trustedRootKeys = Object.fromEntries(
      merged.filter((k) => k.purpose === 'MEMBERSHIP_ROOT').map((k) => [k.keyId, k.publicKey]),
    );
    expect(verifyCoin(walkCoin('SHV-100002', oldCert('SHV-100002')), { trustedRootKeys }).valid).toBe(true);
  });

  it('남의 루트가 옛 이름을 달아도 통과하지 못한다 (해소가 신뢰를 넓히지 않는다)', () => {
    const stranger = signerFromKeyPair(generateKeyPair());
    const fake = buildMembershipCertificate(
      {
        memberId: 'SHV-100003',
        devicePublicKey: device.publicKeyHex,
        integrity: 'VERIFIED',
        issuedAt: T0,
        expiresAt: T0 + 30 * 86_400_000,
        issuerKeyId: 'membership-root-2026',
      },
      stranger,
    );
    const trustedRootKeys = Object.fromEntries(
      keys.filter((k) => k.purpose === 'MEMBERSHIP_ROOT').map((k) => [k.keyId, k.publicKey]),
    );
    const verdict = verifyCoin(walkCoin('SHV-100003', fake), { trustedRootKeys });
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('UNKNOWN_MEMBERSHIP_ROOT');
  });
});
