/**
 * WalkSegmentProof — 구간 요약에 기기 키로 서명한 구조체 (지시서 2.2).
 * 자기 인증: 검증 서버 없음. 앱이 스스로 규칙을 적용해 만들고, 신뢰성은
 * 앱 무결성 증명(3장)이 보장한다.
 */
import { signObject, verifyObject, type Signer } from './crypto';
import type { SettlementDraft } from './ledger';
import type { WalkSegmentProof } from './types';

export interface ProofOptions {
  /** 앱 무결성 증명 토큰 (Play Integrity / App Attest). M1에서 실토큰 연동. */
  appIntegrityToken?: string | null;
}

/** 서명 대상 페이로드 (signature 필드 제외). */
function proofPayload(proof: Omit<WalkSegmentProof, 'signature'>): Omit<WalkSegmentProof, 'signature'> {
  const { v, memberId, devicePublicKey, courseIds, startedAt, settledAt, distanceM, stepCount, amountDshv, settlement, dailyBreakdown, sensorSummaryHash, appIntegrityToken } = proof;
  return { v, memberId, devicePublicKey, courseIds, startedAt, settledAt, distanceM, stepCount, amountDshv, settlement, dailyBreakdown, sensorSummaryHash, appIntegrityToken };
}

export function buildWalkSegmentProof(
  draft: SettlementDraft,
  deviceSigner: Signer,
  options: ProofOptions = {},
): WalkSegmentProof {
  const unsigned: Omit<WalkSegmentProof, 'signature'> = {
    v: 1,
    memberId: draft.memberId,
    devicePublicKey: deviceSigner.publicKeyHex,
    courseIds: draft.courseIds,
    startedAt: draft.startedAt,
    settledAt: draft.settledAt,
    distanceM: draft.distanceM,
    stepCount: draft.stepCount,
    amountDshv: draft.amountDshv,
    settlement: draft.settlement,
    dailyBreakdown: draft.dailyBreakdown,
    sensorSummaryHash: draft.sensorSummaryHash,
    appIntegrityToken: options.appIntegrityToken ?? null,
  };
  return { ...unsigned, signature: signObject(proofPayload(unsigned), deviceSigner) };
}

/** 증명 서명 검증 + 내부 정합(일자별 합계 = 총액) 검사. */
export function verifyWalkSegmentProof(proof: WalkSegmentProof): boolean {
  if (proof.v !== 1) return false;
  if (!Number.isInteger(proof.amountDshv) || proof.amountDshv <= 0) return false;
  const sum = proof.dailyBreakdown.reduce((acc, d) => acc + d.amountDshv, 0);
  if (sum !== proof.amountDshv) return false;
  return verifyObject(proofPayload(proof), proof.signature, proof.devicePublicKey);
}
