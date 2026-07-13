'use client';

/**
 * 코인 마켓 (지시서 5장 4절 · 0-8): 무정가 리스팅 표시 전용.
 *
 * 가격 열이 없다는 것 자체가 UI의 핵심이다 — 엔젤은 수량만 올리고,
 * 가격은 구매자가 제시하며, 승인·에스크로는 지갑 앱에서 이루어진다.
 * 이 페이지는 공개 API(GET /market/listings)만 소비한다.
 */
import { useEffect, useState } from 'react';
import { fetchListings, fmtShv, type MarketListing } from '@/lib/api';
import { t } from '@/i18n';

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function MarketPage() {
  const [listings, setListings] = useState<MarketListing[] | null>(null);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchListings();
        if (!cancelled) {
          setListings(rows);
          setServerDown(false);
        }
      } catch {
        if (!cancelled) {
          setListings([]);
          setServerDown(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const s = t.market;
  return (
    <>
      <h1>{s.title}</h1>
      <p className="muted">{s.intro}</p>

      <div className="notice">
        <strong>{s.noPriceBanner}</strong> {s.noPriceDetail}
      </div>

      {serverDown && <div className="notice-warn">{t.common.serverUnreachable}</div>}

      {listings === null ? (
        <p className="muted">{t.common.loading}</p>
      ) : listings.length === 0 ? (
        !serverDown && <p className="muted">{s.empty}</p>
      ) : (
        <table className="listing-table">
          <thead>
            <tr>
              <th>{s.colSeller}</th>
              <th>{s.colAmount}</th>
              <th>{s.colListedAt}</th>
              {/* 가격 열의 부재를 드러낸다 — 무정가 리스팅 */}
              <th>{s.colPrice}</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.listingId}>
                <td>{l.sellerName ?? l.sellerMemberId}</td>
                <td>{fmtShv(l.amountDshv)}</td>
                <td>{fmtDate(l.createdAt)}</td>
                <td className="price-absent">{s.priceCell}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="card">
        <p>{s.appFlowNote}</p>
        <p>{s.feeNote}</p>
        <p>
          <strong>{s.faceToFaceFree}</strong>
        </p>
      </div>
    </>
  );
}
