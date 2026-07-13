'use client';

/**
 * 클레임 게시판 (지시서 2.5 + 6장 5절) — 열람 전용.
 *
 * - 목록 (GET /claims?status=): 코스·거리·날짜·사진 참조·투표 현황 N/5·상태.
 * - 제출·인정 투표는 지갑 앱에서 (본인 확인 사용자만) — 이 사이트에는 쓰기 없음.
 * - 24시간 규칙·월 2회 한도 표기, 발행 총량 공시 (GET /transparency/community).
 */
import { useEffect, useState } from 'react';
import {
  fetchClaims,
  fetchCommunityTransparency,
  fmtDate,
  fmtKmNumber,
  fmtShv,
  type ClaimEntry,
  type CommunityTransparency,
} from '@/lib/api';
import { useI18n } from '@/i18n';

type StatusFilter = 'ALL' | 'OPEN' | 'APPROVED';

const FILTERS: readonly StatusFilter[] = ['ALL', 'OPEN', 'APPROVED'];

export default function ClaimsPage() {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [claims, setClaims] = useState<ClaimEntry[] | null>(null);
  const [transparency, setTransparency] = useState<CommunityTransparency | null>(null);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchClaims(filter === 'ALL' ? undefined : filter);
        if (!cancelled) {
          setClaims(rows);
          setServerDown(false);
        }
      } catch {
        if (!cancelled) {
          setClaims([]);
          setServerDown(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    fetchCommunityTransparency()
      .then((c) => {
        if (!cancelled) setTransparency(c);
      })
      .catch(() => {
        /* 공시 카드만 생략 — 목록 오류는 위에서 처리 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const s = t.claims;
  const filterLabel: Record<StatusFilter, string> = {
    ALL: s.filterAll,
    OPEN: s.filterOpen,
    APPROVED: s.filterApproved,
  };

  return (
    <>
      <h1>{s.title}</h1>
      <p className="muted">{s.intro}</p>

      <div className="notice">{s.readOnlyNote}</div>
      {serverDown && <div className="notice-warn">{t.common.serverUnreachable}</div>}

      <div className="filter-row" role="group" aria-label={s.colStatus}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="filter-chip"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {filterLabel[f]}
          </button>
        ))}
      </div>

      {claims === null ? (
        <p className="muted">{t.common.loading}</p>
      ) : claims.length === 0 ? (
        !serverDown && <p className="muted">{s.empty}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{s.colCourse}</th>
              <th>{s.colDistance}</th>
              <th>{s.colDate}</th>
              <th>{s.colPhotos}</th>
              <th>{s.colVotes}</th>
              <th>{s.colStatus}</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.claimId}>
                <td>{c.courseId}</td>
                <td>{t.leaderboard.distanceValue(fmtKmNumber(c.distanceM))}</td>
                <td>{fmtDate(c.walkedAt, locale)}</td>
                <td>{s.photosValue(c.photos.length)}</td>
                <td>{s.votesValue(c.votes, c.voteThreshold)}</td>
                <td>
                  <span className={c.status === 'APPROVED' ? 'badge badge-strong' : 'badge'}>
                    {s.statusLabel(c.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>{s.rulesTitle}</h2>
      <ul className="stat-list">
        <li>{s.rule24h}</li>
        <li>{s.ruleMonthly}</li>
        <li>{s.ruleVoters}</li>
      </ul>

      <h2>{s.issuanceTitle}</h2>
      {transparency ? (
        <ul className="stat-list">
          <li>
            {s.issuanceApproved(
              transparency.claims.approved,
              fmtShv(transparency.claims.issuedDshv),
            )}
          </li>
          <li>{s.issuanceOpen(transparency.claims.open)}</li>
        </ul>
      ) : (
        <p className="muted">{serverDown ? t.common.serverUnreachable : t.common.loading}</p>
      )}
    </>
  );
}
