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
  type CourseData,
  type Coin,
  type GeoPoint,
  type MessageEnvelope,
  type SignedGrant,
  type Signer,
} from '@shvil/shared';

/** 기본 서버 URL — kv 오버라이드 가능 (실기기 테스트 시 LAN IP로 변경). */
export const DEFAULT_SERVER_URL = 'http://localhost:8787';

/** 네트워크 응답 대기 한도 (ms) — 광야 무통신에서 UI가 오래 멈추지 않게. */
const REQUEST_TIMEOUT_MS = 8_000;

// ── 계약 타입 ─────────────────────────────────────────────────────

export type BedService = 'ROOM' | 'SOFA' | 'TENT' | null;

export interface AngelServices {
  bed: BedService;
  internet: boolean;
  shower: boolean;
  meal: boolean;
}

/** 엔젤 프로필 등록 입력 — 위치는 본인이 자발 공개하는 엔젤 포인트다. */
export interface AngelProfileInput {
  name: string;
  location: GeoPoint;
  services: AngelServices;
  capacity: number;
  conditions: string;
  visible: boolean;
}

/** 디렉토리의 엔젤 항목 (GET /angels). */
export interface AngelDirectoryEntry extends AngelProfileInput {
  memberId: string;
  messagingPublicKey: string;
  devicePublicKey: string;
  distanceKm?: number;
}

export interface RegisterArgs {
  phone: string;
  code: string;
  email: string;
  displayName: string;
  devicePublicKey: string;
  messagingPublicKey: string;
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

export interface RelayedMessage {
  id: number;
  envelope: MessageEnvelope;
}

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

  register(args: RegisterArgs): Promise<{ memberId: string }> {
    return this.#request('POST', '/auth/register', args, false);
  }

  // ── 코스 데이터 배포 ──

  async getCourses(): Promise<CourseData[]> {
    const res = await this.#request<{ courses: CourseData[] }>('GET', '/courses', null, false);
    return res.courses;
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
