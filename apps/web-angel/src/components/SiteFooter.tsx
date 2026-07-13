'use client';

import { useI18n } from '@/i18n';

/** 공통 푸터 — shvilist.org 링크 + 대면 지불 영구 무료 문구. */
export default function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <p>
        <a href={t.common.footer.shvilistUrl} rel="noopener">
          {t.common.footer.shvilistLink}
        </a>
      </p>
      <p className="footer-free">{t.common.footer.faceToFaceFree}</p>
    </footer>
  );
}
