import type { Metadata } from 'next';
import './globals.css';
import { en, LocaleProvider, LOCALE_BOOT_SCRIPT } from '@/i18n';
import { RegionProvider } from '@/region/RegionProvider';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';

/** 메타데이터는 기본 로케일(en) 고정 — 화면 문자열은 LocaleProvider가 관리. */
export const metadata: Metadata = {
  title: `${en.common.siteName} — shvilangel.org`,
  description: en.common.tagline,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // 부트 스크립트가 hydration 전에 lang/dir을 저장값으로 바꾸므로 경고를 억제한다.
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body>
        {/* 히브리어 사용자에게 LTR 화면이 번쩍이지 않게 — 가장 먼저 실행 */}
        <script dangerouslySetInnerHTML={{ __html: LOCALE_BOOT_SCRIPT }} />
        <LocaleProvider>
          <RegionProvider>
            <SiteHeader />
            <main className="site-main">{children}</main>
            <SiteFooter />
          </RegionProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
