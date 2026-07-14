import BecomeAngel from './BecomeAngel';

/**
 * "엔젤 되기" (M5 신규 — 서비스 재조정 설계 §4-1).
 * 사이트는 문이다: 이 페이지는 미리보기와 안내까지만 하고, 어떤 것도 서버에
 * 제출하지 않는다. 실제 등록(서명)은 지갑에서만 이루어진다.
 * 화면 전체가 클라이언트 컴포넌트다 (i18n + 지도 + 지오코딩은 전부 브라우저 몫).
 */
export default function BecomePage() {
  return <BecomeAngel />;
}
