/**
 * 디렉토리 서버 API 클라이언트 (지시서 1장 — 서버는 4가지만 담당).
 *
 * 서버의 역할: 엔젤 디렉토리 · 메신저 릴레이 · (마켓) · 코스 데이터 배포.
 * 거래 승인 기능은 없다 — 이 클라이언트 어디에도 지불/수령 API가 없다.
 * 지불·수령은 walletService의 QR 왕복 로컬 서명으로 완결된다.
 *
 * 오프라인 우선: 모든 호출은 실패 시 throw하며, 호출부가 우아하게 처리한다
 * (폴백·재시도·로컬 저장 유지). 서버는 편의 기능일 뿐이다.
 *
 * 이 모듈은 순수 TS다 — expo 모듈 import 금지 (vitest 테스트 대상).
 * 서버 URL 오버라이드·인증 컨텍스트는 wiring 모듈(directory.ts)이 주입한다.
 */
import {
  buildAuthHeaders,
  stableStringify,
  type CoinFingerprint,
  type CompanionMode,
  type CompanionPostInput,
  type CompanionStatus,
  type CompanionUpdateInput,
  type CourseData,
  type Coin,
  type FlaggedMemberEntry,
  type GeoPoint,
  type MembershipCertificate,
  type MessageEnvelope,
  type RatingDirection,
  type Signed,
  type SignedGrant,
  type MovementLeg,
  type Signer,
  type SpotPresenceLegReport,
  type TreasureSpec,
  type TrustSummary,
} from '@shvil/shared';

/** 기본 서버 URL — kv 오버라이드 가능 (실기기 테스트 시 LAN IP로 변경). */
export const DEFAULT_SERVER_URL = 'http://localhost:8787';

/** 네트워크 응답 대기 한도 (ms) — 광야 무통신에서 UI가 오래 멈추지 않게. */
const REQUEST_TIMEOUT_MS = 8_000;

// ── 계약 타입 ─────────────────────────────────────────────────────

export type BedService = 'ROOM' | 'SOFA' | 'TENT' | null;

/**
 * 잠자리 유형별 수용 인원 (2026-07-15 다니엘 쌤 — 잠자리 복수 선택).
 * 0 또는 undefined = 해당 유형 미제공. 값 범위 1~20 (서버가 방어적으로 재검증).
 */
export interface AngelBeds {
  room?: number;
  sofa?: number;
  tent?: number;
}

export interface AngelServices {
  /** 하위 호환용 단일 유형 — beds가 있으면 "인원이 가장 많은 유형"의 파생값이다. */
  bed: BedService;
  internet: boolean;
  shower: boolean;
  meal: boolean;
  /** 유형별 수용 인원 — 없으면 옛 레코드 (bed+capacity로 폴백 표시). */
  beds?: AngelBeds;
}

/** 엔젤 프로필 등록 입력 — 위치는 본인이 자발 공개하는 엔젤 포인트다. */
export interface AngelProfileInput {
  name: string;
  location: GeoPoint;
  services: AngelServices;
  /** 총 수용 인원 — services.beds가 있으면 유형별 인원의 합계(파생값)다. */
  capacity: number;
  conditions: string;
  visible: boolean;
  /**
   * M6 예약 (R-3): "지금 손님 받기 가능" 자발 공개 — 가능 여부 수준만.
   * 구체 날짜·캘린더는 서버로 가지 않는다 (E2E 메시지로만). 미지정 시 서버가 기존 값 유지.
   */
  available?: boolean;
}

/** 디렉토리의 엔젤 항목 (GET /angels). */
export interface AngelDirectoryEntry extends AngelProfileInput {
  memberId: string;
  messagingPublicKey: string;
  devicePublicKey: string;
  distanceKm?: number;
  /** 가능 여부 갱신 시각 (R-3) — 엔젤이 아직 설정한 적 없으면 null. */
  availabilityUpdatedAt?: number | null;
}

export interface RegisterArgs {
  phone: string;
  code: string;
  email: string;
  displayName: string;
  devicePublicKey: string;
  messagingPublicKey: string;
  /** 앱 무결성 토큰 (보안 감사 C-2) — 서버가 검증 후 회원 증서를 발급한다. */
  integrityToken?: string;
  /** 무결성 API 종류 구분 (예: 'android' | 'ios'). */
  platform?: string;
}

/** 증서 발급/갱신 요청 (POST /auth/certificate) — 서명 인증 + 무결성 토큰. */
export interface CertificateArgs {
  integrityToken?: string;
  platform?: string;
}

export interface PutAngelResult {
  profile: AngelDirectoryEntry;
  /** 최초 등록 시 1회 — 등록 보너스 20 SHV 승인서 (즉시 민팅할 것). */
  registrationGrant?: SignedGrant;
}

export interface PromoKeyInfo {
  keyId: string;
  publicKey: string;
}

/**
 * 신뢰 키 (GET /keys) — 발행 키 3종(프로모·클레임·격려)과 회원 증서 루트 키.
 * MEMBERSHIP_ROOT는 GRANT 발행 키가 아니라 회원 증서 검증용 신뢰 루트다 (보안 감사 C-2).
 */
export interface TrustedKeyInfo {
  keyId: string;
  publicKey: string;
  purpose: 'ANGEL_BONUS' | 'COMMUNITY_CLAIM' | 'COMMUNITY_REWARD' | 'MEMBERSHIP_ROOT' | string;
}

export interface RelayedMessage {
  id: number;
  envelope: MessageEnvelope;
}

// ── 게스트북 계약 타입 (M7-A — server/src/guestbook.ts와 계약을 공유한다) ──
// 감사 카드는 E2E 메시지다 (서버는 원본을 못 본다). 게스트북 게시는 엔젤이
// makePublic=true 동의를 확인한 뒤 자발적으로 하는 공개다 — 서버는 엔젤 서명으로
// 인증된 게시를 그대로 신뢰한다 (신뢰 모델은 guestbook.ts 주석). 공개 조회 응답에는
// 회원 번호가 없다 — 닉네임(fromDisplayName)만.

/** 방명록에 올릴 카드 내용 (엔젤 게시 입력) — makePublic 확인은 지갑이 이미 마쳤다. */
export interface GuestbookPublishInput {
  cardId: string;
  fromDisplayName: string;
  template: string;
  message: string;
  journeyLine?: string;
}

/** 공개 방명록 카드 (GET /guestbook) — 회원 번호 없음, 닉네임만. */
export interface GuestbookCard {
  cardId: string;
  fromDisplayName: string;
  template: string;
  message: string;
  journeyLine: string | null;
  createdAt: number;
}

// ── 별점 계약 타입 (M7-B — server/src/ratings.ts와 계약을 공유한다) ────
// 별점은 E2E 서명 카드다 (감사 카드와 같은 신뢰 모델). 피평가자가 받은 별점 중
// 하나를 자발 게시하면 서버가 그 내용만 보관한다. ★프라이버시 핵심: 게시 본문에
// 관계 증명(relationProof)을 싣지 않는다 — 그것을 서버로 보내면 "누가 누구 집에
// 묵었나"가 남으므로. 서버는 피평가자 회원 번호만 알고, 평가자는 닉네임만 남는다.

/** 별점 게시 입력 (피평가자) — makePublic 확인·관계 검증은 지갑이 이미 마쳤다. */
export interface RatingPublishInput {
  ratingId: string;
  stars: number;
  review?: string;
  fromDisplayName: string;
  direction: RatingDirection;
  /**
   * 자발 신고 "받은 총 개수" — 공개율("N개 받음 / M개 공개")의 분모.
   * 평가자 정보를 담지 않는 단일 숫자다 (관계 유출 없음). 서버가 강제 집계하지 않는다.
   */
  receivedCount?: number;
}

/** 공개 별점 (GET /ratings) — 회원 번호 없음, 닉네임만. */
export interface PublicRating {
  ratingId: string;
  stars: number;
  review: string | null;
  fromDisplayName: string;
  direction: RatingDirection;
  createdAt: number;
}

/** 공개 별점 요약 (GET /ratings) — 평균(×10 정수)·게시 수·자발 신고 받은 수·카드. */
export interface RatingSummary {
  /** 평균 별점 ×10 정수 (46 = 4.6). 표시할 때 /10. */
  averageTenths: number;
  /** 게시된 별점 수. */
  publicCount: number;
  /** 자발 신고 받은 총 개수 (>= publicCount) — 공개율 분모. */
  receivedCount: number;
  ratings: PublicRating[];
}

// ── 동행 찾기 계약 타입 (M8 — server/src/companions.ts와 계약을 공유한다) ──
// 동행 게시글은 공개 모집이라 서버 저장이지만, 관심 표명은 E2E 메시지다 — 서버는
// "누가 누구와 팀"이라는 확정 관계를 저장하지 않는다. authorMemberId·messagingPublicKey는
// 화면 표시용이 아니라 E2E 접촉·딥링크를 위한 연락 라우팅 핸들이다 (엔젤 디렉토리와 동일).

/**
 * 공개 동행 게시글 (GET /companions) — 서버 JSON 형태.
 * note·courseId는 미제공 시 null (게스트북 journeyLine과 동일한 null 규약).
 */
export interface CompanionListing {
  postId: string;
  /** 화면 표시 신원 = 게시자 닉네임 (실명 아님). */
  displayName: string;
  /** 연락 라우팅 핸들 (E2E 접촉·딥링크용) — 실명·전화가 아닌 가명 ID. */
  authorMemberId: string;
  messagingPublicKey: string;
  regionId: string;
  courseId: string | null;
  fromDate: string;
  toDate: string;
  partySizeCurrent: number;
  partySizeTarget: number;
  mode: CompanionMode;
  note: string | null;
  status: CompanionStatus;
  createdAt: number;
  /** C 신뢰 지표: 게시자가 자발 공개한 완주·검증실적 뱃지 (미공개면 null). */
  trust: TrustSummary | null;
}

/** GET /companions 필터 (전부 선택). status 미지정 시 전체. */
export interface CompanionFilter {
  region?: string;
  course?: string;
  status?: CompanionStatus;
  author?: string;
}

// ── 보물 마이닝 계약 타입 (M9 — server/src/treasure.ts와 계약을 공유한다) ──
// 이동 검증은 100% 폰 로컬이다. 서버로 가는 것은 treasureId + 성공 요약 해시뿐 —
// 걸음·방향·좌표를 실어 보내는 필드는 이 계약에 존재하지 않는다.

/** 배포 목록의 보물 항목 — 명세 + 잔여 수량. */
export interface TreasureListEntry extends TreasureSpec {
  remaining: number;
}

/** 획득 청구 결과 — amountDshv>0이면 grant(폰에서 민팅), 0이면 스탬프 기록만. */
export interface TreasureClaimResult {
  treasureId: string;
  amountDshv: number;
  grant?: SignedGrant;
  stamp?: boolean;
}

// ── 스팟 보물 계약 타입 (M12 — server/src/spotTreasure.ts와 계약을 공유한다) ──
// 무기명 베어러 금지(M10 폐기). QR은 spotId만 담고, 그랜트는 서버가 인증된 회원에게만
// 발행한다. 손님이 받는 것은 amountDshv>0이면 grant(폰 민팅), 0이면 스탬프뿐이다.
// ★총량 보존: remainingSlots·totalSlots는 서버가 예치 총액에서 유도한 회계 파생값이며,
// 발행 슬롯 수 = floor(예치총액 / 1인당 양)이므로 발행이 예치를 넘을 수 없다.

/** 맵 배포의 스팟 항목 (GET /spot) — 잔여 > 0인 것만. 위치는 사업장이라 공개(눈금화 없음). */
export interface SpotListEntry {
  spotId: string;
  regionId: string;
  /** 사업장 표시명 (사용자 원문 — 번역 대상 아님, 엔젤 이름과 같은 범주). */
  displayName: string;
  location: GeoPoint;
  /** 1인당 지급액 (dSHV). */
  perClaimDshv: number;
  /** 선착순 인원(총 슬롯) = floor(예치총액 / 1인당 양). */
  totalSlots: number;
  /** 남은 선착순 슬롯 — 감소 양상(남은 수량). */
  remainingSlots: number;
  /** 예치 총액 (규모). */
  depositTotalDshv: number;
  validUntil: number;
  /**
   * R-스팟-현장결속: 청구 전 현장 몸-걸음 인증이 필요한 스팟인가.
   * true면 지갑이 지시를 받아(POST /spot/challenge) 그 자리에서 수행해야 한다.
   */
  requirePresence: boolean;
}

/** 현장 결속 1회용 지시 (POST /spot/challenge). */
export interface SpotPresenceChallengeResult {
  challengeId: string;
  spotId: string;
  /**
   * 사업장의 **공개 위치** (GET /spot과 동일한 운영자 공개 데이터 — 사용자 좌표
   * 아님). 폰이 근접 판정 기준으로 쓴다 — 미충전(목록 밖) 스팟도 인증 가능.
   */
  location: GeoPoint;
  legs: MovementLeg[];
  expiresAt: number;
  /** 이 지시를 사람이 수행하는 데 필요한 최소 시간(ms) — 화면 안내용. */
  minDurationMs: number;
}

/** 내 스팟 항목 (GET /spot/mine — 사업자) — 미충전 포함 전체 + 회계. */
export interface SpotMineEntry {
  spotId: string;
  regionId: string;
  sponsorMemberId: string;
  displayName: string;
  location: GeoPoint;
  perClaimDshv: number;
  depositTotalDshv: number;
  totalSlots: number;
  remainingSlots: number;
  issuedCount: number;
  validFrom: number;
  validUntil: number;
  status: 'OPEN' | 'CLOSED' | string;
}

/** 스팟 생성 입력 (POST /spot). sponsorMemberId는 서버가 서명자로 결속한다(클라 신뢰 안 함). */
export interface SpotCreateInput {
  spotId: string;
  regionId: string;
  displayName: string;
  location: GeoPoint;
  perClaimDshv: number;
  validFrom: number;
  validUntil: number;
}

export interface SpotCreateResult {
  spotId: string;
  created: boolean;
  /** 보물 리저브 공개키 — 사업자 지갑이 예치 소각 이전을 이 주소로 만든다. */
  reservePublicKey: string;
}

export interface SpotDepositResult {
  spotId: string;
  depositedDshv: number;
  depositTotalDshv: number;
  totalSlots: number;
  remainingSlots: number;
}

/** 스캔 청구 결과 — amountDshv>0이면 grant(폰에서 민팅), 0이면 스탬프 기록만. */
export interface SpotClaimResult {
  spotId: string;
  amountDshv: number;
  grant?: SignedGrant;
  stamp?: boolean;
}

// ── 커뮤니티 계약 타입 (M4 — server/src/community.ts와 계약을 공유한다) ──
// 클레임·격려의 발행은 전부 "승인서(SignedGrant)"다 — 코인이 되는 것은
// 이 지갑의 민팅(mintFromGrant)에서다. 여기에도 거래 승인 API는 없다.

/** 후보 코스 제안 — 100명 완주 기록이 쌓이면 공식 승격 (지시서 6장 3절). */
export interface CourseProposal {
  courseId: string;
  name: string;
  status: 'CANDIDATE' | 'OFFICIAL' | string;
  completions: number;
  promotionThreshold: number;
  createdAt: number;
}

export interface CourseProposalInput {
  courseId: string;
  name: string;
  polyline: GeoPoint[];
  segments?: unknown[];
}

/** 클레임 게시물 (누락 걸음 구제 — 지시서 2.5). 좌표 없음 — 코스 ID·거리·시각뿐. */
export interface ClaimEntry {
  claimId: number;
  memberId: string;
  courseId: string;
  walkedAt: number;
  distanceM: number;
  photos: string[];
  status: 'OPEN' | 'APPROVED' | string;
  votes: number;
  voteThreshold: number;
  createdAt: number;
}

/** 클레임 상세 — 승인되면 grant(발행 승인서)가 붙는다. */
export interface ClaimDetail {
  claimId: number;
  memberId: string;
  courseId: string;
  distanceM: number;
  status: string;
  votes: number;
  grant: SignedGrant | null;
}

export interface ClaimVoteResult {
  votes: number;
  status: 'OPEN' | 'APPROVED' | string;
  voteThreshold?: number;
  amountDshv?: number;
}

/**
 * 소명 대기 회원 (지시서 3장 5절) — 이 회원이 생성한 코인은 수령 보류.
 * 사유는 서버가 만든 문장이 아니라 코드 + 파라미터다 (@shvil/shared FlagReason).
 * 화면 문구는 지갑이 조립한다 (screens/flagReasonText.ts).
 */
export type { FlaggedMemberEntry };

// ── 마켓 계약 타입 (M3 — server/src/market.ts와 계약을 공유한다) ────
// 서버의 역할은 에스크로 상태 관리뿐이다. SHV 이전 자체는 판매자의 지불
// 서명과 구매자의 확인 서명으로 완결된다 — 여기에도 거래 승인 API는 없다.

export type EscrowStatus = 'AWAITING_DEPOSIT' | 'DEPOSITED' | 'COINS_SUBMITTED' | 'COMPLETED';

/** 무정가 리스팅 — 가격 필드는 존재하지 않는다. 구매자가 제시한다 (지시서 0-8). */
export interface MarketListing {
  listingId: number;
  sellerMemberId: string;
  sellerName: string | null;
  amountDshv: number;
  createdAt: number;
}

/** 내 리스팅에 들어온 가격 제시 (판매자 시점). */
export interface ListingOffer {
  offerId: number;
  buyerMemberId: string;
  totalUsdcMicro: number;
  status: string;
  createdAt: number;
}

/** 내가 제시한 가격 (구매자 시점) — 승인되면 에스크로가 붙는다. */
export interface MyOffer {
  offerId: number;
  listingId: number;
  totalUsdcMicro: number;
  status: string;
  escrowId: number | null;
  escrowStatus: EscrowStatus | null;
}

export interface EscrowState {
  escrowId: number;
  status: EscrowStatus;
  depositRef: string;
  amountDshv: number;
  totalUsdcMicro: number;
  feeUsdcMicro: number;
  buyerDevicePublicKey: string;
  /** 판매자가 서명해 올린 코인 — 구매자에게만, COINS_SUBMITTED일 때. */
  coins: Coin[] | null;
}

export interface ApproveOfferResult {
  escrowId: number;
  depositRef: string;
  feeUsdcMicro: number;
}

export interface AckEscrowResult {
  status: 'COMPLETED';
  txId: string;
  releasedUsdcMicro: number;
  feeUsdcMicro: number;
}

// ── 서명 요청 구성 (순수 함수 — 단위 테스트 대상) ─────────────────

export interface AuthContext {
  memberId: string;
  signer: Signer;
}

export interface SignedRequestParts {
  url: string;
  /** 서명 대상 pathname — 쿼리스트링 제외. */
  pathname: string;
  /** 서명 대상 본문 텍스트 — GET은 ''. */
  bodyText: string;
  headers: Record<string, string>;
}

/**
 * 요청 URL·본문·헤더 구성. 서명 인증은 buildAuthHeaders 3개 헤더를 붙이며,
 * path는 쿼리스트링을 제외한 pathname만 서명한다 (서버 계약).
 */
export function buildSignedRequest(
  baseUrl: string,
  method: string,
  pathWithQuery: string,
  body: unknown,
  auth: AuthContext | null,
  now: number,
): SignedRequestParts {
  const pathname = pathWithQuery.split('?')[0]!;
  const bodyText = body === undefined || body === null ? '' : JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (bodyText !== '') headers['content-type'] = 'application/json';
  if (auth) {
    Object.assign(headers, buildAuthHeaders(auth.memberId, auth.signer, method, pathname, bodyText, now));
  }
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return { url: base + pathWithQuery, pathname, bodyText, headers };
}

// ── 클라이언트 ────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface DirectoryApiOptions {
  getBaseUrl(): Promise<string>;
  /** 서명 인증이 필요한 호출에서만 사용 — 미가입(M-) 상태에선 호출부가 걸러야 한다. */
  getAuth(): AuthContext;
  /** 테스트 주입용. 기본 globalThis.fetch. */
  fetchFn?: typeof fetch;
  now?: () => number;
}

export class DirectoryApi {
  readonly #opts: DirectoryApiOptions;

  constructor(opts: DirectoryApiOptions) {
    this.#opts = opts;
  }

  async #request<T>(method: string, pathWithQuery: string, body: unknown, signed: boolean): Promise<T> {
    const baseUrl = await this.#opts.getBaseUrl();
    const now = (this.#opts.now ?? Date.now)();
    const auth = signed ? this.#opts.getAuth() : null;
    const parts = buildSignedRequest(baseUrl, method, pathWithQuery, body, auth, now);

    const fetchFn = this.#opts.fetchFn ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchFn(parts.url, {
        method,
        headers: parts.headers,
        body: parts.bodyText === '' ? undefined : parts.bodyText,
        signal: controller.signal,
      });
    } catch (e) {
      throw new ApiError(0, `서버에 연결할 수 없습니다 (${parts.url}): ${e instanceof Error ? e.message : e}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { error?: string; message?: string };
        detail = parsed.error ?? parsed.message ?? text;
      } catch {
        /* 본문이 JSON이 아니면 원문 그대로 */
      }
      throw new ApiError(res.status, detail || `HTTP ${res.status}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  // ── 가입 (전화 OTP + 이메일 — 의무 신원 정보는 이 둘뿐, 지시서 2.1) ──

  /** 개발 모드: 응답의 devCode를 UI에서 자동 채움 허용. */
  requestOtp(phone: string): Promise<{ devCode?: string }> {
    return this.#request('POST', '/auth/otp', { phone }, false);
  }

  register(args: RegisterArgs): Promise<{ memberId: string; membershipCertificate: MembershipCertificate }> {
    return this.#request('POST', '/auth/register', args, false);
  }

  /**
   * 회원 증서 발급/갱신 (서명 인증) — 만료 임박 시 재발급. 무결성 토큰을 제출하면
   * 서버가 검증 후 새 증서를 서명해 돌려준다. 온라인 전용 (실패 시 호출부가 무시).
   */
  refreshCertificate(args: CertificateArgs): Promise<{ membershipCertificate: MembershipCertificate }> {
    return this.#request('POST', '/auth/certificate', args, true);
  }

  // ── 코스 데이터 배포 ──

  /**
   * 배포 서명 포함 원본 응답 (보안 감사 H-3). 검증(_sig)·TOFU 핀은
   * directory.ts가 수행한다 — 이 계층은 전송만 담당.
   */
  getCourses(): Promise<Signed<{ courses: CourseData[] }>> {
    return this.#request('GET', '/courses', null, false);
  }

  // ── 보물 마이닝 (M9) ──

  /**
   * 유효 기간 내 보물 목록 (배포 서명 포함 원본 — H-3). 검증·TOFU 핀은 directory.ts.
   * 지시(legs)가 공개되어도 존에 도착해 몸으로 수행하지 않으면 소용없다.
   */
  getTreasures(region?: string): Promise<Signed<{ treasures: TreasureListEntry[] }>> {
    const q = region ? `/treasures?region=${encodeURIComponent(region)}` : '/treasures';
    return this.#request('GET', q, null, false);
  }

  /**
   * 획득 청구 (서명 인증) — 서버 왕복은 이 1회뿐이며 수량 한정 발행의 회계 때문이다.
   * 보내는 것은 성공 요약의 해시뿐 — 이동 원자료(걸음·방향·좌표)는 폰을 떠나지 않는다.
   */
  claimTreasure(treasureId: string, transcriptHash: string): Promise<TreasureClaimResult> {
    return this.#request('POST', '/treasures/claim', { treasureId, transcriptHash }, true);
  }

  // ── 스팟 보물 (M12 — 사업자 예치 소각 → 서버 선착순 재배포) ──

  /**
   * 유효 기간 내·잔여>0 스팟 목록 (배포 서명 포함 원본 — H-3). 검증·TOFU 핀은 directory.ts.
   * 코인이 없으면(잔여 0) 서버가 아예 내려주지 않는다 (다니엘 쌤 결정 2번).
   */
  getSpots(region?: string): Promise<Signed<{ spots: SpotListEntry[]; reservePublicKey: string }>> {
    const q = region ? `/spot?region=${encodeURIComponent(region)}` : '/spot';
    return this.#request('GET', q, null, false);
  }

  /** 내 스팟 목록 (사업자 서명) — 미충전 포함 전체 + 회계 + 리저브 공개키. */
  getMySpots(): Promise<{ spots: SpotMineEntry[]; reservePublicKey: string }> {
    return this.#request('GET', '/spot/mine', null, true);
  }

  /** 스팟 생성 (사업자 서명) — 예치 전 상태로 등록. 응답에 리저브 공개키가 온다. */
  createSpot(input: SpotCreateInput): Promise<SpotCreateResult> {
    return this.#request('POST', '/spot', input, true);
  }

  /**
   * 예치(충전) — 리저브로 소각한 미완결 이전 코인들을 제출한다 (사업자 서명).
   * 발행이 아니라 재배포다: 서버가 소각을 검증하고 그 동량을 예치 잔고로 등록한다.
   */
  depositSpot(spotId: string, coins: Coin[]): Promise<SpotDepositResult> {
    return this.#request('POST', '/spot/deposit', { spotId, coins }, true);
  }

  /**
   * 현장 결속 지시 발급 (회원 서명) — 그 자리에서 수행할 1회용 랜덤 이동 지시.
   * 매번 새로 받아야 하며(재사용 불가), 새로 받으면 이전 미소비 지시는 죽는다.
   */
  requestSpotChallenge(spotId: string): Promise<SpotPresenceChallengeResult> {
    return this.#request('POST', '/spot/challenge', { spotId }, true);
  }

  /**
   * 스캔 청구 (스캐너=회원 서명) — 스팟당 1인 1회. 서버 왕복은 수량 한정 발행의
   * 회계다(승인 아님). grant면 폰에서 민팅(BONUS 계보), 아니면 스탬프뿐.
   *
   * R-스팟-현장결속: 현장 인증을 요구하는 스팟이면 challengeId + 수행 보고(legs)를
   * 함께 보낸다. 보고에는 좌표·변위가 없다 — 지시와 측정 걸음뿐이다. 근접·변위
   * 판정은 폰이 이미 마쳤고(서버는 볼 수 없다), 서버는 자기가 낸 지시와 대조한다.
   */
  claimSpot(spotId: string, presence?: { challengeId: string; legs: SpotPresenceLegReport[] }): Promise<SpotClaimResult> {
    return this.#request('POST', '/spot/claim', { spotId, ...(presence ?? {}) }, true);
  }

  /** 스팟 마감 (사업자 서명) — 남은 예치 소각분은 회수되지 않는다(영구 소각). */
  closeSpot(spotId: string): Promise<{ spotId: string; status: string }> {
    return this.#request('POST', '/spot/close', { spotId }, true);
  }

  // ── 엔젤 디렉토리 ──

  async getAngels(lat: number, lon: number, radiusKm: number): Promise<AngelDirectoryEntry[]> {
    const q = `/angels?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radiusKm=${encodeURIComponent(radiusKm)}`;
    const res = await this.#request<{ angels: AngelDirectoryEntry[] }>('GET', q, null, false);
    return res.angels;
  }

  /** 내 엔젤 포인트 등록/수정 (서명 인증). 최초 등록 시 registrationGrant 1회. */
  putMyAngelProfile(profile: AngelProfileInput): Promise<PutAngelResult> {
    return this.#request('PUT', '/angels/me', profile, true);
  }

  /** 첫 접대 보너스 청구 — 수령 코인(transferChain ≥ 1) 하나를 증빙으로 제출. 중복이면 409. */
  claimFirstHosting(coin: Coin): Promise<{ grant: SignedGrant }> {
    return this.#request('POST', '/angels/first-hosting', { coin }, true);
  }

  /** 신뢰 발행 키 — 캐시해 verifyCoin의 trustedIssuerKeys로 사용. */
  getPromoKey(): Promise<PromoKeyInfo> {
    return this.#request('GET', '/keys/promo', null, false);
  }

  /**
   * 신뢰 발행 키 + 회원 증서 루트 (배포 서명 포함 원본 — 보안 감사 H-3).
   * 검증·TOFU 핀은 directory.ts에서.
   */
  getTrustedKeys(): Promise<Signed<{ keys: TrustedKeyInfo[] }>> {
    return this.#request('GET', '/keys', null, false);
  }

  // ── 커뮤니티: 코스 등록부 (지시서 6장 3절 — 온라인 전용 서버 기능) ──

  /** 승격 현황 공개 — 후보 코스별 완주 기록 수 (비서명). */
  async getCourseProposals(): Promise<CourseProposal[]> {
    const res = await this.#request<{ proposals: CourseProposal[] }>('GET', '/courses/proposals', null, false);
    return res.proposals;
  }

  /** 사용자 코스 제안 — 후보 상태로 게시된다. */
  proposeCourse(input: CourseProposalInput): Promise<{ courseId: string; status: string }> {
    return this.#request('POST', '/courses/proposals', input, true);
  }

  /** 완주 기록 제출 — 후보 코스 지지. 기준 인원(100명) 도달 시 공식 승격. */
  submitCompletion(
    courseId: string,
    distanceM: number,
    days: number,
  ): Promise<{ courseId: string; completions: number; promoted: boolean }> {
    return this.#request('POST', `/courses/${encodeURIComponent(courseId)}/completions`, { distanceM, days }, true);
  }

  // ── 커뮤니티: 클레임 게시판 (누락 걸음 구제 — 지시서 2.5) ──

  /**
   * 클레임 접수 — 걷기 발생 후 24시간 이내·월 2회 한도 (서버가 검증).
   * 좌표 없음: 코스 ID·거리·시각·사진 참조뿐 (위치 비저장 원칙).
   */
  submitClaim(input: {
    courseId: string;
    walkedAt: number;
    distanceM: number;
    photos: string[];
  }): Promise<{ claimId: number; status: string }> {
    return this.#request('POST', '/claims', input, true);
  }

  /** 클레임 목록 (비서명 공개) — status 필터 가능 (예: 'OPEN'). */
  async getClaims(status?: string): Promise<ClaimEntry[]> {
    const q = status ? `/claims?status=${encodeURIComponent(status)}` : '/claims';
    const res = await this.#request<{ claims: ClaimEntry[] }>('GET', q, null, false);
    return res.claims;
  }

  /** 클레임 상세 — APPROVED면 grant가 붙는다 (본인 지갑에서 민팅). */
  getClaim(claimId: number): Promise<ClaimDetail> {
    return this.#request('GET', `/claims/${claimId}`, null, false);
  }

  /** 인정 투표 — 본인 클레임 불가·1인 1표. 기준 인원 도달 시 서버가 승인서 발행. */
  voteClaim(claimId: number): Promise<ClaimVoteResult> {
    return this.#request('POST', `/claims/${claimId}/vote`, {}, true);
  }

  // ── 커뮤니티: 완주 인증 게시판 (격려 코인 — 지시서 2.6) ──

  /** 완주 인증 제출 — 요건(사진+데이터) 충족 시 즉시 격려 승인서 (완주 10 / 구간 3 SHV). */
  submitCertificate(input: {
    courseId: string;
    kind: 'FULL' | 'SECTION';
    photos: string[];
    data: Record<string, unknown>;
  }): Promise<{ certificateId: number; grant: SignedGrant }> {
    return this.#request('POST', '/certificates', input, true);
  }

  // ── 커뮤니티: 소명 대기 목록 (지시서 3장 5절) ──

  /**
   * 소명 대기 회원 번호 목록 (비서명, 배포 서명 포함 원본 — 보안 감사 H-3).
   * 조작된 목록으로 정상 회원을 차단하거나 악성 회원을 통과시키는 MITM을
   * directory.ts의 검증이 막는다.
   */
  getFlaggedMembers(): Promise<Signed<{ members: FlaggedMemberEntry[] }>> {
    return this.#request('GET', '/limits/flagged', null, false);
  }

  // ── 기회적 동기화 (보안 감사 H-1) — 사후 이중 사용·초과 생성 대조 ──

  /**
   * 코인 지문 일괄 제출 (서명 인증). 좌표 없음 — 코인에 이미 새겨진 공개 정보뿐.
   * 응답은 수리 개수뿐 — 대조 결과로 타인을 정찰할 수 없다.
   */
  syncCoinFingerprints(fingerprints: CoinFingerprint[]): Promise<{ accepted: number }> {
    return this.#request('POST', '/sync/coins', { fingerprints }, true);
  }

  // ── 암호화 지갑 백업 (보안 감사 L-2) — 서버는 blob 내용을 못 본다 ──

  /** 백업 blob 업로드 (서명 인증). */
  uploadBackup(blob: string): Promise<{ stored: boolean; digest: string }> {
    return this.#request('POST', '/backup', { blob }, true);
  }

  /**
   * 백업 복구 조회 — 회원 번호 없이 기기 키 소유 증명(별도 서명 헤더)으로.
   * 니모닉으로 기기 키를 복원한 새 폰이 회원 번호를 모른 채로도 복구한다.
   */
  async fetchBackup(recoverySigner: Signer): Promise<{ blob: string; digest: string; updatedAt: number }> {
    const baseUrl = await this.#opts.getBaseUrl();
    const now = (this.#opts.now ?? Date.now)();
    // 서버 backup.ts의 recoverPayload와 동일한 정준 서명 대상.
    const payload = stableStringify({
      t: 'shvil-backup-recover-v1',
      devicePublicKey: recoverySigner.publicKeyHex,
      timestamp: now,
    });
    const sig = recoverySigner.sign(new TextEncoder().encode(payload));
    const fetchFn = this.#opts.fetchFn ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}/backup`, {
        method: 'GET',
        headers: {
          'x-shvil-device-pubkey': recoverySigner.publicKeyHex,
          'x-shvil-ts': String(now),
          'x-shvil-sig': sig,
        },
        signal: controller.signal,
      });
    } catch (e) {
      throw new ApiError(0, `서버에 연결할 수 없습니다: ${e instanceof Error ? e.message : e}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        detail = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        /* 원문 유지 */
      }
      throw new ApiError(res.status, detail || `HTTP ${res.status}`);
    }
    return JSON.parse(text) as { blob: string; digest: string; updatedAt: number };
  }

  // ── 메신저 릴레이 (서버는 암호문 봉투만 중계) ──

  postMessage(envelope: MessageEnvelope): Promise<{ id: number }> {
    return this.#request('POST', '/messages', { envelope }, true);
  }

  async getMessages(sinceId: number): Promise<RelayedMessage[]> {
    const res = await this.#request<{ messages: RelayedMessage[] }>(
      'GET',
      `/messages?sinceId=${encodeURIComponent(sinceId)}`,
      null,
      true,
    );
    return res.messages;
  }

  // ── 게스트북 (M7-A — 엔젤이 받은 감사 카드를 자발 공개 게시) ──

  /** 게스트북 게시 (엔젤 서명 인증) — makePublic 동의 확인은 호출부(지갑)의 몫. */
  publishGuestbookCard(input: GuestbookPublishInput): Promise<{ published: boolean; cardId: string }> {
    return this.#request('POST', '/guestbook', input, true);
  }

  /** 게시 철회 (엔젤 서명 인증) — 자기 방명록의 카드만 삭제된다. */
  removeGuestbookCard(cardId: string): Promise<{ removed: boolean; cardId: string }> {
    return this.#request('DELETE', `/guestbook/${encodeURIComponent(cardId)}`, null, true);
  }

  /** 공개 방명록 열람 (비서명) — member 미지정 시 최근 전체. 회원 번호 없음. */
  async getGuestbook(memberId?: string): Promise<{ total: number; cards: GuestbookCard[] }> {
    const q = memberId ? `/guestbook?member=${encodeURIComponent(memberId)}` : '/guestbook';
    return this.#request('GET', q, null, false);
  }

  // ── 상호 별점 (M7-B — 피평가자가 받은 별점을 자발 공개 게시) ──

  /**
   * 별점 게시 (피평가자 서명 인증) — makePublic 동의·관계 검증은 호출부(지갑)의 몫.
   * 관계 증명은 보내지 않는다 (프라이버시 핵심 — 서버는 관계를 몰라야 한다).
   */
  publishRating(input: RatingPublishInput): Promise<{ published: boolean; ratingId: string }> {
    return this.#request('POST', '/ratings', input, true);
  }

  /** 게시 철회 (피평가자 서명 인증) — 자기 프로필의 별점만 삭제된다. */
  removeRating(ratingId: string): Promise<{ removed: boolean; ratingId: string }> {
    return this.#request('DELETE', `/ratings/${encodeURIComponent(ratingId)}`, null, true);
  }

  /** 공개 별점 열람 (비서명) — 평균·게시 수·자발 신고 받은 수·카드. 회원 번호 없음. */
  getRatings(memberId: string): Promise<RatingSummary> {
    return this.#request('GET', `/ratings?member=${encodeURIComponent(memberId)}`, null, false);
  }

  // ── 검증 가능한 신뢰 지표 (C — 별점 대신 사실, 검증가능신뢰_설계.md) ──

  /**
   * 내 신뢰 지표 + 공개 여부 (본인 서명 인증). 공개 여부와 무관하게 자기 것은 본다.
   * 위조가 어려운 사실(커뮤니티 인정 완주·교차 목격 걷기 실적·활동 기간)의 요약이다.
   */
  getMyTrust(): Promise<{ visible: boolean; trust: TrustSummary | null }> {
    return this.#request('GET', '/trust/me', null, true);
  }

  /** 신뢰 지표 공개 on/off (본인 서명 인증) — 서버는 동의 없이 집계를 노출하지 않는다. */
  setTrustVisible(visible: boolean): Promise<{ visible: boolean }> {
    return this.#request('PUT', '/trust/me', { visible }, true);
  }

  /** 상대 신뢰 지표 열람 (비서명) — 미공개·미가입은 { visible:false, trust:null }. */
  getTrust(memberId: string): Promise<{ visible: boolean; trust: TrustSummary | null }> {
    return this.#request('GET', `/trust?member=${encodeURIComponent(memberId)}`, null, false);
  }

  /**
   * 검증 실적 기여 (제출자 서명 인증) — 내가 보유한 남의 걷기 코인을 올리면 서버가
   * verifyCoin으로 검증해 **그 코인을 만든 사람**의 실적으로 적재한다 (안 A).
   * 내 이득은 없다 — 내가 받은 코인이 그 사람의 걸음을 증언하는 이타적 기여다.
   * 조작 JSON은 서명이 없어 서버 검증에서 탈락하므로 뱃지를 부풀릴 수 없다.
   */
  contributeTrustCoins(coins: Coin[]): Promise<{ credited: number }> {
    return this.#request('POST', '/trust/coins', { coins }, true);
  }

  // ── 동행 찾기 (M8 — 여정 공유 + 팀 모집) ──

  /** 동행 모집 글 등록 (게시자 서명). 지역·날짜·팀 규모·이동 수단·한마디. */
  createCompanion(input: CompanionPostInput): Promise<{ posted: boolean; postId: string }> {
    return this.#request('POST', '/companions', input, true);
  }

  /** 게시글 상태·인원 갱신 (게시자 서명) — 모집 마감·인원 증감. 자기 글만. */
  updateCompanion(
    postId: string,
    update: CompanionUpdateInput,
  ): Promise<{ updated: boolean; postId: string; status: CompanionStatus; partySizeCurrent: number; partySizeTarget: number }> {
    return this.#request('PUT', `/companions/${encodeURIComponent(postId)}`, update, true);
  }

  /** 게시글 삭제 (게시자 서명) — 자기 글만. */
  removeCompanion(postId: string): Promise<{ removed: boolean; postId: string }> {
    return this.#request('DELETE', `/companions/${encodeURIComponent(postId)}`, null, true);
  }

  /** 동행 게시판 열람 (비서명) — 지역·코스·상태·게시자 필터. 게시자 닉네임 + 연락 핸들. */
  async getCompanions(filter: CompanionFilter = {}): Promise<CompanionListing[]> {
    const params = new URLSearchParams();
    if (filter.region) params.set('region', filter.region);
    if (filter.course) params.set('course', filter.course);
    if (filter.status) params.set('status', filter.status);
    if (filter.author) params.set('author', filter.author);
    const qs = params.toString();
    const res = await this.#request<{ companions: CompanionListing[] }>(
      'GET',
      qs ? `/companions?${qs}` : '/companions',
      null,
      false,
    );
    return res.companions;
  }

  // ── 코인 마켓 (지시서 0-8, 5장 4절 — 마켓은 온라인 전용 서버 기능) ──

  /** 무정가 리스팅 등록 — 수량만 올린다. 등록 엔젤만 가능(403). */
  createListing(amountDshv: number): Promise<{ listingId: number }> {
    return this.#request('POST', '/market/listings', { amountDshv }, true);
  }

  /** 공개 리스팅 목록 — 가격 필드가 없다. 구매자가 제시한다. */
  async getListings(): Promise<MarketListing[]> {
    const res = await this.#request<{ listings: MarketListing[] }>('GET', '/market/listings', null, false);
    return res.listings;
  }

  /** 가격 제시 (구매자) — 총액을 USDC micro(1e-6) 정수로. */
  createOffer(listingId: number, totalUsdcMicro: number): Promise<{ offerId: number }> {
    return this.#request('POST', `/market/listings/${listingId}/offers`, { totalUsdcMicro }, true);
  }

  /** 내 리스팅의 가격 제시 목록 (판매자 전용). */
  async getListingOffers(listingId: number): Promise<ListingOffer[]> {
    const res = await this.#request<{ offers: ListingOffer[] }>(
      'GET',
      `/market/listings/${listingId}/offers`,
      null,
      true,
    );
    return res.offers;
  }

  /** 내가 제시한 가격 목록 (구매자 전용) — 에스크로 상태 포함. */
  async getMyOffers(): Promise<MyOffer[]> {
    const res = await this.#request<{ offers: MyOffer[] }>('GET', '/market/my-offers', null, true);
    return res.offers;
  }

  /** 가격 제시 승인 (판매자) → 에스크로 시작. usdcAddress는 방출 수취 주소(선택). */
  approveOffer(offerId: number, usdcAddress?: string): Promise<ApproveOfferResult> {
    return this.#request('POST', `/market/offers/${offerId}/approve`, usdcAddress ? { usdcAddress } : {}, true);
  }

  /** 에스크로 상태 조회 (당사자 전용). */
  getEscrow(escrowId: number): Promise<EscrowState> {
    return this.#request('GET', `/market/escrows/${escrowId}`, null, true);
  }

  /** 개발 모드 전용 — 구매자 USDC 입금 시뮬레이션 (실체인은 결정 대기 1번 확정 후). */
  devDepositEscrow(escrowId: number): Promise<{ status: 'DEPOSITED' }> {
    return this.#request('POST', `/market/escrows/${escrowId}/dev-deposit`, null, false);
  }

  /** 코인 이전 서명 제출 (판매자) — 구매자 앞 미완결 이전(createTransfer) 코인들. */
  submitEscrowCoins(escrowId: number, coins: Coin[]): Promise<{ status: 'COINS_SUBMITTED' }> {
    return this.#request('POST', `/market/escrows/${escrowId}/coins`, { coins }, true);
  }

  /** 수령 확인 제출 (구매자) — acknowledgeTransfer로 완결한 코인들 → USDC 방출. */
  ackEscrow(escrowId: number, coins: Coin[]): Promise<AckEscrowResult> {
    return this.#request('POST', `/market/escrows/${escrowId}/ack`, { coins }, true);
  }
}
