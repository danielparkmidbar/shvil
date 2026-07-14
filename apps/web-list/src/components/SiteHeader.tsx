'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import LocaleSwitcher from './LocaleSwitcher';
import RegionSelector from './RegionSelector';

/** 공통 네비 (지시서 6장): 코스 · 클레임 · 갤러리 · 리더보드 + 언어 스위처. */
export default function SiteHeader() {
  const { t } = useI18n();
  return (
    <header className="site-header">
      <nav className="site-nav">
        <Link href="/" className="brand">
          {t.common.siteName}
        </Link>
        <div className="nav-links">
          <Link href="/courses">{t.common.nav.courses}</Link>
          <Link href="/claims">{t.common.nav.claims}</Link>
          <Link href="/certificates">{t.common.nav.certificates}</Link>
          <Link href="/leaderboard">{t.common.nav.leaderboard}</Link>
        </div>
        <div className="header-controls">
          <RegionSelector />
          <LocaleSwitcher />
        </div>
      </nav>
    </header>
  );
}
