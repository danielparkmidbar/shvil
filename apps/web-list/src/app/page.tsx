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
import ExpansionTrails from '@/components/ExpansionTrails';

/**
 * 지갑 APK 다운로드 (닫힌 시험 — Android 전용).
 * GitHub Releases 최신 릴리스로 연결한다 — 새 APK를 릴리스로 올리면 홈페이지
 * 재배포 없이 이 링크가 항상 최신을 가리킨다. iOS는 웹 다운로드가 불가(애플 정책 —
 * TestFlight 필요)라 시험판은 Android만. ※저장소가 비공개면 시험단이 접근 불가 —
 * 공개 전환 또는 별도 배포 채널 필요 (배포_가이드 3장).
 */
const WALLET_DOWNLOAD_URL = 'https://github.com/danielparkmidbar/shvil/releases/latest';

/**
 * 다운로드 개방 스위치 (닫힌 시험 중에는 false).
 *
 * false면 버튼이 비활성(회색)이고 링크가 없다 — 릴리스가 아직 없는데 버튼만 열려
 * 있으면 방문자가 "릴리스 없음" 빈 페이지를 보게 되므로, 실기기 검증이 끝나고
 * APK를 GitHub Release에 올린 **뒤에** true로 바꾼다. web-angel의 지갑 CTA도 같은
 * 시점에 함께 연다 (두 사이트가 어긋나지 않게).
 */
const WALLET_DOWNLOAD_OPEN = false;

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
          {/* 지갑 다운로드 — 개방 시 GitHub Releases 최신 APK (닫힌 시험, Android).
              WALLET_DOWNLOAD_OPEN=false 동안은 비활성 (릴리스 없는 빈 페이지 방지). */}
          {WALLET_DOWNLOAD_OPEN ? (
            <a className="btn" href={WALLET_DOWNLOAD_URL} title={s.downloadNote}>
              {s.downloadCta}
            </a>
          ) : (
            <a className="btn" aria-disabled="true" title={s.downloadNote}>
              {s.downloadCta}
            </a>
          )}
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

      <ExpansionTrails />
    </>
  );
}
