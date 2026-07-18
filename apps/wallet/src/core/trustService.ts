/**
 * 검증 가능한 신뢰 지표 서비스 — C (검증가능신뢰_설계.md, 헌법 제3조·제9조).
 *
 * 별점(주관 점수)이 위조를 못 막으므로(R-1d), 신뢰의 주 지표를 위조가 어려운
 * 사실로 옮긴다. 이 서비스는 서버 집계(GET /trust)를 왕복할 뿐 — 지갑은 계산하지
 * 않는다(사실의 출처는 서버가 대조한 커뮤니티 투표·교차 목격·서명된 가입 시점이다).
 *
 * 프라이버시: 공개(setVisible)는 본인의 자발 선택이며, 서버는 동의 없이 집계를
 * 노출하지 않는다. 이 지표들은 개인 실적일 뿐 "누가 누구와" 관계를 남기지 않는다.
 */
import type { TrustSummary } from '@shvil/shared';
import { directoryApi } from './directory';
import { loadCoinsForSync } from './db';
import { isProvisionalMemberId } from './identity';
import { pickWalkCreditCandidates } from './trustFormat';

/** 내 신뢰 지표 + 공개 여부 (본인). 공개 여부와 무관하게 자기 것은 본다. */
export async function loadMyTrust(): Promise<{ visible: boolean; trust: TrustSummary | null }> {
  return directoryApi.getMyTrust();
}

/** 내 신뢰 지표 공개 on/off — 서버는 동의 없이 노출하지 않는다. */
export async function setTrustVisible(visible: boolean): Promise<boolean> {
  const res = await directoryApi.setTrustVisible(visible);
  return res.visible;
}

/** 상대 신뢰 지표 열람 — 미공개·미가입은 { visible:false, trust:null }. */
export async function loadTrust(memberId: string): Promise<{ visible: boolean; trust: TrustSummary | null }> {
  return directoryApi.getTrust(memberId);
}

/**
 * 검증 실적 기여 — 내가 받은 걷기 코인으로 **그것을 걸어 만든 사람**의 실적을
 * 증언한다 (안 A, 헌법 제7조 선행의 순환). 내 이득은 없다.
 *
 * 기회적이다: 온라인일 때만 성공하고 실패는 무해하다(다음 기회에 재제출 —
 * 서버가 proofHash로 dedup하므로 중복 제출도 안전하다). 미가입이면 skip
 * (제출은 서명 인증이 필요하다). 반환: 이번에 새로 적재된 건수.
 */
export async function contributeWalkCredit(myMemberId: string, myAddress: string): Promise<number> {
  if (isProvisionalMemberId(myMemberId)) return 0;
  const coins = await loadCoinsForSync();
  const candidates = pickWalkCreditCandidates(coins, myMemberId, myAddress);
  if (candidates.length === 0) return 0;
  const { credited } = await directoryApi.contributeTrustCoins(candidates);
  return credited;
}
