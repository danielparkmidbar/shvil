import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { activeDir, activeLocale, t } from '@/i18n';

export const metadata: Metadata = {
  title: `${t.common.siteName} — shvilangel.org`,
  description: t.common.tagline,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={activeLocale} dir={activeDir}>
      <body>
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
          </nav>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          <p>
            <a href={t.common.footer.shvilistUrl} rel="noopener">
              {t.common.footer.shvilistLink}
            </a>
          </p>
          <p className="footer-free">{t.common.footer.faceToFaceFree}</p>
        </footer>
      </body>
    </html>
  );
}
