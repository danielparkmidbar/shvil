'use client';

/**
 * 동행 찾기 페이지 (M8 — 서비스 재조정 §4-6, R-6).
 *
 * 여정을 나누고 함께 걸을 팀을 미리 만드는 공간(다니엘 쌤). 웹은 열람·계획까지 —
 * 글 작성과 "관심 보내기"는 서명 주체인 지갑 앱에서 한다 (R-7). 3~4인 팀 권장을
 * 부드럽게 표기한다. 데스크톱 우선 와이드 레이아웃 — 게시판의 글을 편히 읽는 넓은
 * 본문 (재조정 설계 0-1절 웹 콘텐츠 원칙).
 */
import { useI18n } from '@/i18n';
import CompanionBoard from './CompanionBoard';

export default function CompanionsPage() {
  const { t } = useI18n();
  return (
    <div className="breakout-wide">
      <h1>{t.companions.title}</h1>
      <p className="muted page-intro">{t.companions.intro}</p>
      <div className="notice">{t.companions.readOnlyNote}</div>
      <CompanionBoard />
    </div>
  );
}
