/**
 * 배포 키 변경 알림 — 순수 로직 (expo 미의존, vitest 대상).
 *
 * ── 무엇을 푸는가 ────────────────────────────────────────────────────
 * 지갑은 서버의 배포 공개키를 첫 수신에 고정한다(TOFU). 그 키가 바뀌면 갱신이 막히는데,
 * **푸는 길이 없었다.** 서버를 정당하게 재배포하거나 키를 회전하면 이미 설치된 폰이
 * 재설치 전까지 벽돌이 된다. 그런데 재설치는 지갑 DB를 지우는 일이므로, 백업이 없으면
 * **핀을 푸는 유일한 길이 곧 코인을 잃는 길**이었다.
 *
 * ── 왜 자동으로 풀지 않는가 ─────────────────────────────────────────
 * 자동 해제 = MITM 통로. 아무나 자기 키로 서명해서 보내면 지갑이 그 키를 새 진실로
 * 받아들이게 되고, 그 순간 핀은 없는 것과 같다. 그래서 **사람이 결정한다.** 지갑은
 * 판단하지 않고, 무슨 일이 일어났는지 **정직하게 보여 주기만** 한다:
 *  · 옛 지문과 새 지문 (사람이 눈으로 대조할 수 있게)
 *  · 언제 핀했는지, 언제 처음 봤는지, 몇 번 봤는지
 *  · ★"정상 갱신일 수도, 공격일 수도 있습니다. 지갑은 구별할 수 없습니다."
 *
 * ── ★0층은 이 결정과 무관하다 ──────────────────────────────────────
 * 받아도, 거절해도, 아무것도 안 해도 **걷기·정산·민팅·QR 대면 지불·수령은 그대로 된다.**
 * 서버를 한 번도 부르지 않기 때문이다(`zeroFloorUnderPinMismatch.test.ts`가 못박는다).
 * 거절하면 캐시된 코스·캐시된 신뢰 키로 계속 동작한다 — 갱신만 멈춘다.
 */
import { publicKeyFingerprint } from '@shvil/shared';
import type { PinChangeCandidate } from './distributionGuard';

/** kv 저장 키 — 대기 중인 배포 키 변경 후보. */
export const PIN_PENDING_KEY = 'distKeyPinPending.v1';
/** kv 저장 키 — 현재 핀을 박은 시각. 옛 지갑에는 없다(그때는 '알 수 없음'). */
export const PIN_AT_KEY = 'distKeyPinnedAt.v1';

export interface PendingPinChange extends PinChangeCandidate {
  /** 이 후보를 처음 본 시각 (기기 시계). */
  firstSeenAt: number;
  /** 마지막으로 본 시각. */
  lastSeenAt: number;
  /** 몇 번 봤는지 — 한 번뿐인 사고와 계속되는 상태를 사람이 구별할 수 있게. */
  seenCount: number;
}

/**
 * 공개키 지문 — 사람이 눈으로 대조할 수 있는 형태.
 *
 * ★형식 정의는 `@shvil/shared`에 하나만 있다(`publicKeyFingerprint`). 서버 `/health`와
 * 시드 생성기가 **같은 함수**를 쓰므로, 폰 화면의 값과 종이에 적어 둔 값과 서버가 내는
 * 값이 글자 하나까지 같다. 형식이 갈리면 사람이 대조를 포기한다 — 그것이 적대검증
 * ①-b가 파고든 틈이었다.
 */
export function keyFingerprint(publicKeyHex: string | null | undefined): string {
  return publicKeyFingerprint(publicKeyHex);
}

/** 대기 후보를 kv 문자열로 되살린다 — 깨진 값이면 null(무시하고 새로 쌓는다). */
export function parsePendingPinChange(raw: string | null | undefined): PendingPinChange | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as PendingPinChange;
    if (typeof p?.newPublicKey !== 'string' || !/^[0-9a-f]{64}$/.test(p.newPublicKey)) return null;
    return {
      newPublicKey: p.newPublicKey,
      newKeyId: typeof p.newKeyId === 'string' ? p.newKeyId : '',
      // ★기본값은 false다. 옛 버전이 적어 둔 항목(이 필드가 없는 항목)은 "이름을 검산하지
      //   않은 채 쌓인 것"이므로 수락 대상이 아니다. 모르면 안전한 쪽으로 판단한다.
      nameVerified: p.nameVerified === true,
      signedAt: Number(p.signedAt) || 0,
      firstSeenAt: Number(p.firstSeenAt) || 0,
      lastSeenAt: Number(p.lastSeenAt) || 0,
      seenCount: Number(p.seenCount) || 1,
    };
  } catch {
    return null;
  }
}

/**
 * 후보를 누적한다.
 *
 * 같은 키를 또 보면 횟수만 올린다. **다른 키가 오면 처음부터 다시 센다** — 매번 다른 키를
 * 던지는 상대는 "정상 갱신"이 아니라는 뜻이고, 그 사실이 화면의 횟수에 드러나야 한다.
 */
export function mergePendingPinChange(
  prev: PendingPinChange | null,
  candidate: PinChangeCandidate,
  now: number,
): PendingPinChange {
  if (prev && prev.newPublicKey === candidate.newPublicKey) {
    return { ...prev, ...candidate, lastSeenAt: now, seenCount: prev.seenCount + 1 };
  }
  return { ...candidate, firstSeenAt: now, lastSeenAt: now, seenCount: 1 };
}

/** 화면에 그대로 뿌릴 수 있는 모양 (문구까지 여기서 만든다 — 화면은 배치만 한다). */
export interface PinChangeNotice {
  /** 지금 핀되어 있는 키의 지문. */
  pinnedFingerprint: string;
  /** 새로 제시된 키의 지문. */
  newFingerprint: string;
  /**
   * 새 키의 이름 — **지갑이 제시된 공개키에서 직접 유도한 값.** 서버 주장이 아니다.
   * 서버 `/health`의 `distKeyId`와 대조할 수 있고, 공격자는 이 값을 고를 수 없다.
   */
  newKeyId: string;
  /**
   * ★사람에게 "받겠습니까?"를 물어도 되는가.
   *
   * false면 서버가 자기 열쇠와 맞지 않는 이름을 주장했다는 뜻이다 = 규격 밖 응답 =
   * 위조 신호. 이때 화면은 수락 버튼을 **띄우지 않는다.** 알리기는 한다 — 조용히 삼키면
   * 사용자는 "동기화가 그냥 안 되네"로만 겪는다(제3조).
   */
  acceptable: boolean;
  /** "2026년 7월 20일" 같은 표기. 모르면 null. */
  pinnedAtText: string | null;
  firstSeenText: string;
  lastSeenText: string;
  seenCount: number;
  /** 사람에게 보여줄 문단들 — 정직하게. */
  lines: string[];
}

function dateText(ms: number | null): string | null {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function buildPinChangeNotice(input: {
  pinnedPublicKey: string | null;
  pinnedAt: number | null;
  pending: PendingPinChange;
}): PinChangeNotice {
  const { pinnedPublicKey, pinnedAt, pending } = input;
  const pinnedAtText = dateText(pinnedAt);
  const lines = [
    '서버가 지금까지와 **다른 열쇠**로 서명한 데이터를 보내고 있습니다.',
    '이것은 서버를 새로 배포하면서 열쇠가 바뀐 것일 수도 있고, 누군가 중간에서 가짜 서버를 흉내 내는 것일 수도 있습니다. **지갑은 둘을 구별할 수 없습니다.**',
    '지금은 새 데이터를 받지 않고 있습니다. 그래서 새 코스·새 발행자 목록·소명 목록이 갱신되지 않습니다.',
    '★받지 않아도 걷기·정산·지불·수령은 그대로 됩니다. 이미 가진 코인도 안전합니다.',
  ];
  if (pending.nameVerified) {
    // ★"몇 번 봤는지"로는 아무것도 판정할 수 없다는 사실을 여기서 못박는다.
    //   예전 문구("횟수가 늘고 지문이 같으면 진짜일 가능성이 큽니다")는 지속 MITM의
    //   모양 그대로였다 — 공격자가 계속 붙어 있을수록 정상처럼 보였다(적대검증 ①-d).
    lines.push(
      '★몇 번 봤는지는 진짜인지와 아무 상관이 없습니다. 가짜 서버도 계속 같은 열쇠를 보냅니다.',
      '운영자에게 **전화하거나 직접 만나서** 아래 지문을 확인하세요. 같은 인터넷으로 받은 값(웹페이지·메시지·이 화면)은 근거가 되지 않습니다. 확인하기 전에는 받지 마세요.',
    );
  } else {
    lines.push(
      '★이 서버는 **자기 열쇠와 맞지 않는 이름**을 주장했습니다. 정상 서버는 이런 응답을 보내지 않습니다.',
      '그래서 받는 단추를 띄우지 않습니다. 지금 쓰는 인터넷(공용 와이파이 등)을 의심하시고, 운영자에게 알려 주세요.',
    );
  }
  return {
    pinnedFingerprint: keyFingerprint(pinnedPublicKey),
    newFingerprint: keyFingerprint(pending.newPublicKey),
    newKeyId: pending.newKeyId,
    acceptable: pending.nameVerified,
    pinnedAtText,
    firstSeenText: dateText(pending.firstSeenAt) ?? '알 수 없음',
    lastSeenText: dateText(pending.lastSeenAt) ?? '알 수 없음',
    seenCount: pending.seenCount,
    lines,
  };
}
