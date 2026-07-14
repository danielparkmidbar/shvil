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
//
// 규칙: 응답 타입에 화면용 자연어(설명 문장·안내 문구) 필드를 두지 않는다.
// 서버는 숫자·코드·ID만 반환하고, 다국어는 전적으로 이 웹의 책임이다
// (i18n 사전 en/he/ko/es). 서버가 문장을 보내면 어떤 로케일에서도 번역할 수 없다.
// 사용자 자유 텍스트(코스명·표시명 등)는 예외 — 번역 대상이 아닌 원문 데이터다.

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
}

// 소명 대기 목록(GET /limits/flagged)은 지갑 배포용이다 — 이 사이트는 회원 번호를
// 표시하지 않고 익명 카운트(transparency.flaggedPending)만 쓴다. 소명 절차 안내 문구는
// 사전(leaderboard.flaggedNote)에 4개 언어로 있다. 그래서 여기에 계약 타입을 두지 않는다.

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
