'use client';

/**
 * 검증 트레커 탑 100 (지시서 6장 7절) — 명예의 전당이자 살아 있는 보안 장치.
 *
 * - GET /leaderboard?region= : 순위·이름·누적 거리·생성 총량 (위치 없음 명시),
 *   검증 배지 표시.
 * - GET /limits/baseline : 인간 한계 기준선 카드 —
 *   "이 기준선을 추월하는 생성자는 자동 포착됩니다".
 * - 소명 대기 현황: 익명 카운트만 (GET /transparency/community의 flaggedPending).
 *   회원 번호 목록(GET /limits/flagged)은 지갑 배포용이라 여기 표시하지 않는다.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  fetchBaseline,
  fetchCommunityTransparency,
  fetchLeaderboard,
  fmtKmNumber,
  fmtShv,
  type BaselineInfo,
  type CommunityTransparency,
  type LeaderboardEntry,
} from '@/lib/api';
import { useI18n } from '@/i18n';

export default function LeaderboardPage() {
  const { t } = useI18n();
  const [region, setRegion] = useState<string>('');
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [allRegions, setAllRegions] = useState<string[]>([]);
  const [baseline, setBaseline] = useState<BaselineInfo | null>(null);
  const [transparency, setTransparency] = useState<CommunityTransparency | null>(null);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchLeaderboard(region || undefined);
        if (cancelled) return;
        setRows(list);
        setServerDown(false);
        if (!region) {
          setAllRegions((prev) =>
            [...new Set([...prev, ...list.map((r) => r.region)])].sort(),
          );
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setServerDown(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [region]);

  useEffect(() => {
    let cancelled = false;
    fetchBaseline()
      .then((b) => {
        if (cancelled) return;
        setBaseline(b);
        // 기준선의 지역도 선택지에 합류.
        setAllRegions((prev) =>
          [...new Set([...prev, ...b.regions.map((r) => r.region)])].sort(),
        );
      })
      .catch(() => {
        /* 기준선 카드만 생략 */
      });
    fetchCommunityTransparency()
      .then((c) => {
        if (!cancelled) setTransparency(c);
      })
      .catch(() => {
        /* 소명 카드만 생략 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const s = t.leaderboard;
  const regionOptions = useMemo(() => allRegions, [allRegions]);

  return (
    <>
      <h1>{s.title}</h1>
      <p className="muted">{s.intro}</p>
      <div className="notice">{s.noLocationNote}</div>
      {serverDown && <div className="notice-warn">{t.common.serverUnreachable}</div>}

      <div className="filter-row">
        <label>
          {s.regionLabel}{' '}
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">{s.regionAll}</option>
            {regionOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows === null ? (
        <p className="muted">{t.common.loading}</p>
      ) : rows.length === 0 ? (
        !serverDown && <p className="muted">{s.empty}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{s.colRank}</th>
              <th>{s.colName}</th>
              <th>{s.colRegion}</th>
              <th>{s.colDistance}</th>
              <th>{s.colMinted}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId}>
                <td>{r.rank}</td>
                <td>
                  {r.displayName}{' '}
                  {r.verified && <span className="badge badge-strong">{s.verifiedBadge}</span>}
                </td>
                <td>{r.region}</td>
                <td>{s.distanceValue(fmtKmNumber(r.totalDistanceM))}</td>
                <td>{fmtShv(r.totalMintedDshv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>{s.baselineTitle}</h2>
      {baseline ? (
        <div className="card">
          <ul className="stat-list">
            <li>{s.baselineDaily(fmtShv(baseline.dailyMaxDshv))}</li>
            <li>{s.baselineWeekly(fmtShv(baseline.weeklyMaxDshv))}</li>
            {baseline.regions.map((r) => (
              <li key={r.region}>
                {s.baselineRegionRow(r.region, fmtShv(r.topTotalMintedDshv), r.verifiedMembers)}
              </li>
            ))}
          </ul>
          <p>
            <strong>{s.baselineCatch}</strong>
          </p>
        </div>
      ) : (
        <p className="muted">{serverDown ? t.common.serverUnreachable : t.common.loading}</p>
      )}

      <h2>{s.flaggedTitle}</h2>
      {transparency ? (
        <div className="card">
          <p>{s.flaggedCount(transparency.flaggedPending)}</p>
          <p className="muted">{s.flaggedNote}</p>
        </div>
      ) : (
        <p className="muted">{serverDown ? t.common.serverUnreachable : t.common.loading}</p>
      )}
    </>
  );
}
