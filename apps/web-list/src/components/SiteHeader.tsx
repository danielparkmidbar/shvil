'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import LocaleSwitcher from './LocaleSwitcher';
import RegionSelector from './RegionSelector';

/**
 * 공통 네비 (지시서 6장 + M5 재조정): 엔젤 찾기 · 코스 · 클레임 · 갤러리 ·
 * 리더보드 · 투명성 + 지역/언어 스위처. 로그인 메뉴는 없다 — 웹에는 계정이
 * 없다 (재조정 설계 0-1절: 회원 기능은 전부 지갑 앱).
 */
export default function SiteHeader() {
  const { t } = useI18n();
  return (
    <header className="site-header">
      <nav className="site-nav">
        <Link href="/" className="brand">
          {t.common.siteName}
        </Link>
        <div className="nav-links">
          <Link href="/angels">{t.common.nav.angels}</Link>
          <Link href="/trail-angels">{t.common.nav.trailAngels}</Link>
          <Link href="/companions">{t.common.nav.companions}</Link>
          <Link href="/spots">{t.common.nav.spots}</Link>
          <Link href="/courses">{t.common.nav.courses}</Link>
          <Link href="/claims">{t.common.nav.claims}</Link>
          <Link href="/certificates">{t.common.nav.certificates}</Link>
          <Link href="/leaderboard">{t.common.nav.leaderboard}</Link>
          <Link href="/transparency">{t.common.nav.transparency}</Link>
        </div>
        <div className="header-controls">
          <RegionSelector />
          <LocaleSwitcher />
        </div>
      </nav>
    </header>
  );
}
