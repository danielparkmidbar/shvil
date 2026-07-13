'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import LocaleSwitcher from './LocaleSwitcher';

/** 공통 네비 (지시서 5장): 지도 · 마켓 · 투명성 + 언어 스위처. */
export default function SiteHeader() {
  const { t } = useI18n();
  return (
    <header className="site-header">
      <nav className="site-nav">
        <Link href="/" className="brand">
          {t.common.siteName}
        </Link>
        <div className="nav-links">
          <Link href="/map">{t.common.nav.map}</Link>
          <Link href="/market">{t.common.nav.market}</Link>
          <Link href="/transparency">{t.common.nav.transparency}</Link>
        </div>
        <LocaleSwitcher />
      </nav>
    </header>
  );
}
