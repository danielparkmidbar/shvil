import Link from 'next/link';
import { t } from '@/i18n';

/**
 * 랜딩 (지시서 5장 1절): 비전 한 문단 + 엔젤 지도 링크 + 지갑 다운로드 +
 * "지갑을 받으면 지도에 엔젤로 등록된다" 흐름 설명.
 * 정적 서버 컴포넌트 — 데이터 fetch 없음 (빌드가 서버 가동에 의존하지 않는다).
 */
export default function LandingPage() {
  const s = t.landing;
  return (
    <>
      <section className="hero">
        <h1>{s.heroTitle}</h1>
        <p className="hero-vision">{s.vision}</p>
        <div className="hero-actions">
          {/* 지갑 다운로드 — 앱 배포 전 플레이스홀더 (스토어 링크는 후속). */}
          <a className="btn" aria-disabled="true" title={s.downloadNote}>
            {s.downloadCta}
          </a>
          <Link className="btn btn-secondary" href="/map">
            {s.mapPreviewCta}
          </Link>
          <span className="muted">{s.downloadNote}</span>
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
    </>
  );
}
