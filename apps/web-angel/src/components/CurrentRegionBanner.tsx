'use client';

/**
 * "현재 지역: {트레일명}" 배너 — 엔젤 지도 등 지역별 데이터 상단에 둔다.
 *
 * 지금은 선택 상태를 표시만 한다. 서버 공개 API(/angels·/courses 등)가 아직
 * region 파라미터를 받지 않기 때문이다.
 * TODO: 서버 region 필터 연동 — API가 region 쿼리를 지원하면 useRegion().regionId를 전달.
 */
import { useI18n } from '@/i18n';
import { countryFlag, useRegion } from '@/region/RegionProvider';

export default function CurrentRegionBanner() {
  const { t } = useI18n();
  const { region } = useRegion();
  return (
    <div className="region-banner">
      <span aria-hidden="true">{countryFlag(region.countryCode)}</span>{' '}
      {t.region.current(region.trailName)}
    </div>
  );
}
