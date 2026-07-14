/**
 * 디렉토리 API 클라이언트 테스트 — 순수 TS 부분 (서명 헤더 구성·URL·오류 처리).
 * 서버 없이 fetch 스텁으로 검증한다. 거래 승인 API가 없음도 계약의 일부다.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTH_HEADER_MEMBER,
  AUTH_HEADER_SIG,
  AUTH_HEADER_TS,
  generateKeyPair,
  signerFromKeyPair,
  verifyAuthHeaders,
} from '@shvil/shared';
import { ApiError, DEFAULT_SERVER_URL, DirectoryApi, buildSignedRequest, type AngelProfileInput } from '../api';

const kp = generateKeyPair();
const signer = signerFromKeyPair(kp);
const auth = { memberId: 'SHV-123456', signer };
const NOW = 1_760_000_000_000;

describe('buildSignedRequest', () => {
  it('쿼리스트링을 제외한 pathname만 서명하고, 서버 측 검증을 통과한다', () => {
    const parts = buildSignedRequest(DEFAULT_SERVER_URL, 'GET', '/messages?sinceId=42', null, auth, NOW);

    expect(parts.pathname).toBe('/messages'); // 쿼리 제외
    expect(parts.url).toBe('http://localhost:8787/messages?sinceId=42');
    expect(parts.bodyText).toBe(''); // GET은 빈 본문
    expect(parts.headers[AUTH_HEADER_MEMBER]).toBe('SHV-123456');
    expect(parts.headers[AUTH_HEADER_TS]).toBe(String(NOW));

    // 서버가 하는 검증 그대로 재현 — 동일 코드(@shvil/shared) 공유.
    expect(
      verifyAuthHeaders({
        memberId: parts.headers[AUTH_HEADER_MEMBER]!,
        timestampHeader: parts.headers[AUTH_HEADER_TS]!,
        signatureHeader: parts.headers[AUTH_HEADER_SIG]!,
        method: 'GET',
        path: '/messages',
        bodyText: '',
        devicePublicKey: kp.publicKeyHex,
        now: NOW + 1_000,
      }),
    ).toBe(true);
  });

  it('본문이 있는 서명 요청은 본문 해시까지 검증된다 (변조 시 실패)', () => {
    const body = { name: '다프나의 집', visible: true };
    const parts = buildSignedRequest(DEFAULT_SERVER_URL, 'PUT', '/angels/me', body, auth, NOW);

    expect(parts.bodyText).toBe(JSON.stringify(body));
    expect(parts.headers['content-type']).toBe('application/json');

    const verify = (bodyText: string) =>
      verifyAuthHeaders({
        memberId: 'SHV-123456',
        timestampHeader: parts.headers[AUTH_HEADER_TS]!,
        signatureHeader: parts.headers[AUTH_HEADER_SIG]!,
        method: 'PUT',
        path: '/angels/me',
        bodyText,
        devicePublicKey: kp.publicKeyHex,
        now: NOW,
      });
    expect(verify(parts.bodyText)).toBe(true);
    expect(verify(parts.bodyText.replace('다프나', '위조자'))).toBe(false); // 본문 변조 탐지
  });

  it('비서명 요청에는 인증 헤더가 붙지 않는다', () => {
    const parts = buildSignedRequest(DEFAULT_SERVER_URL, 'GET', '/courses', null, null, NOW);
    expect(parts.headers[AUTH_HEADER_MEMBER]).toBeUndefined();
    expect(parts.headers[AUTH_HEADER_SIG]).toBeUndefined();
  });

  it('baseUrl 끝 슬래시를 정규화한다', () => {
    const parts = buildSignedRequest('http://192.168.0.5:8787/', 'GET', '/courses', null, null, NOW);
    expect(parts.url).toBe('http://192.168.0.5:8787/courses');
  });
});

function fakeFetch(expected: {
  url?: (url: string) => void;
  headers?: (h: Record<string, string>) => void;
  status?: number;
  responseBody?: unknown;
}): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    expected.url?.(String(url));
    expected.headers?.((init?.headers ?? {}) as Record<string, string>);
    const status = expected.status ?? 200;
    return new Response(JSON.stringify(expected.responseBody ?? {}), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('DirectoryApi', () => {
  const makeApi = (fetchFn: typeof fetch) =>
    new DirectoryApi({
      getBaseUrl: async () => DEFAULT_SERVER_URL,
      getAuth: () => auth,
      fetchFn,
      now: () => NOW,
    });

  it('GET /angels — 좌표·반경 쿼리 구성과 응답 언랩', async () => {
    let seenUrl = '';
    const api = makeApi(
      fakeFetch({
        url: (u) => (seenUrl = u),
        responseBody: { angels: [{ memberId: 'SHV-000001', name: '다프나의 집' }] },
      }),
    );
    const angels = await api.getAngels(33.2, 35.6, 50);
    expect(seenUrl).toBe('http://localhost:8787/angels?lat=33.2&lon=35.6&radiusKm=50');
    expect(angels).toHaveLength(1);
    expect(angels[0]!.memberId).toBe('SHV-000001');
  });

  it('PUT /angels/me — 서명 인증 헤더 3개가 붙는다', async () => {
    let seenHeaders: Record<string, string> = {};
    const api = makeApi(fakeFetch({ headers: (h) => (seenHeaders = h), responseBody: { profile: {} } }));
    const profile: AngelProfileInput = {
      name: '다프나의 집',
      location: { lat: 33.229, lon: 35.655 },
      services: { bed: 'ROOM', internet: true, shower: true, meal: false },
      capacity: 2,
      conditions: '',
      visible: true,
    };
    await api.putMyAngelProfile(profile);
    expect(seenHeaders[AUTH_HEADER_MEMBER]).toBe('SHV-123456');
    expect(seenHeaders[AUTH_HEADER_TS]).toBe(String(NOW));
    expect(seenHeaders[AUTH_HEADER_SIG]).toBeTruthy();
  });

  it('오류 응답은 상태 코드와 서버 메시지를 담은 ApiError로 던진다 (첫 접대 중복 409)', async () => {
    const api = makeApi(fakeFetch({ status: 409, responseBody: { error: '이미 수령한 보너스입니다' } }));
    await expect(api.claimFirstHosting({} as never)).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      message: '이미 수령한 보너스입니다',
    });
  });

  it('네트워크 실패는 status 0의 ApiError — 호출부가 오프라인 폴백 처리', async () => {
    const api = makeApi((async () => {
      throw new Error('network down');
    }) as typeof fetch);
    const err = await api.getCourses().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });

  // ── 마켓 (M3) — 기존 서명 인증 패턴 재사용·경로·응답 언랩 계약 ──

  it('POST /market/listings — 무정가 리스팅은 수량만 서명 제출한다', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const api = makeApi(
      fakeFetch({ url: (u) => (seenUrl = u), headers: (h) => (seenHeaders = h), responseBody: { listingId: 7 } }),
    );
    const res = await api.createListing(125);
    expect(seenUrl).toBe('http://localhost:8787/market/listings');
    expect(seenHeaders[AUTH_HEADER_MEMBER]).toBe('SHV-123456');
    expect(seenHeaders[AUTH_HEADER_SIG]).toBeTruthy();
    expect(res.listingId).toBe(7);
  });

  it('GET /market/listings는 공개(비서명), 에스크로 조회는 당사자 서명 — 응답 언랩', async () => {
    let seenHeaders: Record<string, string> = {};
    const publicApi = makeApi(
      fakeFetch({
        headers: (h) => (seenHeaders = h),
        responseBody: { listings: [{ listingId: 1, sellerMemberId: 'SHV-000001', amountDshv: 50 }] },
      }),
    );
    const listings = await publicApi.getListings();
    expect(seenHeaders[AUTH_HEADER_MEMBER]).toBeUndefined(); // 공개 조회 — 무정가
    expect(listings[0]!.amountDshv).toBe(50);

    let escrowUrl = '';
    const signedApi = makeApi(
      fakeFetch({
        url: (u) => (escrowUrl = u),
        headers: (h) => (seenHeaders = h),
        responseBody: { escrowId: 3, status: 'COINS_SUBMITTED', coins: [] },
      }),
    );
    const escrow = await signedApi.getEscrow(3);
    expect(escrowUrl).toBe('http://localhost:8787/market/escrows/3');
    expect(seenHeaders[AUTH_HEADER_MEMBER]).toBe('SHV-123456'); // 당사자 전용 — 서명 인증
    expect(escrow.status).toBe('COINS_SUBMITTED');
  });

  // ── 커뮤니티 (M4) — 신뢰 키·소명 목록은 공개 조회, 클레임 접수는 서명 제출 ──

  it('GET /keys·/limits/flagged는 비서명 공개, POST /claims는 서명 제출 — 응답 언랩', async () => {
    let seenHeaders: Record<string, string> = {};
    const publicApi = makeApi(
      fakeFetch({
        headers: (h) => (seenHeaders = h),
        responseBody: { keys: [{ keyId: 'claim-2026', publicKey: 'aa', purpose: 'COMMUNITY_CLAIM' }] },
      }),
    );
    // 배포 응답은 원본( _sig 포함 가능) 그대로 — 검증·언랩은 directory.ts (H-3)
    const keysRes = await publicApi.getTrustedKeys();
    expect(seenHeaders[AUTH_HEADER_MEMBER]).toBeUndefined(); // 공개 — 지갑들이 캐시한다
    expect(keysRes.keys[0]!.purpose).toBe('COMMUNITY_CLAIM');

    const flaggedApi = makeApi(
      fakeFetch({
        headers: (h) => (seenHeaders = h),
        responseBody: {
          members: [{ memberId: 'SHV-000009', reasonCode: 'MANUAL', params: {}, flaggedAt: 1 }],
        },
      }),
    );
    const flaggedRes = await flaggedApi.getFlaggedMembers();
    expect(seenHeaders[AUTH_HEADER_MEMBER]).toBeUndefined(); // 공개 배포 — 수령 보류용
    expect(flaggedRes.members[0]!.memberId).toBe('SHV-000009');

    let claimUrl = '';
    const signedApi = makeApi(
      fakeFetch({
        url: (u) => (claimUrl = u),
        headers: (h) => (seenHeaders = h),
        responseBody: { claimId: 11, status: 'OPEN' },
      }),
    );
    const res = await signedApi.submitClaim({
      courseId: 'shvil-israel-north',
      walkedAt: NOW - 3_600_000,
      distanceM: 12_500, // 좌표 없음 — 코스 ID·거리·시각뿐 (위치 비저장 원칙)
      photos: ['sha256:abc'],
    });
    expect(claimUrl).toBe('http://localhost:8787/claims');
    expect(seenHeaders[AUTH_HEADER_MEMBER]).toBe('SHV-123456'); // 서명 인증
    expect(seenHeaders[AUTH_HEADER_SIG]).toBeTruthy();
    expect(res.claimId).toBe(11);
  });
});
