/**
 * 쉬빌 코인 코어 타입.
 *
 * 위치 비저장 원칙: 어떤 타입에도 좌표·경로 필드가 없다. 회랑 판정(코스 위/밖)은
 * 판정 엔진(M1)이 휘발성 메모리에서 수행하고, 코어에는 판정 결과(tier)와
 * 거리·걸음 수 같은 파생 지표만 들어온다.
 */

/** 걸음의 자리 — 3단계 요율 + 엔젤 우회 (지시서 2.2). */
export type WalkTier = 'ON_COURSE' | 'OFF_COURSE' | 'DAILY_LIFE' | 'ANGEL_DETOUR';

/** 걷기 창(window) 요약 샘플 — 판정 엔진이 좌표를 폐기한 뒤 코어에 넘기는 단위. */
export interface WalkSample {
  /** 창 길이 (초). */
  durationS: number;
  /** 창 동안 GPS 파생 이동 거리 (m). 좌표가 아니라 거리만. */
  distanceM: number;
  /** 창 동안 걸음 수 (가속도계 파형 기반). */
  steps: number;
  /** 회랑 판정 결과. */
  tier: WalkTier;
  /** 창 시각 (epoch ms) — 일일 상한 귀속용. */
  timestamp: number;
  /** 구간 난이도 계수 ×10 정수 (10 = ×1.0). ON_COURSE에만 적용. */
  difficultyTenths?: number | undefined;
  /** ANGEL_DETOUR일 때 목적지 엔젤 회원 번호. */
  detourAngelMemberId?: string | undefined;
  /** 코스 ID (예: "shvil-israel") — 계보에 좌표 대신 남는 유일한 장소 정보. */
  courseId?: string | undefined;
}

export type WalkRejectReason =
  | 'TOO_FAST' // 뛰는 속도 이상 — 카운트하지 않음
  | 'VEHICLE' // 차량·교통수단 속도
  | 'NO_STEPS' // 거리는 진행되는데 걸음 파형 없음 (차량/스푸핑)
  | 'STEP_DISTANCE_MISMATCH' // 걸음 수 × 보폭과 GPS 거리 불일치 (흔들기/차량)
  | 'CADENCE_OUT_OF_RANGE' // 인간 보행 케이던스 이탈
  | 'INVALID_SAMPLE';

export interface WalkSampleVerdict {
  accepted: boolean;
  reason?: WalkRejectReason;
  /** 인정 거리 (m). 거부 시 0. */
  creditedDistanceM: number;
}

/** 정산 방식 — 사용 또는 본인 선언뿐. 자동 정산은 존재하지 않는다 (지시서 0-6). */
export type SettlementKind = 'SPEND' | 'MANUAL';

import type { MembershipCertificate } from './membership';

/** 걷기 구간 증명 — 민팅된 코인이 계보로 품는 구조체 (지시서 2.2). */
export interface WalkSegmentProof {
  v: 1;
  /** 생성자 회원 번호 — 모든 코인에 새겨진다. */
  memberId: string;
  /** 기기 공개키 (보안 영역 키) — 서명 검증용. */
  devicePublicKey: string;
  /** 걸은 코스 ID 목록 — 좌표·경로 없음. */
  courseIds: string[];
  startedAt: number;
  settledAt: number;
  /** 인정 거리 합 (m). */
  distanceM: number;
  stepCount: number;
  /** 확정 발행액 (dSHV) — 요율·계수·상한·내림 적용 후. */
  amountDshv: number;
  settlement: SettlementKind;
  /** 일자별 발행 내역 — 수신 지갑의 인간 한계 검증 입력 (지시서 3장). */
  dailyBreakdown: { date: string; amountDshv: number }[];
  /** 센서 요약 해시 (파형 통계 등 파생 지표의 해시 — 좌표 아님). */
  sensorSummaryHash: string;
  /** 앱 무결성 증명 토큰 (Play Integrity / App Attest) — 증서 발급 시 서버에 제출한 원토큰의 해시 등. */
  appIntegrityToken: string | null;
  /**
   * 회원 증서 — 회원 번호↔기기 키 결속 + 무결성 담보 (보안 감사 C-2).
   * 서버 발급. 수신 지갑이 신뢰 루트 키로 검증한다. 하위 호환을 위해 optional이며,
   * requireIntegrityToken 검증 옵션에서 필수로 승격된다.
   */
  membership?: MembershipCertificate | null | undefined;
  /** 기기 키 서명 (signature 필드 제외 정준 직렬화 대상). */
  signature: string;
}

/** 프로모션·커뮤니티 발행 승인서 (엔젤 보너스, 클레임, 격려 코인 공용). */
export interface SignedGrant {
  v: 1;
  kind: 'ANGEL_BONUS' | 'COMMUNITY_CLAIM' | 'COMMUNITY_REWARD';
  memberId: string;
  amountDshv: number;
  /** 근거 참조 — 보너스 사유, 클레임 게시물 해시+인정자 수, 격려 게시물 해시 등. */
  reference: string;
  /** 수령자 기기 공개키 — 이 지갑이 코인의 최초 소유자가 된다. */
  recipientPublicKey: string;
  /** 발행 키 ID (기간·수량 한정 프로모션 키). */
  issuerKeyId: string;
  issuerPublicKey: string;
  issuedAt: number;
  signature: string;
}

export type Provenance =
  | { kind: 'WALK'; proof: WalkSegmentProof }
  | { kind: 'GRANT'; grant: SignedGrant }
  | {
      /** 코인 분할 — 부모 코인의 계보를 그대로 상속한다. 생성/구매 구분은 뿌리 계보를 따른다. */
      kind: 'SPLIT';
      parent: Coin;
      record: SplitRecord;
      index: number;
    };

/** 분할 기록 — 분할 시점 소유자가 자식 금액 전체를 커밋·서명한다. */
export interface SplitRecord {
  v: 1;
  parentCoinId: string;
  /** 자식 코인 금액 목록 — 합계가 부모 금액과 정확히 일치해야 한다. */
  childAmountsDshv: number[];
  ownerPublicKey: string;
  timestamp: number;
  signature: string;
}

/** 이전 체인 링크 — 두 기기 간 양측 서명으로 거래 완결 (지시서 2.3). */
export interface TransferLink {
  from: string; // 지불자 주소
  to: string; // 수령자 주소
  fromPublicKey: string;
  toPublicKey: string;
  timestamp: number;
  /** 직전 체인 상태 해시 — 재정렬·삽입 탐지. */
  prevChainHash: string;
  /** 지불자 서명. */
  fromSignature: string;
  /** 수령자 확인 서명 — QR 왕복의 역스캔 단계에서 채워진다. null이면 미완결. */
  toSignature: string | null;
}

export interface Coin {
  /** 계보에서 유도되는 결정적 ID — 내용 변조 시 ID가 어긋난다. */
  id: string;
  amountDshv: number;
  /** 생성자 회원 번호 — 모든 코인에 새겨진다 (분할·이전 후에도 불변). */
  memberId: string;
  provenance: Provenance;
  transferChain: TransferLink[];
}

/** 코인 검증 실패 사유. */
export type CoinRejectReason =
  | 'BAD_PROOF_SIGNATURE'
  | 'BAD_GRANT_SIGNATURE'
  | 'UNTRUSTED_ISSUER'
  | 'ID_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'MEMBER_MISMATCH'
  | 'BAD_SPLIT'
  | 'BROKEN_TRANSFER_CHAIN'
  | 'BAD_TRANSFER_SIGNATURE'
  | 'INCOMPLETE_TRANSFER'
  | 'HUMAN_LIMIT_EXCEEDED'
  | 'MISSING_INTEGRITY_TOKEN'
  | 'BAD_MEMBERSHIP' // 회원 증서 서명·루트·만료 무효 (보안 감사 C-2)
  | 'MEMBERSHIP_MISMATCH' // 증서의 회원 번호·기기 키가 증명과 불일치
  | 'MALFORMED';

export interface CoinVerdict {
  valid: boolean;
  reasons: CoinRejectReason[];
}
