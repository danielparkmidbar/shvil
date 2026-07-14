'use client';

/**
 * 랜딩 (M5 정비): "엔젤 되기"를 주 CTA로. 어조는 호혜·선의 우선 —
 * "코인은 미래의 기대이지 목적이 아니다" (서비스 재조정 설계 §0). 과장 광고체 금지.
 * 웹은 여행 준비 도구("여행 전엔 노트북") — 큰 화면을 채우는 히어로가 기준이다.
 * 데이터 fetch 없음 (빌드가 서버 가동에 의존하지 않는다). 문자열은 useI18n으로.
 */
import Link from 'next/link';
import { useI18n } from '@/i18n';
import ExpansionTrails from '@/components/ExpansionTrails';

export default function LandingPage() {
  const { t } = useI18n();
  const s = t.landing;
  return (
    <>
      {/* 히어로 — 트레일 풍경·환대 장면 사진으로 교체 예정 (실제 에셋 확보 시).
          지금은 CSS 그라디언트로 하늘→언덕→길을 그려 자리를 잡는다.
          외부 이미지 핫링크 금지 (정적 자립 원칙) — 에셋은 public/에 둘 것. */}
      <section className="hero hero-large">
        <div className="hero-inner">
          <h1>{s.heroTitle}</h1>
          <p className="hero-vision">{s.vision}</p>
          <div className="hero-actions">
            <Link className="btn btn-hero" href="/become">
              {s.becomeCta}
            </Link>
            <Link className="btn btn-secondary" href="/map">
              {s.mapPreviewCta}
            </Link>
          </div>
        </div>
      </section>

      <section>
        <h2>{s.flowTitle}</h2>
        <ol className="flow-steps">
          {s.flowSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="muted">{s.flowNote}</p>
      </section>

      <section>
        <div className="notice">{s.faceToFaceFree}</div>
      </section>

      <ExpansionTrails />
    </>
  );
}
