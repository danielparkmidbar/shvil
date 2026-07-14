'use client';

/**
 * 엔젤 찾기 페이지 (M5 — 서비스 재조정 §2-2).
 *
 * 순례자가 엔젤을 찾는 흐름은 걷는 사람의 사이트(shvilist.org)의 것이다.
 * 인트로는 "선의가 기반, 코인은 수단"의 정신을 담는다 (재조정 설계 0장).
 * 데스크톱 우선 와이드 레이아웃 — 여행 준비는 노트북 큰 화면에서 (0-1절).
 */
import { useI18n } from '@/i18n';
import CurrentRegionBanner from '@/components/CurrentRegionBanner';
import AngelFinder from './AngelFinder';

export default function AngelsPage() {
  const { t } = useI18n();
  return (
    <div className="breakout-wide">
      <h1>{t.angels.title}</h1>
      <p className="muted page-intro">{t.angels.intro}</p>
      <CurrentRegionBanner />
      <AngelFinder />
    </div>
  );
}
