/**
 * 코인 데이터 구조와 무승인 이전 (지시서 2.3).
 *
 * - 민팅: WalkSegmentProof 또는 SignedGrant(보너스·클레임·격려)에서 코인 생성.
 * - 이전: 두 기기 간 양측 서명 링크. 서버 개입 0회, 통신 불요, 승인 불요.
 * - 검증: 수령 기기가 계보(민팅 서명 + 이전 체인)를 로컬에서 즉시 검증.
 *   승인이 아니라 위조 검사다.
 */
import { addressFromPublicKey, hashObject, signObject, verifyObject, type Signer } from './crypto';
import { isTrustedKeyBinding } from './keyId';
import { verifyWalkSegmentProof } from './proof';
import { verifyMembershipForMint } from './membership';
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
 * 1일 상한 40 SHV(=400 dSHV) 이내. 보물(M9)도 프로모션 발행이므로 일 상한과
 * 같은 400 dSHV를 방어 상한으로 둔다.
 */
export const GRANT_MAX_DSHV: Record<SignedGrant['kind'], number> = {
  ANGEL_BONUS: 300,
  COMMUNITY_CLAIM: 400,
  COMMUNITY_REWARD: 100,
  TREASURE: 400,
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

/**
 * **위조가 아닌** 거부 사유 — "이 코인은 가짜다"가 아니라 "이 검사자가 자격을
 * 확인하지 못했다"는 뜻이다 (2026-07-26 · 다니엘 쌤 원칙).
 *
 * 여기에 담긴 사유만 나왔다면 그 코인의 서명·ID·이전 체인은 **전부 온전하다.**
 * 수령은 여전히 fail-closed로 막되(모르는 것을 통과시키지 않는다), 사람에게는
 * "위조"라고 말하면 안 된다. UI 문구·위폐 감지기 판정이 이 집합을 기준으로 갈린다.
 *
 * ★단, "위조가 아님이 증명되었다"는 뜻도 **아니다.** 예컨대
 * `UNKNOWN_MEMBERSHIP_ROOT`는 (1) 검사자의 키 목록이 낡았거나 (2) 공격자가 자기 키로
 * 자작 서명했거나 — 검사자 쪽에서는 이 둘을 구별할 방법이 **없다.** 그래서 문구는
 * 어느 쪽으로도 단정하지 않아야 한다(제3조 정직화).
 */
export const UNPROVEN_COIN_REASONS: ReadonlySet<CoinRejectReason> = new Set<CoinRejectReason>([
  'MEMBERSHIP_OUT_OF_WINDOW',
  'UNKNOWN_MEMBERSHIP_ROOT',
  'UNTRUSTED_ISSUER',
  'MISSING_INTEGRITY_TOKEN',
]);

/** 거부 사유가 전부 "자격 미증명"인가 — 하나라도 위조 사유가 있으면 false. */
export function isUnprovenOnly(reasons: readonly CoinRejectReason[]): boolean {
  return reasons.length > 0 && reasons.every((r) => UNPROVEN_COIN_REASONS.has(r));
}

/**
 * 검사자가 이 키 목록을 **가지고 있는가.**
 *
 * ★`undefined`(안 줬다)와 `{}`(빈 목록)를 반드시 같게 취급해야 한다. 예전에는
 * `if (!roots)`로만 봐서 빈 객체가 truthy로 통과했고, 그 결과 **신뢰 루트 캐시가 빈
 * 지갑이 정상 코인을 하나도 받지 못했다** — 설치 직후 산에서 첫 수령을 하는 엔젤이
 * 정확히 그 상태다(캐시는 온라인 화면에 들어가야 채워진다). 같은 "모른다"인데 답이
 * 정반대인 것은 0층("설치하고 걸으면 끝")을 깨는 버그였다.
 */
function hasKeys(keys: Record<string, string> | undefined): keys is Record<string, string> {
  return keys !== undefined && Object.keys(keys).length > 0;
}

export interface VerifyCoinOptions {
  /** 신뢰하는 발행 키 목록 (keyId → publicKeyHex). GRANT 계보 검증용. */
  trustedIssuerKeys?: Record<string, string>;
  /**
   * 회원 증서 신뢰 루트 (keyId → publicKeyHex). 지정되면 WALK 코인의 회원 증서를
   * 검증한다 (보안 감사 C-2). 앱은 서버 루트 공개키를 여기에 핀한다.
   */
  trustedRootKeys?: Record<string, string>;
  /**
   * 앱 무결성·회원 증서를 필수로 볼지 (결정 대기 3번 — 2026-07-13 필수화 확정).
   * true면 WALK 코인은 유효한 회원 증서(integrity=VERIFIED)를 반드시 품어야 한다.
   */
  requireIntegrityToken?: boolean;
  /**
   * 검사 시각.
   *
   * ★**증서 만료 판정에는 쓰이지 않는다** (2026-07-26 — 다니엘 쌤 원칙).
   * 코인의 유효성은 언제 검사하든 같아야 한다. 그래서 verifyCoin은 이 값을 회원 증서
   * 판정에 일절 쓰지 않는다 — 증서는 `proof.settledAt`(민팅 시각)이 자기 창 안인지로만
   * 검사된다(membership.ts `verifyMembershipForMint`).
   *
   * "만료를 옵션 하나로 켜고 끄는" 설계를 일부러 **만들지 않았다.** 그런 스위치가
   * 존재하면 언젠가 누가 켜고, 그날 세상의 옛 코인이 전부 죽는다. 만료가 필요한 용도는
   * 갱신 판정 하나뿐이고, 그것은 verifyCoin이 아니라
   * `verifyMembershipCertificate(cert, roots, now)`를 직접 부른다.
   *
   * 이 값은 위폐 감지기(authenticity.ts)의 "미래 정산" 같은 검사가 쓴다.
   */
  now?: number;
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
      verifyMembership(p.proof, options, reasons);
      return;
    }
    case 'GRANT': {
      if (!verifyGrant(p.grant)) reasons.push('BAD_GRANT_SIGNATURE');
      if (coin.amountDshv !== p.grant.amountDshv) reasons.push('AMOUNT_MISMATCH');
      if (coin.memberId !== p.grant.memberId) reasons.push('MEMBER_MISMATCH');
      const trusted = options.trustedIssuerKeys ?? {};
      // ★이름이 아니라 공개키로 판정한다 (규격 9.2 I-3 — membership.ts verifySeal과 같다).
      // 옛 이름(`promo-angel-2026` 등)이 박힌 GRANT는 그랜트가 들고 다니는 공개키를
      // 유도해 찾는다. 이름 슬롯 선점으로 남의 옛 코인을 죽일 수 없다.
      if (!isTrustedKeyBinding(trusted, p.grant.issuerKeyId, p.grant.issuerPublicKey)) {
        reasons.push('UNTRUSTED_ISSUER');
      }
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

/**
 * 회원 증서 검증 (보안 감사 C-2) — 회원 번호↔기기 키 결속 + 무결성 담보.
 * - requireIntegrityToken: 증서가 필수이며 integrity=VERIFIED여야 한다.
 * - trustedRootKeys만 주어진 경우: 증서가 있으면 검증하되, 없으면 통과(점진 전환).
 *
 * ★2026-07-26: 판정 기준이 **검사 시각 → 민팅 시각**으로 바뀌었다.
 * 예전에는 `now >= cert.expiresAt`이라 같은 코인이 30일 뒤 저절로 위폐가 되었다.
 * 이제는 `proof.settledAt`이 증서의 창 안인지만 본다:
 *   · 옛 코인 — 만들어질 때 창 안이었으므로 **영원히** 창 안이다. 죽지 않는다.
 *   · 소급 발행 — 유출된 증서(+ 기기 개인키)로 창 밖 시각을 적으면 거부된다.
 * `settledAt`이 공격자 제어 필드인데도 이것이 성립하는 이유: 창의 두 끝이 전부
 * **서버가 서명한 값**(issuedAt·expiresAt)에서만 나오기 때문이다. 공격자는 시각을
 * 고를 수 있어도 **창을 넓힐 수는 없다.**
 *
 * 실패 사유도 셋으로 갈라진다 — "증서가 오래됐다"와 "위조다"는 완전히 다른 말이다:
 *   BAD_MEMBERSHIP(서명 손상=위조) / MEMBERSHIP_OUT_OF_WINDOW(소급 발행) /
 *   UNKNOWN_MEMBERSHIP_ROOT(이 검사자가 루트를 모름).
 */
function verifyMembership(
  proof: WalkSegmentProof,
  options: VerifyCoinOptions,
  reasons: CoinRejectReason[],
): void {
  const cert = proof.membership;
  const required = options.requireIntegrityToken ?? false;

  if (!cert) {
    if (required) reasons.push('MISSING_INTEGRITY_TOKEN');
    return;
  }

  // 증서가 첨부되었으면 신뢰 루트로 검증한다. 루트 미지정 + 비필수면 검사 생략.
  const roots = options.trustedRootKeys;
  if (!hasKeys(roots)) {
    // 루트 목록이 아예 없다 = 검사자가 판정할 재료가 없다. 코인의 흠이 아니다.
    // (빈 객체 `{}`도 여기다 — hasKeys 주석 참조. 0층을 지키는 지점이다.)
    if (required) reasons.push('UNKNOWN_MEMBERSHIP_ROOT');
    return;
  }

  const verdict = verifyMembershipForMint(cert, roots, proof.settledAt);
  if (!verdict.valid) {
    reasons.push(
      verdict.reason === 'UNTRUSTED_ROOT'
        ? 'UNKNOWN_MEMBERSHIP_ROOT'
        : verdict.reason === 'OUT_OF_MINT_WINDOW'
          ? 'MEMBERSHIP_OUT_OF_WINDOW'
          : 'BAD_MEMBERSHIP',
    );
    return;
  }
  // 결속 검사: 증서가 이 회원 번호·기기 키를 증언해야 한다.
  if (cert.memberId !== proof.memberId || cert.devicePublicKey !== proof.devicePublicKey) {
    reasons.push('MEMBERSHIP_MISMATCH');
    return;
  }
  if (required && cert.integrity !== 'VERIFIED') {
    reasons.push('MISSING_INTEGRITY_TOKEN');
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
