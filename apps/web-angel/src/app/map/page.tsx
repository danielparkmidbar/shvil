'use client';

/**
 * 이웃 엔젤 (M5 축소·개편): 엔젤 관점의 "함께 환대하는 이웃들" 지도.
 * 순례자용 탐색·신청은 shvilist.org로 이관됐다 — 한 줄 안내만 남긴다.
 * 웹은 여행 준비 도구다 ("여행 전엔 노트북") — 지도는 와이드 레이아웃으로.
 */
import { useI18n } from '@/i18n';
import CurrentRegionBanner from '@/components/CurrentRegionBanner';
import AngelMap from './AngelMap';

export default function MapPage() {
  const { t } = useI18n();
  return (
    <div className="page-wide">
      <h1>{t.map.title}</h1>
      <p className="muted">{t.map.intro}</p>
      <p className="muted">
        {t.map.pilgrimNotice}{' '}
        <a href={t.common.footer.shvilistUrl}>shvilist.org</a>
      </p>
      <CurrentRegionBanner />
      <AngelMap />
    </div>
  );
}
