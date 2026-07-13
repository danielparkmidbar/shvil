/**
 * 코인 데이터 구조와 무승인 이전 (지시서 2.3).
 *
 * - 민팅: WalkSegmentProof 또는 SignedGrant(보너스·클레임·격려)에서 코인 생성.
 * - 이전: 두 기기 간 양측 서명 링크. 서버 개입 0회, 통신 불요, 승인 불요.
 * - 검증: 수령 기기가 계보(민팅 서명 + 이전 체인)를 로컬에서 즉시 검증.
 *   승인이 아니라 위조 검사다.
 */
import { addressFromPublicKey, hashObject, signObject, verifyObject, type Signer } from './crypto';
import { verifyWalkSegmentProof } from './proof';
import type {
  Coin,
  CoinRejectReason,
  CoinVerdict,
  Provenance,
  SignedGrant,
  SplitRecord,
  TransferLink,
  WalkSegmentProof,
} from './types';

// ── 민팅 ──────────────────────────────────────────────────────────

export function mintWalkCoin(proof: WalkSegmentProof): Coin {
  const provenance: Provenance = { kind: 'WALK', proof };
  return {
    id: hashObject({ t: 'coin', provenance }),
    amountDshv: proof.amountDshv,
    memberId: proof.memberId,
    provenance,
    transferChain: [],
  };
}

/** 프로모션·커뮤니티 승인서 작성 (발행 키 소유 주체 — 사이트/프로모션 서버). */
export function buildGrant(
  fields: Omit<SignedGrant, 'v' | 'signature' | 'issuerPublicKey'>,
  issuerSigner: Signer,
): SignedGrant {
  const unsigned = { v: 1 as const, ...fields, issuerPublicKey: issuerSigner.publicKeyHex };
  return { ...unsigned, signature: signObject(unsigned, issuerSigner) };
}

/**
 * 승인서 종류별 발행액 상한 (dSHV) — 수신 클라이언트의 방어선 (보안 감사 H-2).
 * 발행 키가 유출되어도 이 상한을 넘는 grant는 수신 지갑이 거부한다.
 * 값은 확정 파라미터 기준: 엔젤 등록 20 + 첫 접대 30 = 최대 300, 클레임·격려는
 * 1일 상한 40 SHV(=400 dSHV) 이내.
 */
export const GRANT_MAX_DSHV: Record<SignedGrant['kind'], number> = {
  ANGEL_BONUS: 300,
  COMMUNITY_CLAIM: 400,
  COMMUNITY_REWARD: 100,
};

export function verifyGrant(grant: SignedGrant): boolean {
  if (grant.v !== 1) return false;
  if (!Number.isInteger(grant.amountDshv) || grant.amountDshv <= 0) return false;
  // kind별 상한 초과 → 거부 (발행 키 유출 시 무제한 위조 차단).
  if (grant.amountDshv > GRANT_MAX_DSHV[grant.kind]) return false;
  const { signature, ...unsigned } = grant;
  return verifyObject(unsigned, signature, grant.issuerPublicKey);
}

export function mintGrantCoin(grant: SignedGrant): Coin {
  const provenance: Provenance = { kind: 'GRANT', grant };
  return {
    id: hashObject({ t: 'coin', provenance }),
    amountDshv: grant.amountDshv,
    memberId: grant.memberId,
    provenance,
    transferChain: [],
  };
}

// ── 소유권 ────────────────────────────────────────────────────────

/** 민팅(또는 분할) 직후의 최초 소유자 주소. */
export function baseOwnerAddress(coin: Coin): string {
  switch (coin.provenance.kind) {
    case 'WALK':
      return addressFromPublicKey(coin.provenance.proof.devicePublicKey);
    case 'GRANT':
      return addressFromPublicKey(coin.provenance.grant.recipientPublicKey);
    case 'SPLIT':
      return addressFromPublicKey(coin.provenance.record.ownerPublicKey);
  }
}

/** 현재 소유자 주소 (완결된 마지막 이전 기준). */
export function currentOwnerAddress(coin: Coin): string {
  const last = coin.transferChain[coin.transferChain.length - 1];
  return last ? last.to : baseOwnerAddress(coin);
}

// ── 이전 체인 ─────────────────────────────────────────────────────

function chainHashAt(coinId: string, chain: TransferLink[], count: number): string {
  let h = hashObject({ t: 'chain-root', coinId });
  for (let i = 0; i < count; i++) {
    h = hashObject({ prev: h, link: chain[i] });
  }
  return h;
}

function linkPayload(coinId: string, link: Omit<TransferLink, 'fromSignature' | 'toSignature'>) {
  return { t: 'transfer', coinId, ...link };
}

/**
 * 이전 생성 (지불자 측): 지불자 서명이 붙은 미완결 링크를 추가한다.
 * 수령자의 확인 서명(acknowledgeTransfer)으로 완결된다.
 */
export function createTransfer(
  coin: Coin,
  fromSigner: Signer,
  toPublicKey: string,
  timestamp: number,
): Coin {
  const fromAddress = addressFromPublicKey(fromSigner.publicKeyHex);
  if (currentOwnerAddress(coin) !== fromAddress) {
    throw new Error('transfer: sender is not the current owner');
  }
  if (coin.transferChain.some((l) => l.toSignature === null)) {
    throw new Error('transfer: previous transfer is not acknowledged yet');
  }
  const base: Omit<TransferLink, 'fromSignature' | 'toSignature'> = {
    from: fromAddress,
    to: addressFromPublicKey(toPublicKey),
    fromPublicKey: fromSigner.publicKeyHex,
    toPublicKey,
    timestamp,
    prevChainHash: chainHashAt(coin.id, coin.transferChain, coin.transferChain.length),
  };
  const fromSignature = signObject(linkPayload(coin.id, base), fromSigner);
  return { ...coin, transferChain: [...coin.transferChain, { ...base, fromSignature, toSignature: null }] };
}

/** 이전 확인 (수령자 측): 마지막 링크에 수령자 서명을 채워 거래를 완결한다. */
export function acknowledgeTransfer(coin: Coin, toSigner: Signer): Coin {
  const chain = [...coin.transferChain];
  const last = chain[chain.length - 1];
  if (!last || last.toSignature !== null) throw new Error('ack: no pending transfer');
  if (addressFromPublicKey(toSigner.publicKeyHex) !== last.to) {
    throw new Error('ack: signer is not the recipient');
  }
  const { fromSignature, toSignature, ...base } = last;
  chain[chain.length - 1] = { ...last, toSignature: signObject(linkPayload(coin.id, base), toSigner) };
  return { ...coin, transferChain: chain };
}

// ── 분할 ──────────────────────────────────────────────────────────

/**
 * 코인 분할 — 지불 금액을 정확히 맞추기 위한 잔돈 처리.
 * 분할 기록에 자식 금액 전체가 커밋되므로, 수신 지갑은 자식 합계 = 부모 금액을
 * 로컬에서 검증할 수 있다. 계보(생성/구매 구분·회원 번호)는 뿌리를 그대로 상속.
 */
export function splitCoin(coin: Coin, ownerSigner: Signer, amountsDshv: number[], timestamp: number): Coin[] {
  if (currentOwnerAddress(coin) !== addressFromPublicKey(ownerSigner.publicKeyHex)) {
    throw new Error('split: signer is not the current owner');
  }
  if (amountsDshv.length < 2 || amountsDshv.some((a) => !Number.isInteger(a) || a <= 0)) {
    throw new Error('split: amounts must be positive integers (dSHV)');
  }
  if (amountsDshv.reduce((a, b) => a + b, 0) !== coin.amountDshv) {
    throw new Error('split: amounts must sum to the parent amount exactly');
  }
  const unsigned: Omit<SplitRecord, 'signature'> = {
    v: 1,
    parentCoinId: coin.id,
    childAmountsDshv: amountsDshv,
    ownerPublicKey: ownerSigner.publicKeyHex,
    timestamp,
  };
  const record: SplitRecord = { ...unsigned, signature: signObject(unsigned, ownerSigner) };
  return amountsDshv.map((amount, index) => {
    const provenance: Provenance = { kind: 'SPLIT', parent: coin, record, index };
    return {
      id: hashObject({ t: 'coin', provenance }),
      amountDshv: amount,
      memberId: coin.memberId,
      provenance,
      transferChain: [],
    };
  });
}

// ── 검증 (수신 기기의 로컬 위조 검사) ─────────────────────────────

export interface VerifyCoinOptions {
  /** 신뢰하는 발행 키 목록 (keyId → publicKeyHex). GRANT 계보 검증용. */
  trustedIssuerKeys?: Record<string, string>;
  /** 앱 무결성 토큰을 필수로 볼지 (결정 대기 3번 — 권고: 필수). 기본 false(M0). */
  requireIntegrityToken?: boolean;
  /**
   * 마지막 링크의 수령자 서명 부재를 허용 — 수령자가 역스캔 확인 전에
   * 코인을 검증하는 단계(QR 왕복의 중간 상태)에서만 true.
   */
  allowPendingLastLink?: boolean;
}

export function verifyCoin(coin: Coin, options: VerifyCoinOptions = {}): CoinVerdict {
  const reasons: CoinRejectReason[] = [];

  // 1) ID 정합 — 계보 내용이 조금이라도 바뀌면 ID가 어긋난다.
  if (coin.id !== hashObject({ t: 'coin', provenance: coin.provenance })) {
    reasons.push('ID_MISMATCH');
  }

  // 2) 계보 검증
  verifyProvenance(coin, options, reasons);

  // 3) 이전 체인 검증 — 소유 연속성 + 양측 서명 + 체인 해시.
  verifyTransferChain(coin, reasons, options.allowPendingLastLink ?? false);

  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}

function verifyProvenance(coin: Coin, options: VerifyCoinOptions, reasons: CoinRejectReason[]): void {
  const p = coin.provenance;
  switch (p.kind) {
    case 'WALK': {
      if (!verifyWalkSegmentProof(p.proof)) reasons.push('BAD_PROOF_SIGNATURE');
      if (coin.amountDshv !== p.proof.amountDshv) reasons.push('AMOUNT_MISMATCH');
      if (coin.memberId !== p.proof.memberId) reasons.push('MEMBER_MISMATCH');
      if (options.requireIntegrityToken && !p.proof.appIntegrityToken) {
        reasons.push('MISSING_INTEGRITY_TOKEN');
      }
      return;
    }
    case 'GRANT': {
      if (!verifyGrant(p.grant)) reasons.push('BAD_GRANT_SIGNATURE');
      if (coin.amountDshv !== p.grant.amountDshv) reasons.push('AMOUNT_MISMATCH');
      if (coin.memberId !== p.grant.memberId) reasons.push('MEMBER_MISMATCH');
      const trusted = options.trustedIssuerKeys ?? {};
      if (trusted[p.grant.issuerKeyId] !== p.grant.issuerPublicKey) reasons.push('UNTRUSTED_ISSUER');
      return;
    }
    case 'SPLIT': {
      const { parent, record, index } = p;
      const { signature, ...unsigned } = record;
      if (!verifyObject(unsigned, signature, record.ownerPublicKey)) reasons.push('BAD_SPLIT');
      if (record.parentCoinId !== parent.id) reasons.push('BAD_SPLIT');
      if (addressFromPublicKey(record.ownerPublicKey) !== currentOwnerAddress(parent)) reasons.push('BAD_SPLIT');
      if (!Number.isInteger(index) || index < 0 || index >= record.childAmountsDshv.length) {
        reasons.push('BAD_SPLIT');
      } else if (coin.amountDshv !== record.childAmountsDshv[index]) {
        reasons.push('AMOUNT_MISMATCH');
      }
      if (record.childAmountsDshv.reduce((a, b) => a + b, 0) !== parent.amountDshv) reasons.push('BAD_SPLIT');
      if (coin.memberId !== parent.memberId) reasons.push('MEMBER_MISMATCH');
      // 부모 코인 전체(계보 + 이전 체인)를 재귀 검증.
      const parentVerdict = verifyCoin(parent, options);
      if (!parentVerdict.valid) reasons.push(...parentVerdict.reasons);
      return;
    }
  }
}

function verifyTransferChain(coin: Coin, reasons: CoinRejectReason[], allowPendingLastLink: boolean): void {
  let expectedFrom = baseOwnerAddress(coin);
  for (let i = 0; i < coin.transferChain.length; i++) {
    const link = coin.transferChain[i]!;
    const { fromSignature, toSignature, ...base } = link;

    if (link.from !== expectedFrom) reasons.push('BROKEN_TRANSFER_CHAIN');
    if (addressFromPublicKey(link.fromPublicKey) !== link.from) reasons.push('BROKEN_TRANSFER_CHAIN');
    if (addressFromPublicKey(link.toPublicKey) !== link.to) reasons.push('BROKEN_TRANSFER_CHAIN');
    if (link.prevChainHash !== chainHashAt(coin.id, coin.transferChain, i)) {
      reasons.push('BROKEN_TRANSFER_CHAIN');
    }

    const payload = linkPayload(coin.id, base);
    if (!verifyObject(payload, fromSignature, link.fromPublicKey)) reasons.push('BAD_TRANSFER_SIGNATURE');

    const isLast = i === coin.transferChain.length - 1;
    if (toSignature === null) {
      // 미완결 이전은 마지막 링크에서만 허용 (지불 QR 상태). 수령 확정 전이다.
      if (!isLast) reasons.push('BROKEN_TRANSFER_CHAIN');
      else if (!allowPendingLastLink) reasons.push('INCOMPLETE_TRANSFER');
    } else if (!verifyObject(payload, toSignature, link.toPublicKey)) {
      reasons.push('BAD_TRANSFER_SIGNATURE');
    }

    expectedFrom = link.to;
  }
}
