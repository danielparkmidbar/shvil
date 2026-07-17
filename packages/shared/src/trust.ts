/**
 * 검증 가능한 신뢰 지표 (C안 — 검증가능신뢰_설계.md, 헌법 제3조·제9조).
 *
 * 별점(주관 점수)은 프라이버시를 지키며 위조를 막을 수 없다(R-1e) → 신뢰의 주
 * 지표를 "위조가 어려운 객관적 사실"로 옮긴다: 커뮤니티 인정 완주(claims 투표),
 * 교차 목격된 걷기 실적(walk_proof_stats), 활동 기간(가입 시점), 게스트북 카드 수.
 *
 * ── 프라이버시 (설계 §3) ────────────────────────────────────────────
 *  - 이 지표들은 개인 실적일 뿐 "누가 누구와" 관계를 담지 않는다.
 *  - 걷기 실적은 세밀한 코인 액수를 공개하면 개인 재정 노출 → **구간 뱃지**
 *    (tier 코드)로만 표현한다. 정확한 dSHV는 응답 어디에도 나가지 않는다.
 *  - 표시 여부는 본인이 선택한다(자발 공개) — 서버는 동의 없이 집계를 노출하지
 *    않는다 (trust_disclosures 게이트, 서버 trust.ts).
 *
 * ── 위조 견고성 (정직한 한계 명시 — 헌법 제3조) ─────────────────────
 *  - claimsApproved: 타인 N명의 투표가 필요 — 혼자 못 만든다 (sybil 비용 = 계정 N개).
 *  - walkTier: 생산자 본인이 아닌 회원이 그 코인을 목격(sync·예치)한 증명만 집계
 *    한다(교차 목격). /sync/coins 지문은 서명 검증이 없어 자기 신고만으로는
 *    부풀릴 수 있기 때문이다 — 교차 목격 요구로 "유통된 코인"만 실적이 된다
 *    (sybil 비용 = 두 번째 계정. 남는 위험으로 문서화).
 *  - certificates: 사진+데이터 자기 제출(투표 없음) — 보조 지표로만.
 *  - 별점(M7-B)·리더보드 자기신고 raw는 여기 없다 — 참고 지표로 병기(클라이언트).
 *
 * 서버는 tier 코드·숫자·일자만 반환한다 (noUiStrings) — 문구는 클라이언트 사전 몫.
 */

/** 걷기 실적 구간 뱃지 — 코드만 (문구는 각 클라이언트 i18n). */
export type TrustWalkTier = 'NONE' | 'STARTER' | 'EXPERIENCED' | 'VETERAN';

export const TRUST_WALK_TIERS: readonly TrustWalkTier[] = ['NONE', 'STARTER', 'EXPERIENCED', 'VETERAN'];

/**
 * 구간 경계 (dSHV — 1km = 1 SHV = 10 dSHV 기준 요율):
 *  STARTER ≥ 1 (첫 검증 실적), EXPERIENCED ≥ 500 (≈50km), VETERAN ≥ 2000 (≈200km).
 * 경계는 서버·클라이언트가 같은 값을 봐야 하므로 여기(공유 코어)에 둔다.
 */
export const TRUST_WALK_TIER_MIN_DSHV: Readonly<Record<Exclude<TrustWalkTier, 'NONE'>, number>> = {
  STARTER: 1,
  EXPERIENCED: 500,
  VETERAN: 2000,
};

/** 교차 목격된 걷기 실적 합(dSHV) → 구간 뱃지. 정확 액수는 밖으로 내지 않는다. */
export function walkTierOf(corroboratedDshv: number): TrustWalkTier {
  if (corroboratedDshv >= TRUST_WALK_TIER_MIN_DSHV.VETERAN) return 'VETERAN';
  if (corroboratedDshv >= TRUST_WALK_TIER_MIN_DSHV.EXPERIENCED) return 'EXPERIENCED';
  if (corroboratedDshv >= TRUST_WALK_TIER_MIN_DSHV.STARTER) return 'STARTER';
  return 'NONE';
}

/** 엔젤(접대) 측 실적 — 엔젤 등록 회원만 채워진다. */
export interface AngelTrust {
  /** 게스트북 감사 카드 수 (작성자 동의 하 자발 게시된 것 — 보조 지표). */
  guestbookCards: number;
  /** 첫 접대 보너스 수령 = 실제 접대 1회 이상의 증빙 제출 이력. */
  firstHosting: boolean;
  /** 엔젤 등록일 (YYYY-MM-DD UTC — 일 단위 절사, 시각 비노출). */
  angelSinceDay: string;
}

/**
 * 신뢰 지표 요약 — GET /trust · GET /companions · GET /angels가 공유하는 모양.
 * 전부 위조 난이도가 명시된 "사실"이며 자연어 문구가 없다.
 */
export interface TrustSummary {
  /** 커뮤니티 투표로 인정된 클레임 수 (견고성 높음). */
  claimsApproved: number;
  /** 완주 인증(FULL) 수 — 사진+데이터 자기 제출 (보조). */
  certificatesFull: number;
  /** 구간 인증(SECTION) 수 — 사진+데이터 자기 제출 (보조). */
  certificatesSection: number;
  /** 교차 목격된 걷기 실적 구간 뱃지 (정확 액수 비노출 — 설계 §3). */
  walkTier: TrustWalkTier;
  /** 가입일 (YYYY-MM-DD UTC — 일 단위 절사, 시각 비노출). */
  memberSinceDay: string;
  /** 엔젤 실적 — 엔젤이 아니면 null. */
  angel: AngelTrust | null;
  /** 리더보드 검증(verified=1) 등재 여부 — 자기신고 raw 수치는 내보내지 않는다. */
  leaderboardVerified: boolean;
}

/** 타임스탬프 → YYYY-MM-DD (UTC) — 가입·등록 시각의 일 단위 절사 (시각 비노출). */
export function trustDayOf(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}
