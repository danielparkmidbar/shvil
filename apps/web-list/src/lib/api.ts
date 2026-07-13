/**
 * 디렉토리 서버 공개 API 클라이언트 (지시서 6장 — shvilist.org).
 *
 * 이 웹은 공개(비서명) GET API만 소비한다:
 *   /courses · /courses/proposals · /claims?status= · /certificates?courseId= ·
 *   /leaderboard?region= · /limits/baseline · /limits/flagged · /transparency/community.
 * 서버에는 거래 승인 기능이 없고, 이 클라이언트에도 지불·수령·제출 호출이 없다 —
 * 클레임 제출·인정 투표·완주 인증·리더보드 등재는 전부 지갑 앱(서명 인증)에서 한다.
 *
 * 모든 fetch는 클라이언트 컴포넌트에서만 호출한다 (프리렌더 중 서버 미가동이
 * 빌드를 깨지 않게). 실패 시 throw하고 호출부가 안내 문구로 처리한다.
 */

export const DIRECTORY_URL =
  process.env.NEXT_PUBLIC_DIRECTORY_URL ?? 'http://localhost:8787';

const REQUEST_TIMEOUT_MS = 8_000;

// ── 계약 타입 (server/src/app.ts · community.ts 응답 형태) ────────

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface CourseSegmentMeta {
  fromIdx: number;
  toIdx: number;
  terrain: string;
  corridorHalfWidthM?: number;
  /** 난이도 계수 ×10 정수 (10 = ×1.0 ~ 40 = ×4.0). */
  difficultyTenths: number;
}

export interface CourseData {
  courseId: string;
  name: string;
  polyline: GeoPoint[];
  segments: CourseSegmentMeta[];
  version: number;
}

export interface CourseProposal {
  courseId: string;
  name: string;
  status: 'CANDIDATE' | 'OFFICIAL' | string;
  completions: number;
  promotionThreshold: number;
  createdAt: number;
}

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

export interface CertificateEntry {
  certificateId: number;
  memberId: string;
  courseId: string;
  kind: 'FULL' | 'SECTION' | string;
  photos: string[];
  data: Record<string, unknown>;
  createdAt: number;
}

export interface LeaderboardEntry {
  rank: number;
  memberId: string;
  region: string;
  displayName: string;
  totalDistanceM: number;
  totalMintedDshv: number;
  verified: boolean;
}

export interface BaselineInfo {
  dailyMaxDshv: number;
  weeklyMaxDshv: number;
  regions: { region: string; topTotalMintedDshv: number; verifiedMembers: number }[];
  note: string;
}

/** 소명 대기 목록 — 지갑 배포용. 이 사이트는 익명 카운트만 표시한다. */
export interface FlaggedList {
  members: { memberId: string; reason: string; flaggedAt: number }[];
  note: string;
}

export interface CommunityTransparency {
  claims: { open: number; approved: number; issuedDshv: number };
  rewards: { issued: number; issuedDshv: number };
  courses: { official: number; candidates: number };
  flaggedPending: number;
}

// ── fetch 헬퍼 ───────────────────────────────────────────────────

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${DIRECTORY_URL}${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchCourses(): Promise<CourseData[]> {
  const { courses } = await getJson<{ courses: CourseData[] }>('/courses');
  return courses;
}

export async function fetchProposals(): Promise<CourseProposal[]> {
  const { proposals } = await getJson<{ proposals: CourseProposal[] }>('/courses/proposals');
  return proposals;
}

export async function fetchClaims(status?: string): Promise<ClaimEntry[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const { claims } = await getJson<{ claims: ClaimEntry[] }>(`/claims${qs}`);
  return claims;
}

export async function fetchCertificates(courseId?: string): Promise<CertificateEntry[]> {
  const qs = courseId ? `?courseId=${encodeURIComponent(courseId)}` : '';
  const { certificates } = await getJson<{ certificates: CertificateEntry[] }>(`/certificates${qs}`);
  return certificates;
}

export async function fetchLeaderboard(region?: string): Promise<LeaderboardEntry[]> {
  const qs = region ? `?region=${encodeURIComponent(region)}` : '';
  const { leaderboard } = await getJson<{ leaderboard: LeaderboardEntry[] }>(`/leaderboard${qs}`);
  return leaderboard;
}

export function fetchBaseline(): Promise<BaselineInfo> {
  return getJson<BaselineInfo>('/limits/baseline');
}

/** 익명 카운트 확인용 — 회원 번호는 화면에 표시하지 않는다 (지갑 배포 전용 정보). */
export function fetchFlagged(): Promise<FlaggedList> {
  return getJson<FlaggedList>('/limits/flagged');
}

export function fetchCommunityTransparency(): Promise<CommunityTransparency> {
  return getJson<CommunityTransparency>('/transparency/community');
}

// ── 표기 헬퍼 ────────────────────────────────────────────────────

/** 10 dSHV = 1 SHV. 123 dSHV → "12.3 SHV". */
export function fmtShv(amountDshv: number): string {
  return `${(amountDshv / 10).toFixed(1)} SHV`;
}

/** 미터 → "12.3" (km 숫자 문자열 — 단위 표기는 사전이 결정). */
export function fmtKmNumber(distanceM: number): string {
  return (distanceM / 1000).toFixed(1);
}

/** 로케일에 맞춘 날짜 표기. */
export function fmtDate(ts: number, locale: string): string {
  return new Date(ts).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** 코스 구간들의 난이도 계수 범위 — "1.0" 또는 "1.0–4.0". */
export function difficultyRange(segments: CourseSegmentMeta[]): string {
  if (segments.length === 0) return '1.0';
  let min = Infinity;
  let max = -Infinity;
  for (const s of segments) {
    if (s.difficultyTenths < min) min = s.difficultyTenths;
    if (s.difficultyTenths > max) max = s.difficultyTenths;
  }
  const lo = (min / 10).toFixed(1);
  const hi = (max / 10).toFixed(1);
  return lo === hi ? lo : `${lo}–${hi}`;
}
