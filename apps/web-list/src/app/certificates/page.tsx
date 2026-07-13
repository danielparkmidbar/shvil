'use client';

/**
 * 완주 갤러리 (지시서 2.6 + 6장 6절) — 코스별 완주·구간 인증 목록.
 *
 * - GET /certificates?courseId= : 인증 카드 (종류·사진 수·날짜).
 * - 격려 코인 안내: 완주 10 / 구간 3 SHV (확정 대기 파라미터).
 * - 발행 현황 공시: GET /transparency/community의 rewards.
 * - 제출은 지갑 앱에서 — 이 사이트에는 쓰기 없음.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  fetchCertificates,
  fetchCommunityTransparency,
  fmtDate,
  fmtShv,
  type CertificateEntry,
  type CommunityTransparency,
} from '@/lib/api';
import { useI18n } from '@/i18n';

export default function CertificatesPage() {
  const { t, locale } = useI18n();
  const [courseFilter, setCourseFilter] = useState<string>('');
  const [certificates, setCertificates] = useState<CertificateEntry[] | null>(null);
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [transparency, setTransparency] = useState<CommunityTransparency | null>(null);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchCertificates(courseFilter || undefined);
        if (cancelled) return;
        setCertificates(rows);
        setServerDown(false);
        // 필터 옵션은 전체 목록에서 수집 (필터 미적용 응답일 때만 갱신).
        if (!courseFilter) {
          setCourseIds([...new Set(rows.map((r) => r.courseId))].sort());
        }
      } catch {
        if (!cancelled) {
          setCertificates([]);
          setServerDown(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseFilter]);

  useEffect(() => {
    let cancelled = false;
    fetchCommunityTransparency()
      .then((c) => {
        if (!cancelled) setTransparency(c);
      })
      .catch(() => {
        /* 공시 카드만 생략 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const s = t.certificates;
  const options = useMemo(() => courseIds, [courseIds]);

  return (
    <>
      <h1>{s.title}</h1>
      <p className="muted">{s.intro}</p>

      <div className="notice">{s.rewardNote}</div>
      <div className="notice">{s.submitInApp}</div>
      {serverDown && <div className="notice-warn">{t.common.serverUnreachable}</div>}

      <div className="filter-row">
        <label>
          {s.filterLabel}{' '}
          <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}>
            <option value="">{s.filterAll}</option>
            {options.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      </div>

      {certificates === null ? (
        <p className="muted">{t.common.loading}</p>
      ) : certificates.length === 0 ? (
        !serverDown && <p className="muted">{s.empty}</p>
      ) : (
        <div className="cert-grid">
          {certificates.map((c) => (
            <div className="cert-card" key={c.certificateId}>
              <h3>{c.courseId}</h3>
              <p className="cert-meta">
                <span className={c.kind === 'FULL' ? 'badge badge-strong' : 'badge'}>
                  {c.kind === 'FULL' ? s.kindFull : s.kindSection}
                </span>
              </p>
              <p className="cert-meta">{s.photosValue(c.photos.length)}</p>
              <p className="cert-meta">{fmtDate(c.createdAt, locale)}</p>
            </div>
          ))}
        </div>
      )}

      <h2>{s.issuanceTitle}</h2>
      {transparency ? (
        <ul className="stat-list">
          <li>
            {s.issuanceStats(
              transparency.rewards.issued,
              fmtShv(transparency.rewards.issuedDshv),
            )}
          </li>
        </ul>
      ) : (
        <p className="muted">{serverDown ? t.common.serverUnreachable : t.common.loading}</p>
      )}
    </>
  );
}
