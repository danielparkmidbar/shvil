'use client';

/**
 * 동행 게시판 (M8 — 서비스 재조정 §4-6) — 열람 전용, 데스크톱 우선 와이드.
 *
 * 공개 GET /companions만 소비한다 (비서명). 지역·상태 필터 → 카드 그리드로
 * 게시자 닉네임·여정·팀 규모·이동 수단·한마디를 넓게 보여준다. "관심 보내기"는
 * 지갑 앱 딥링크(shvil://chat/{memberId})다 — 웹은 서명 주체가 아니므로 관심·연락을
 * 보낼 수 없다(R-7). 실제 팀 조율은 지갑의 종단간 암호화 메시지에서 이어진다.
 *
 * XSS 안전: 사용자 원문(displayName·note·courseId)은 JSX 텍스트 자식으로만 넣어
 * React 기본 이스케이프에 의존한다 — dangerouslySetInnerHTML은 이 경로에 없다.
 */
import { useEffect, useState } from 'react';
import { WORLD_TRAILS, regionById } from '@shvil/shared/src/regions';
import {
  chatDeepLink,
  fetchCompanions,
  type CompanionListing,
  type CompanionMode,
} from '@/lib/api';
import { useI18n } from '@/i18n';

const RECOMMENDED_MIN = 3;
const RECOMMENDED_MAX = 4;

function regionName(regionId: string): string {
  return regionById(regionId)?.trailName ?? regionId;
}

export default function CompanionBoard() {
  const { t } = useI18n();
  const [region, setRegion] = useState<string | null>(null); // null = 전체
  const [openOnly, setOpenOnly] = useState(true);
  const [items, setItems] = useState<CompanionListing[] | null>(null);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    (async () => {
      try {
        const rows = await fetchCompanions({
          ...(region ? { region } : {}),
          ...(openOnly ? { status: 'OPEN' as const } : {}),
        });
        if (!cancelled) {
          setItems(rows);
          setServerDown(false);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setServerDown(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [region, openOnly]);

  const s = t.companions;
  const modeLabel = (m: CompanionMode): string => (m === 'BIKE' ? s.modeBike : s.modeWalk);

  return (
    <>
      {serverDown && <div className="notice-warn">{t.common.serverUnreachable}</div>}
      <div className="notice">{s.teamNote}</div>

      <div className="filter-row" role="group" aria-label={s.filterTitle}>
        <strong>{s.filterTitle}:</strong>
        <button
          type="button"
          className="filter-chip"
          aria-pressed={region === null}
          onClick={() => setRegion(null)}
        >
          {s.filterAllRegions}
        </button>
        {WORLD_TRAILS.map((r) => (
          <button
            key={r.regionId}
            type="button"
            className="filter-chip"
            aria-pressed={region === r.regionId}
            onClick={() => setRegion(r.regionId)}
          >
            {r.trailName}
          </button>
        ))}
      </div>

      <div className="filter-row" role="group" aria-label={s.filterOpen}>
        <button type="button" className="filter-chip" aria-pressed={openOnly} onClick={() => setOpenOnly(true)}>
          {s.filterOpen}
        </button>
        <button type="button" className="filter-chip" aria-pressed={!openOnly} onClick={() => setOpenOnly(false)}>
          {s.filterAll}
        </button>
        <span className="muted">{items === null ? t.common.loading : s.count(items.length)}</span>
      </div>

      {items === null ? (
        <p className="muted">{t.common.loading}</p>
      ) : items.length === 0 ? (
        !serverDown && <p className="muted">{s.empty}</p>
      ) : (
        <div className="companion-grid">
          {items.map((c) => {
            const recommended = c.partySizeTarget >= RECOMMENDED_MIN && c.partySizeTarget <= RECOMMENDED_MAX;
            const closed = c.status === 'CLOSED';
            return (
              <article key={c.postId} className={closed ? 'companion-card is-closed' : 'companion-card'}>
                <div className="companion-head">
                  {/* displayName = 게시자가 공개를 선택한 닉네임 (실명 아님) */}
                  <h3 className="companion-who">{c.displayName}</h3>
                  <span className="companion-mode">{modeLabel(c.mode)}</span>
                </div>
                <p className="companion-journey">
                  {regionName(c.regionId)}
                  {c.courseId ? ` · ${c.courseId}` : ''}
                </p>
                <p className="companion-meta">{s.dateRange(c.fromDate, c.toDate)}</p>
                <p className="companion-meta">
                  <span className={recommended ? 'companion-party-rec' : undefined}>
                    {s.partyValue(c.partySizeCurrent, c.partySizeTarget)}
                  </span>{' '}
                  {recommended && <span className="badge">{s.recommendedBadge}</span>}
                  {closed && <span className="badge badge-warn">{s.closedBadge}</span>}
                </p>
                {c.note && <p className="companion-note">{c.note}</p>}
                <div className="companion-actions">
                  {/* 딥링크 href만 — 관심·연락은 지갑(서명 주체)에서 (R-7) */}
                  {!closed && (
                    <a className="btn" href={chatDeepLink(c.authorMemberId)}>
                      {s.contactCta}
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="muted">{s.contactNote}</p>
      <p className="muted">{s.postInApp}</p>
    </>
  );
}
