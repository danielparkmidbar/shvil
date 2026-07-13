'use client';

import { useI18n } from '@/i18n';

/** 공통 푸터 — shvilangel.org 링크 (지시서 6장 공통 레이아웃). */
export default function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <p>
        <a href={t.common.footer.angelUrl} rel="noopener">
          {t.common.footer.angelLink}
        </a>
      </p>
      <p className="footer-free">{t.common.footer.motto}</p>
    </footer>
  );
}
