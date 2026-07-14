'use client';

/**
 * 세계 확장 비전 + "곧 열릴 트레일" 목록.
 *
 * 쉬빌은 이스라엘 국립 트레일에서 먼저 시작하지만 처음부터 전 세계(TARGET_COUNTRY_COUNT
 * 개국) 트레일로 확장하는 것을 전제로 한다. COMING_SOON 지역을 확장 예정 트레일로 보여준다.
 */
import { TARGET_COUNTRY_COUNT, WORLD_TRAILS } from '@shvil/shared/src/regions';
import { useI18n } from '@/i18n';
import { countryFlag } from '@/region/RegionProvider';

export default function ExpansionTrails() {
  const { t } = useI18n();
  const r = t.region;
  const comingSoon = WORLD_TRAILS.filter((x) => x.status === 'COMING_SOON');
  return (
    <section>
      <h2>{r.expandTitle}</h2>
      <p className="hero-vision">{r.expandVision(TARGET_COUNTRY_COUNT)}</p>
      <p className="muted">{r.expandIntro}</p>
      <ul className="expand-trails">
        {comingSoon.map((x) => (
          <li key={x.regionId} className="expand-trail">
            <span aria-hidden="true">{countryFlag(x.countryCode)}</span>{' '}
            <span className="expand-trail-name">{x.trailName}</span>{' '}
            <span className="muted">{r.countries[x.countryCode] ?? x.countryCode}</span>
            <span className="region-badge region-badge-soon">{r.comingSoonBadge}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
