'use client';

/**
 * 홈 (지시서 6장): "스스로 기록하고 스스로 인증한다" 비전 + 앱 다운로드
 * 플레이스홀더 + 여정 인증 설명.
 *
 * 여정 인증(WalkSegmentProof 공개 열람)은 앱에서 공개 설정한 요약만 —
 * 거리·걸음 수·날짜뿐, 위치·경로 없음. 공개 열람 기능 자체는 후속 항목이라
 * 이 페이지는 안내만 한다. 데이터 fetch 없음.
 */
import Link from 'next/link';
import { useI18n } from '@/i18n';

const SECTION_LINKS = [
  { key: 'courses', href: '/courses' },
  { key: 'claims', href: '/claims' },
  { key: 'certificates', href: '/certificates' },
  { key: 'leaderboard', href: '/leaderboard' },
] as const;

export default function HomePage() {
  const { t } = useI18n();
  const s = t.home;
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
          <span className="muted">{s.downloadNote}</span>
        </div>
      </section>

      <section>
        <h2>{s.proofTitle}</h2>
        <p>{s.proofBody}</p>
        <div className="placeholder">{s.proofComingSoon}</div>
      </section>

      <section>
        <h2>{s.sectionsTitle}</h2>
        <div className="section-cards">
          {SECTION_LINKS.map(({ key, href }) => (
            <Link key={key} href={href} className="section-card">
              <h3>{s.sections[key].title}</h3>
              <p>{s.sections[key].desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
