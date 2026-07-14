/** 더보기 탭 스택 파라미터 (M2 + M3 마켓 + M4 커뮤니티 + M6 예약). */
export type MoreStackParamList = {
  더보기: undefined;
  '엔젤 지도': undefined;
  메시지: undefined;
  채팅: { peerMemberId: string; peerName: string };
  /** M6: 투숙 신청 폼 — available은 엔젤의 자발 공개 가능 여부 (R-3, 강제 아님). */
  '투숙 신청': { peerMemberId: string; peerName: string; available?: boolean };
  '내 포인트': undefined;
  마켓: undefined;
  커뮤니티: undefined;
  '복구 문구': undefined;
  '가입/설정': undefined;
};
