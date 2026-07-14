'use client';

/**
 * 지역(트레일) 선택기 (헤더) — 세계 트레일 카탈로그(WORLD_TRAILS)를 나열한다.
 *
 * - LIVE 지역은 선택 가능하고, COMING_SOON 지역은 "준비 중" 배지로 비활성화된다.
 *   COMING_SOON을 누르면 "곧 열립니다" 안내만 표시하고 선택은 바뀌지 않는다.
 * - 선택 상태는 RegionProvider(localStorage 'shvil.region')가 관리한다.
 * - 트레일명은 카탈로그의 영문 고유명, 국가명은 로케일별 사전(없으면 코드)으로 표시한다.
 *   네이티브 <select>는 배지를 그릴 수 없어 접근성 있는 커스텀 드롭다운으로 구현한다.
 */
import { useEffect, useRef, useState } from 'react';
import { WORLD_TRAILS } from '@shvil/shared/src/regions';
import { useI18n } from '@/i18n';
import { countryFlag, useRegion } from '@/region/RegionProvider';

export default function RegionSelector() {
  const { t } = useI18n();
  const r = t.region;
  const { regionId, region, setRegion } = useRegion();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 바깥 클릭 / Esc 로 닫기.
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(id: string, isLive: boolean, name: string) {
    if (isLive) {
      setRegion(id);
      setNotice(null);
      setOpen(false);
    } else {
      // COMING_SOON — 선택하지 않고 안내만.
      setNotice(r.comingSoonNotice(name));
    }
  }

  return (
    <div className="region-select" ref={rootRef}>
      <button
        type="button"
        className="region-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={r.selectAria}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{countryFlag(region.countryCode)}</span>{' '}
        <span className="region-name">{region.trailName}</span>
        <span className="region-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="region-panel">
          <ul role="listbox" aria-label={r.selectAria}>
            {WORLD_TRAILS.map((tr) => {
              const isLive = tr.status === 'LIVE';
              const selected = tr.regionId === regionId;
              return (
                <li key={tr.regionId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={!isLive}
                    className={
                      'region-option' +
                      (selected ? ' is-selected' : '') +
                      (isLive ? '' : ' is-soon')
                    }
                    onClick={() => choose(tr.regionId, isLive, tr.trailName)}
                  >
                    <span aria-hidden="true">{countryFlag(tr.countryCode)}</span>{' '}
                    <span className="region-option-name">{tr.trailName}</span>{' '}
                    <span className="region-option-country">
                      {r.countries[tr.countryCode] ?? tr.countryCode}
                    </span>
                    {isLive ? (
                      <span className="region-badge region-badge-live">{r.liveBadge}</span>
                    ) : (
                      <span className="region-badge region-badge-soon">{r.comingSoonBadge}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {notice && (
            <p className="region-notice" role="status">
              {notice}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
