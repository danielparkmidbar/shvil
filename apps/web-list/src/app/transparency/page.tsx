'use client';

/**
 * 투명성 페이지 (M5 — 서비스 재조정 §2-2: 공통 공시를 양쪽 사이트에 배치).
 *
 * 공시 원천: GET /transparency/promo (사이트 발행분 — 전용 발행 키 서명·총량 공시),
 * GET /transparency/market (마켓 체결·수수료 누계).
 * 민팅 통계는 기기 동기화 데이터 기반 추정치임을 명시한다 — 서버는 거래를
 * 승인하지도 기록하지도 않는다. 생성 vs 구매 코인 구분 통계·지역별 생성량·
 * 리저브 공시는 집계 준비 중 플레이스홀더 (서버 집계는 후속).
 *
 * 서버 응답의 자연어 필드는 렌더하지 않는다 — 문구는 전부 i18n 사전(4개 언어).
 * 레이아웃은 데스크톱 기준 정보 밀도 (와이드 그리드 — 재조정 설계 0-1절).
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
    <div className="breakout-wide">
      <h1>{s.title}</h1>
      <p className="muted page-intro">{s.intro}</p>
      <div className="notice">{s.estimateNote}</div>

      {serverDown && <div className="notice-warn">{t.common.serverUnreachable}</div>}

      <div className="transparency-grid">
        <section className="card">
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
        </section>

        <section className="card">
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
        </section>

        <section className="card">
          <h2>{s.mintStatsTitle}</h2>
          <div className="placeholder">{s.mintStatsPlaceholder}</div>
        </section>

        <section className="card">
          <h2>{s.regionalTitle}</h2>
          <div className="placeholder">{s.regionalPlaceholder}</div>
        </section>

        <section className="card">
          <h2>{s.reserveTitle}</h2>
          <div className="placeholder">{s.reservePlaceholder}</div>
        </section>
      </div>
    </div>
  );
}
