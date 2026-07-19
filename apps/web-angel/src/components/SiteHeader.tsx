'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import LocaleSwitcher from './LocaleSwitcher';
import RegionSelector from './RegionSelector';

/** 공통 네비 (M5): 엔젤 되기 · 이웃 엔젤 · 마켓 · 투명성 + 지역·언어 스위처. */
export default function SiteHeader() {
  const { t } = useI18n();
  return (
    <header className="site-header">
      <nav className="site-nav">
        <Link href="/" className="brand">
          {t.common.siteName}
        </Link>
        <div className="nav-links">
          <Link href="/become">{t.common.nav.become}</Link>
          <Link href="/map">{t.common.nav.map}</Link>
          <Link href="/trail-angels">{t.common.nav.trailAngels}</Link>
          <Link href="/market">{t.common.nav.market}</Link>
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
