'use client';

/**
 * 스팟 보물 페이지 (M12 — 사업자 참여 계층, 몸인증_보물마이닝_설계 4장).
 *
 * 트레일 근처 사업장이 숨긴 코인을 걷는 사람이 스캔해 선착순으로 받는다. 웹은 위치·
 * 잔여·1인당 양을 지도·목록으로 보여줘 "걸으며 갈지"를 정하게 한다 — 받기는 지갑 앱에서
 * 스캔·서명(R-7). 데스크톱 우선 와이드 레이아웃 — 여행 준비는 노트북 큰 화면에서(0-1절).
 */
import { useI18n } from '@/i18n';
import CurrentRegionBanner from '@/components/CurrentRegionBanner';
import SpotBoard from './SpotBoard';

export default function SpotsPage() {
  const { t } = useI18n();
  return (
    <div className="breakout-wide">
      <h1>{t.spots.title}</h1>
      <p className="muted page-intro">{t.spots.intro}</p>
      <CurrentRegionBanner />
      <SpotBoard />
    </div>
  );
}
