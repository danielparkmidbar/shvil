'use client';

/**
 * 투명성 페이지 (지시서 5장 5절 — 커뮤니티 모니터 대시보드).
 *
 * 공시 원천: GET /transparency/promo (프로모션 발행 — 사이트 발행분은 전부 공시),
 * GET /transparency/market (마켓 체결·수수료 누계).
 * 민팅 통계는 기기 동기화 데이터 기반 추정치임을 명시한다 — 서버는 거래를
 * 승인하지도 기록하지도 않는다. 생성 vs 구매 코인 구분 통계·지역별 생성량·
 * 리저브 공시는 집계 준비 중 플레이스홀더 (서버 집계는 후속).
 */
import { useEffect, useState } from 'react';
import {
  fetchMarketTransparency,
  fetchPromoTransparency,
  fmtBps,
  fmtShv,
  fmtUsdcMicro,
  type MarketTransparency,
  type PromoTransparency,
} from '@/lib/api';
import { useI18n } from '@/i18n';

export default function TransparencyPage() {
  const { t } = useI18n();
  const [promo, setPromo] = useState<PromoTransparency | null>(null);
  const [market, setMarket] = useState<MarketTransparency | null>(null);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, m] = await Promise.all([
          fetchPromoTransparency(),
          fetchMarketTransparency(),
        ]);
        if (!cancelled) {
          setPromo(p);
          setMarket(m);
          setServerDown(false);
        }
      } catch {
        if (!cancelled) setServerDown(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const s = t.transparency;
  return (
    <>
      <h1>{s.title}</h1>
      <p className="muted">{s.intro}</p>
      <div className="notice">{s.estimateNote}</div>

      {serverDown && <div className="notice-warn">{t.common.serverUnreachable}</div>}

      <h2>{s.promoTitle}</h2>
      {promo ? (
        <ul className="stat-list">
          <li>{s.promoRegistration(promo.registrationIssued, promo.registrationQuota)}</li>
          <li>{s.promoFirstHosting(promo.firstHostingIssued)}</li>
        </ul>
      ) : (
        !serverDown && <p className="muted">{t.common.loading}</p>
      )}
      <p className="muted">{s.promoRule}</p>

      <h2>{s.marketTitle}</h2>
      {market ? (
        <>
          <ul className="stat-list">
            <li>{s.marketOpen(market.openListings)}</li>
            <li>{s.marketSettled(market.settledListings, fmtShv(market.settledDshv))}</li>
            <li>
              {s.marketFees(fmtUsdcMicro(market.collectedFeesUsdcMicro), fmtBps(market.feeBps))}
            </li>
          </ul>
          <p className="muted">{s.marketNote}</p>
        </>
      ) : (
        !serverDown && <p className="muted">{t.common.loading}</p>
      )}

      <h2>{s.mintStatsTitle}</h2>
      <div className="placeholder">{s.mintStatsPlaceholder}</div>

      <h2>{s.regionalTitle}</h2>
      <div className="placeholder">{s.regionalPlaceholder}</div>

      <h2>{s.reserveTitle}</h2>
      <div className="placeholder">{s.reservePlaceholder}</div>
    </>
  );
}
