import type { NavigatorScreenParams } from '@react-navigation/native';
import type { RatingDirection, RatingRelationProof } from '@shvil/shared';

/** 더보기 탭 스택 파라미터 (M2 + M3 마켓 + M4 커뮤니티 + M6 예약 + M7-A 감사 카드 + M7-B 별점). */
export type MoreStackParamList = {
  더보기: undefined;
  '엔젤 지도': undefined;
  메시지: undefined;
  채팅: { peerMemberId: string; peerName: string };
  /** M6: 투숙 신청 폼 — available은 엔젤의 자발 공개 가능 여부 (R-3, 강제 아님). */
  '투숙 신청': { peerMemberId: string; peerName: string; available?: boolean };
  /** M7-A: 감사 카드 작성 (리스트 → 엔젤, E2E). */
  '감사 카드': { peerMemberId: string; peerName: string };
  /** M7-A: 게스트북 관리 (엔젤이 받은 감사 카드 게시·철회). */
  게스트북: undefined;
  /**
   * M7-B: 별점 남기기 (상호). relationProof(관계 증명)·direction은 진입점이 관계를
   * 확인해 넘긴다 — 관계 없으면 진입점이 나타나지 않는다 (제1원칙).
   */
  '별점 남기기': {
    peerMemberId: string;
    peerName: string;
    relationProof: RatingRelationProof;
    direction: RatingDirection;
  };
  /** M7-B: 내 별점 관리 (받은 별점 공개·철회, 공개율 표시). */
  '내 별점': undefined;
  '내 포인트': undefined;
  마켓: undefined;
  커뮤니티: undefined;
  '복구 문구': undefined;
  '가입/설정': undefined;
};

/**
 * 루트 탭 파라미터 — 탭 화면(예: 손님)에서 더보기 스택의 화면(별점 남기기)으로
 * 중첩 내비게이션할 때 타입 안전성을 준다 (navigate('더보기', { screen, params })).
 */
export type RootTabParamList = {
  홈: undefined;
  손님: undefined;
  걷기: undefined;
  지갑: undefined;
  거래: undefined;
  더보기: NavigatorScreenParams<MoreStackParamList>;
};
