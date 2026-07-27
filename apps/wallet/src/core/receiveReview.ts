/**
 * 수령 검토 (헌법 제9조) — **스캔과 수령을 갈라놓는 곳.**
 *
 * ── 무엇이 잘못돼 있었나 ──────────────────────────────────────────────
 * `acceptPayment`(qr.ts)는 검사를 통과하는 즉시 `acknowledgeTransfer` + 확인 서명까지
 * 한 번에 만들었다. 즉 **스캔 = 수령 확정**이었다. 엔젤이 금액·생산자·계보를 보고
 * "이건 안 받겠다"를 고를 지점이 어디에도 없었다. 헌법 제9조는 "수용 여부는 언제나
 * 엔젤의 결정"이라고 못박고 있으므로, 이것은 기능 미비가 아니라 헌법 위반이었다.
 *
 * 그리고 반대 방향의 문제도 있었다: 자격을 확인하지 못한 코인(오프라인이라 키 목록이
 * 빈 엔젤이 만난 정직한 종주자의 코인), 소명 대기 회원의 코인, 인간 한계 정황 —
 * 이 셋은 전부 **앱이 대신 거절**했다. 거절도 엔젤의 결정이어야 한다.
 *
 * ── 이 모듈이 하는 일 ────────────────────────────────────────────────
 * 지불 QR을 받아 **아무것도 서명하지 않고** 검사만 해서 리포트를 만든다. 서명은
 * walletService의 확정 단계에서만 일어난다. 이 모듈은 순수 함수다 — DB도 네트워크도
 * expo 모듈도 쓰지 않는다(vitest 대상).
 *
 * ── 세 등급 ──────────────────────────────────────────────────────────
 *  BLOCK — 수령이 **산술적으로 불가능**하다. 서명 손상·금액 불일치·내 앞으로 오지 않은
 *          코인·이미 가진 코인·물리적으로 불가능한 걷기. 이건 취향이 아니라 계산이며,
 *          받아 봐야 아무 가치가 없는 것을 받는 일이다. 엔젤에게 물어보지 않는다.
 *  STOP  — **엔젤이 결정할 사안.** 자격 미증명·소명 대기·인간 한계 정황·내 규칙 팩이
 *          지목한 것. 기본은 멈춤이고, 엔젤이 보고 받든 안 받든 정한다.
 *  NOTE  — 알아 두면 좋은 정황. 멈추지는 않는다.
 *
 * ── 코어와 팩을 섞지 않는다 ──────────────────────────────────────────
 * `coreVerdict`는 팩 없이 계산한 값이다 — 세상 누구의 기기에서든 같은 답이 나온다.
 * `extendedVerdict`는 내가 얹은 팩까지 반영한 **내 기준**이다. 화면은 이 둘을 반드시
 * 갈라서 보여 준다(rulePack.ts 설계 주석 참조).
 */
import {
  UNPROVEN_COIN_REASONS,
  acknowledgeTransfer,
  addressFromPublicKey,
  checkAuthenticity,
  checkHumanLimits,
  coinSerial,
  currentOwnerAddress,
  signObject,
  verifyCharge,
  verifyCoin,
  type AppliedRulePack,
  type AuthenticityVerdict,
  type ChargeMessage,
  type Coin,
  type CoinRejectReason,
  type ConfirmMessage,
  type PaymentMessage,
  type Signer,
  type WalkSegmentProof,
} from '@shvil/shared';
import { findFlaggedProducer } from './flagged';

export type ReceiveSeverity = 'BLOCK' | 'STOP' | 'NOTE';

/** 발견의 출처 — 화면이 "누구에게나 같은 답"과 "내 기준"을 갈라 보여 주는 근거. */
export type ReceiveFindingOrigin = 'CORE' | 'PACK' | 'LOCAL';

export interface ReceiveFinding {
  severity: ReceiveSeverity;
  origin: ReceiveFindingOrigin;
  /** 한 줄 제목 (한국어). */
  title: string;
  /** 사람이 읽는 설명. 그대로 화면에 띄워도 된다. */
  detail: string;
  /** 팩 발견일 때만. */
  packId?: string;
  ruleId?: string;
}

/** 코인 한 장의 사람이 읽는 요약 — 좌표는 없다(제9조·제10조). */
export interface ReceiveCoinSummary {
  serial: string;
  amountDshv: number;
  /** 생성 회원 번호 — 계보에 각인되어 분할·이전 후에도 불변. */
  producerMemberId: string;
  /** 뿌리 계보. */
  kind: 'WALK' | 'GRANT';
  /** 분할된 코인인가. */
  split: boolean;
  /** 손바꿈 횟수 (이 지불 링크 포함 전 기준). */
  handovers: number;
  /** 걷기 코인이면 거리 (m). */
  distanceM: number | null;
  /** 걷기 코인이면 정산 시각. */
  settledAt: number | null;
}

export interface ReceiveReview {
  chargeId: string;
  /** ★검토한 바로 그 지불인지 확정 단계에서 대조하는 값 (바꿔치기 방어). */
  paymentSignature: string;
  amountDshv: number;
  payerMemberId: string;
  coins: ReceiveCoinSummary[];
  /** ★팩 없이 낸 판정 — 남과 비교할 때 쓰는 공통 답. */
  coreVerdict: AuthenticityVerdict;
  /** ★내 팩까지 반영한 판정 — 내 기준. 코어보다 관대해질 수 없다. */
  extendedVerdict: AuthenticityVerdict;
  /** 코어 판정의 한 문단 요약 (팩 문장 섞이지 않음). */
  coreSummary: string;
  /** 검사기가 스스로 밝힌 "보지 못한 범위" (제3조). */
  notes: string[];
  appliedPacks: AppliedRulePack[];
  packErrors: string[];
  findings: ReceiveFinding[];
  /** 수령이 구조적으로 불가능한가. true면 화면에 "받는다" 버튼이 없다. */
  blocked: boolean;
  /**
   * ★아무 발견이 없어 그대로 통과시켜도 되는가 (제8조 — 평범한 경우에 단계를 늘리지 않는다).
   * 이 값이 true일 때만 빠른 길이 열린다.
   */
  clean: boolean;
}

export interface ReceiveReviewInput {
  charge: ChargeMessage;
  payment: PaymentMessage;
  /** 내 주소 — 코인이 정말 내 앞으로 왔는지 본다. */
  angelAddress: string;
  /** 지갑이 이미 아는 코인 ID (이중 수령 차단). */
  knownCoinIds: ReadonlySet<string>;
  /** 소명 대기 회원 번호 목록 (배포된 캐시). */
  flaggedMemberIds: readonly string[];
  /** 내가 이미 가진 코인 — 인간 한계 합산 대조용. */
  knownCoins: readonly Coin[];
  trustedRootKeys: Record<string, string>;
  trustedIssuerKeys: Record<string, string>;
  requireIntegrityToken: boolean;
  /** 사용자가 얹은 규칙 팩 (검증 전 원본도 안전 — 해석기가 다시 검증한다). */
  rulePacks: readonly unknown[];
  now: number;
}

function rootOf(coin: Coin): Coin {
  let root = coin;
  while (root.provenance.kind === 'SPLIT') root = root.provenance.parent;
  return root;
}

function walkProofOf(coin: Coin): WalkSegmentProof | null {
  const root = rootOf(coin);
  return root.provenance.kind === 'WALK' ? root.provenance.proof : null;
}

export function summarizeCoin(coin: Coin): ReceiveCoinSummary {
  const root = rootOf(coin);
  const proof = walkProofOf(coin);
  return {
    serial: coinSerial(coin),
    amountDshv: coin.amountDshv,
    producerMemberId: coin.memberId,
    kind: root.provenance.kind === 'WALK' ? 'WALK' : 'GRANT',
    split: root !== coin,
    // 마지막 링크는 지금 나에게 오는 지불이다 — 이전 손바꿈은 그것을 뺀 수.
    handovers: Math.max(0, coin.transferChain.length - 1),
    distanceM: proof ? proof.distanceM : null,
    settledAt: proof ? proof.settledAt : null,
  };
}

/** 자격 미증명 사유의 한국어 한 줄 — 위조라고도, 위조가 아니라고도 단정하지 않는다. */
function unprovenTitle(reason: CoinRejectReason): string {
  switch (reason) {
    case 'MEMBERSHIP_OUT_OF_WINDOW':
      return '회원 증서가 이 정산 시각을 덮지 못합니다';
    case 'UNKNOWN_MEMBERSHIP_ROOT':
      return '증서를 서명한 루트 키를 내 지갑이 모릅니다';
    case 'UNTRUSTED_ISSUER':
      return '보너스·보물 승인서의 발행 키를 내 지갑이 모릅니다';
    case 'MISSING_INTEGRITY_TOKEN':
      return '무결성 증서가 없습니다';
    default:
      return `발행 자격을 확인하지 못했습니다 (${reason})`;
  }
}

function unprovenDetail(reason: CoinRejectReason): string {
  switch (reason) {
    case 'MEMBERSHIP_OUT_OF_WINDOW':
      return (
        '증서 자체는 신뢰하는 루트가 서명한 진짜이고 서명·계보도 온전합니다. ' +
        '정산을 아주 오래 미뤘거나, 증서 발급 뒤 오래 지나 정산한 경우입니다 — 위조라는 뜻이 아닙니다.'
      );
    case 'UNKNOWN_MEMBERSHIP_ROOT':
    case 'UNTRUSTED_ISSUER':
      return (
        '서명과 계보는 온전합니다. 다만 (1) 내 키 목록이 낡았거나 (2) 자기 키로 만든 가짜이거나 — ' +
        '이 둘을 지금 여기서는 구별할 수 없습니다. 온라인에 한 번 연결해 키 목록을 갱신하면 갈립니다.'
      );
    case 'MISSING_INTEGRITY_TOKEN':
      return '증서 제도 이전에 만들어진 옛 코인이면 정상이고, 증서를 뗀 코인도 같은 모습입니다. 코인만 보고는 구별할 수 없습니다.';
    default:
      return '이 검사기로는 발행 자격을 확인하지 못했습니다.';
  }
}

/**
 * 지불 QR 하나를 검토한다 — **아무것도 서명하지 않는다.**
 * 반환된 리포트를 사람이 보고 결정한 뒤에야 walletService가 확정 서명을 만든다.
 */
export function buildReceiveReview(input: ReceiveReviewInput): ReceiveReview {
  const { charge, payment, now } = input;
  const findings: ReceiveFinding[] = [];
  const block = (title: string, detail: string, origin: ReceiveFindingOrigin = 'CORE') =>
    findings.push({ severity: 'BLOCK', origin, title, detail });
  const stop = (title: string, detail: string, origin: ReceiveFindingOrigin = 'CORE') =>
    findings.push({ severity: 'STOP', origin, title, detail });

  const coins = payment.coins;
  const total = coins.reduce((sum, c) => sum + c.amountDshv, 0);

  // ── ① 산술 — 여기서 걸리면 받을 것이 아예 없다 ───────────────────
  if (!verifyCharge(charge)) {
    block('청구 서명이 유효하지 않습니다', '내가 만든 청구가 아니거나 내용이 바뀌었습니다.');
  }
  if (payment.chargeId !== charge.chargeId) {
    block('다른 청구에 대한 지불입니다', `청구 ${charge.chargeId} / 지불 ${payment.chargeId}`);
  }
  if (total !== charge.amountDshv) {
    block(
      '금액이 청구와 다릅니다',
      `청구 ${(charge.amountDshv / 10).toFixed(1)} SHV / 지불 ${(total / 10).toFixed(1)} SHV`,
    );
  }

  for (const coin of coins) {
    const serial = coinSerial(coin);
    if (input.knownCoinIds.has(coin.id)) {
      block(`이미 가진 코인입니다 (${serial})`, '같은 코인을 두 번 받을 수는 없습니다 — 이중 사용 정황입니다.');
      continue;
    }
    if (currentOwnerAddress(coin) !== input.angelAddress) {
      block(`내 앞으로 온 코인이 아닙니다 (${serial})`, '이 코인의 마지막 이전은 다른 사람을 가리킵니다.');
    }
    const verdict = verifyCoin(coin, {
      trustedRootKeys: input.trustedRootKeys,
      trustedIssuerKeys: input.trustedIssuerKeys,
      requireIntegrityToken: input.requireIntegrityToken,
      allowPendingLastLink: true,
      now,
    });
    if (verdict.valid) continue;
    const forgery = verdict.reasons.filter((r) => !UNPROVEN_COIN_REASONS.has(r));
    const unproven = verdict.reasons.filter((r) => UNPROVEN_COIN_REASONS.has(r));
    if (forgery.length > 0) {
      block(`서명 또는 계보가 손상되었습니다 (${serial})`, `사유: ${forgery.join(', ')}`);
    }
    // ★자격 미증명은 **막지 않는다.** 오프라인이라 키 목록이 빈 엔젤이 정직한
    //   종주자의 코인을 만나는 경우가 정확히 여기다 — 받을지 말지는 엔젤이 정한다.
    for (const reason of unproven) {
      stop(`${unprovenTitle(reason)} (${serial})`, unprovenDetail(reason));
    }
  }

  // ── ② 커뮤니티·인간 한계 — 정보이지 승인이 아니다 (제9조) ────────
  const flaggedProducer = findFlaggedProducer(coins, input.flaggedMemberIds);
  if (flaggedProducer) {
    stop(
      `생성 회원 ${flaggedProducer}가 소명 대기 중입니다`,
      '커뮤니티가 이상 생성으로 포착해 소명을 요청한 회원 번호입니다. 소명 전이라는 뜻이지 위조로 확정된 것은 아닙니다 — 받을지는 엔젤이 정합니다.',
    );
  }
  const knownCoins = [...input.knownCoins];
  for (const coin of coins) {
    const limits = checkHumanLimits(coin, knownCoins);
    if (limits.ok) continue;
    const v = limits.violations[0]!;
    stop(
      `인간 한계를 넘는 하루가 있습니다 (${coinSerial(coin)})`,
      `${v.date} 합계 ${(v.totalDshv / 10).toFixed(1)} SHV (${v.kind}). 앱을 다시 깔아 원장이 초기화된 경우에도 이렇게 보일 수 있습니다.`,
    );
  }

  // ── ③ 위폐 감지기 — 코어와 팩을 갈라서 받는다 ────────────────────
  const report = checkAuthenticity([...coins], {
    trustedRootKeys: input.trustedRootKeys,
    trustedIssuerKeys: input.trustedIssuerKeys,
    requireIntegrityToken: input.requireIntegrityToken,
    allowPendingLastLink: true,
    rulePacks: input.rulePacks,
    now,
  });

  // 코어 발견 중 물리적으로 불가능한 것(FATAL)만 막는다. 계보 실패는 위 ①에서 이미
  // 같은 말을 했으므로 중복을 피해 LINEAGE는 건너뛴다.
  for (const f of report.coreFindings) {
    if (f.check === 'LINEAGE') continue;
    if (f.severity === 'FATAL') {
      block('물리적으로 불가능한 걷기가 들어 있습니다', f.detail);
    } else if (f.severity === 'UNPROVEN') {
      // 증서 관련 UNPROVEN은 ①에서 이미 코인별로 말했다 — 여기서는 세지 않는다.
      continue;
    } else {
      findings.push({ severity: 'NOTE', origin: 'CORE', title: '사람의 걷기로 보기 어려운 정황', detail: f.detail });
    }
  }
  // 팩 발견 — **내 기준**이다. FATAL도 "나는 이런 코인은 받지 않겠다"일 뿐 위조 판정이 아니다.
  for (const f of report.packFindings) {
    findings.push({
      severity: f.severity === 'FATAL' ? 'STOP' : 'NOTE',
      origin: 'PACK',
      title: f.severity === 'FATAL' ? '내 규칙 팩이 받지 않기로 한 코인입니다' : '내 규칙 팩이 물어볼 만하다고 봅니다',
      detail: f.detail,
      ...(typeof f.source === 'string' ? { packId: f.source } : {}),
      ...(f.ruleId ? { ruleId: f.ruleId } : {}),
    });
  }
  if (report.packErrors.length > 0) {
    findings.push({
      severity: 'NOTE',
      origin: 'LOCAL',
      title: `규칙 팩 ${report.packErrors.length}개를 읽지 못했습니다`,
      detail: `${report.packErrors.join(' / ')} — 모르는 규칙은 통과시키지 않습니다(코어 검사는 그대로 돌았습니다).`,
    });
  }

  // ── ④ ★검사하지 **못한** 것을 깨끗하다고 말하지 않는다 (제3조) ──────
  //
  // `verifyCoin`은 신뢰 키 목록이 비어 있으면 회원 증서 검증을 **통째로 건너뛴다**
  // (coin.ts hasKeys — 점진 전환 정책: 목록이 없는 지갑이 정상 코인을 전부 거부하면
  // 0층이 깨지므로 그렇게 정했다). 그 자체는 옳다. 문제는 그 다음이었다:
  // 건너뛴 결과가 `AUTHENTIC · 발견 0건 · clean`이 되어, **빠른 길이 화면조차 띄우지
  // 않고 자동 수령**했다. 적대검증에서 자작 루트로 만든 자작 증서가 정확히 이 길로
  // 통과했다. 검사를 안 한 것과 검사해서 깨끗한 것은 같은 말이 아니다.
  //
  // 그래서 막지도 않고 거절하지도 않되, **조용히 통과시키지도 않는다** — 화면을 띄우고
  // 엔젤이 보고 정한다(제9조). 온라인에 한 번만 연결하면 이 줄은 사라진다.
  //
  // ★검사할 것이 **있는데** 못 한 경우에만 말한다. 증서가 아예 없는 코인(미가입 지갑이
  //   만든 것)은 여기 해당하지 않는다 — 그건 "못 봤다"가 아니라 "볼 것이 없었다"이고,
  //   파일럿에서 가장 흔한 정상 상태다. 없는 경고를 띄우면 경고가 무시된다.
  const noRootKeys = Object.keys(input.trustedRootKeys).length === 0;
  const noIssuerKeys = Object.keys(input.trustedIssuerKeys).length === 0;
  const certifiedWalk = coins.some((c) => {
    const proof = walkProofOf(c);
    return proof !== null && (proof.membership ?? null) !== null;
  });
  const grantCoins = coins.filter((c) => rootOf(c).provenance.kind === 'GRANT');
  if ((noRootKeys && certifiedWalk) || (noIssuerKeys && grantCoins.length > 0)) {
    findings.push({
      severity: 'NOTE',
      origin: 'LOCAL',
      title: '내 지갑에 신뢰 키 목록이 없어 발행 자격을 검사하지 못했습니다',
      detail:
        '서명과 계보는 검사했고 온전합니다. 다만 이 코인을 만든 사람의 회원 증서가 진짜 루트에서 나온 것인지는 ' +
        '대조할 목록이 없어 **확인하지 않았습니다** — 위조라는 뜻도, 진짜라는 뜻도 아닙니다. ' +
        '온라인에 한 번 연결하면 목록이 채워지고 이 안내는 사라집니다.',
    });
  }

  const blocked = findings.some((f) => f.severity === 'BLOCK');
  const clean = findings.length === 0 && report.coreVerdict === 'AUTHENTIC' && report.extendedVerdict === 'AUTHENTIC';

  return {
    chargeId: charge.chargeId,
    paymentSignature: payment.signature,
    amountDshv: total,
    payerMemberId: payment.payerMemberId,
    coins: coins.map(summarizeCoin),
    coreVerdict: report.coreVerdict,
    extendedVerdict: report.extendedVerdict,
    coreSummary: report.coreSummary,
    notes: report.notes,
    appliedPacks: report.packs,
    packErrors: report.packErrors,
    findings,
    blocked,
    clean,
  };
}

// ── 확정 단계 (엔젤이 "받는다"를 고른 뒤에만 불린다) ─────────────────

export interface AcceptedPayment {
  /** 양측 서명이 완결된 코인들 — 엔젤 지갑에 저장한다. */
  coins: Coin[];
  /** 지불자에게 역제시할 확인 메시지. */
  confirm: ConfirmMessage;
}

/**
 * 확인 서명 만들기 — **여기서 처음으로 서명이 생긴다.**
 *
 * `qr.ts`의 `acceptPayment`와 만들어 내는 것은 같지만, 검사를 함께 하지 않는다.
 * 검사와 서명을 한 함수에 묶어 두었던 것이 "스캔 = 수령 확정"의 원인이었다 —
 * 두 일을 갈라 놓아야 그 사이에 사람이 설 자리가 생긴다(헌법 제9조).
 *
 * ★검사와 서명을 갈라 놓으면 새 구멍이 생긴다: **검토한 것과 다른 것을 확정**하는 것.
 * 적대검증에서 재현됐다 — 검토를 통과한 청구에 검토된 적 없는 지불을 붙여 넘기면
 * 그대로 서명됐다. 그때 막아 준 것은 호출부가 자기 필드에서 꺼내 쓴다는 관습뿐이었고,
 * 관습은 리팩터 한 번에 사라진다. 그래서 **검토 리포트를 필수 인자로 받아 대조한다.**
 */
export function acceptReviewedPayment(
  review: ReceiveReview,
  charge: ChargeMessage,
  payment: PaymentMessage,
  angelSigner: Signer,
): AcceptedPayment {
  if (review.blocked) {
    throw new Error('이 지불은 수령할 수 없습니다 (서명·계보·금액 문제).');
  }
  if (review.chargeId !== charge.chargeId || payment.chargeId !== charge.chargeId) {
    throw new Error('검토한 청구와 다른 청구입니다 — 다시 스캔하세요');
  }
  if (review.paymentSignature !== payment.signature) {
    throw new Error('검토한 지불과 다른 지불입니다 — 다시 스캔하세요');
  }
  const angelAddress = addressFromPublicKey(angelSigner.publicKeyHex);
  const coins = payment.coins.map((coin) => acknowledgeTransfer(coin, angelSigner));
  for (const coin of coins) {
    // 마지막 방어선: 확인 서명을 붙이고 나서도 소유자가 내가 아니면 저장하지 않는다.
    if (currentOwnerAddress(coin) !== angelAddress) {
      throw new Error(`완결 검증 실패: ${coinSerial(coin)}는 내 앞으로 온 코인이 아닙니다`);
    }
  }
  const unsigned = {
    v: 1 as const,
    type: 'shvil/confirm' as const,
    chargeId: charge.chargeId,
    coinIds: coins.map((c) => c.id),
    createdAt: payment.createdAt,
  };
  return { coins, confirm: { ...unsigned, signature: signObject(unsigned, angelSigner) } };
}
