'use client';

/**
 * 기존 트레일 엔젤 명단 (INT 커뮤니티 공개 명단 — 참고용).
 *
 * ★쉬빌 회원이 아니다: 회원 번호·E2E 메시지·코인 수령이 없다 — 쉬빌 엔젤 지도와
 * 절대 섞지 않고 별도 페이지로 구분한다. 데이터는 @shvil/shared에 정적으로 박혀
 * 있어(출처·삭제 정책은 legacyAngels.ts 주석) 서버 없이도 렌더된다. 원본 위키와
 * 같은 북(단)→남(에일라트) 지리 순서로, 구간 → 지점 → 호스트로 묶어 보여준다.
 *
 * XSS 안전: details(영어 원문 사용자 콘텐츠)는 JSX 텍스트 자식으로만 넣어 React
 * 기본 이스케이프에 의존한다 — dangerouslySetInnerHTML은 이 경로에 없다.
 */
import {
  INT_TRAIL_ANGELS,
  INT_TRAIL_ANGELS_SOURCE,
  INT_TRAIL_ANGELS_UPDATED,
  INT_TRAIL_ANGEL_REGIONS,
} from '@shvil/shared/src/legacyAngels';
import { useI18n } from '@/i18n';

/** 이스라엘 국내형(0…) → 표시 형식 (build.py fmt_phone 이식). */
function fmtPhone(d: string): string {
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return d;
}

/** 국제 발신 링크 — 0 → +972 (이스라엘). */
function telHref(d: string): string {
  return `tel:+972${d.slice(1)}`;
}

export default function TrailAngelsPage() {
  const { t } = useI18n();
  const s = t.legacyAngels;
  return (
    <>
      <h1>{s.title}</h1>
      <p>{s.intro}</p>
      <div className="notice">{s.etiquette}</div>
      <p className="muted">{s.shoNote}</p>
      <p className="muted">
        {s.count(INT_TRAIL_ANGELS.length)} · {s.updated(INT_TRAIL_ANGELS_UPDATED)} · {s.source}:{' '}
        <a href={INT_TRAIL_ANGELS_SOURCE} target="_blank" rel="noreferrer">
          INT Trail Angels wiki
        </a>
      </p>

      {INT_TRAIL_ANGEL_REGIONS.map((region) => {
        const inRegion = INT_TRAIL_ANGELS.filter((a) => a.region === region);
        const locations = [...new Set(inRegion.map((a) => a.location))];
        return (
          <section key={region} className="legacy-region">
            {/* 구간·지점명은 원본 고유명(영어) — 번역 대상이 아니다 */}
            <h2>{region}</h2>
            {locations.map((loc) => (
              <div key={loc || '(no-location)'} className="legacy-location">
                <h3>{loc}</h3>
                {inRegion
                  .filter((a) => a.location === loc)
                  .map((a) => (
                    <article key={a.order} className="legacy-card">
                      <p className="legacy-details">{a.details}</p>
                      <p className="legacy-meta">
                        {a.sho && <span className="legacy-sho">{s.shoBadge}</span>}
                        {a.services.map((svc) => (
                          <span key={svc} className="service-tag">
                            {s.serviceLabels[svc] ?? svc}
                          </span>
                        ))}
                        {a.phones.map((p) => (
                          <a key={p} className="legacy-phone" href={telHref(p)}>
                            📞 {fmtPhone(p)}
                          </a>
                        ))}
                      </p>
                    </article>
                  ))}
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}
