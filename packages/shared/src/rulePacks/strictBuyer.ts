/**
 * 예시 규칙 팩 ①: strict-buyer — **실제 돈을 주고 코인을 사는 사람**을 위한 팩.
 *
 * 다니엘 쌤: "확인하지 않아도 손해가 없는 사람은 확인하지 않을 것이고, 위폐를 받으면
 * 손해라 느끼는 사람은 자신의 폰에서 자체적으로 검사할 수 있도록. 실제 돈을 주고
 * 구매하는 사람은 철저히 검사할 것이고."
 *
 * ── 이 팩을 읽는 법 ───────────────────────────────────────────────────
 * 여기 있는 규칙은 **위조의 증거가 아니다.** 코어 검사(물리적으로 불가능한 것)를
 * 이미 통과한 코인들 중에서, 큰돈을 거는 사람이 "그래도 한 번 더 묻고 싶은" 것들을
 * 골라내는 그물이다. 지목되었다고 위폐가 아니다 — 파는 사람에게 물어보라는 뜻이다.
 *
 * severity의 뜻도 코어와 다르다:
 *  - SIGNAL = 물어볼 만하다.
 *  - FATAL  = **이 팩을 쓰는 내가** 이런 코인은 실물 거래로 받지 않기로 정했다.
 * 어느 쪽도 coreVerdict를 바꾸지 못한다. 남에게 강요되지도 않는다.
 *
 * 그대로 쓰지 말고 **베껴서 자기 숫자로 고쳐 쓰라고** 만든 본보기다.
 */
import type { RulePack } from '../rulePack';

export const STRICT_BUYER_PACK: RulePack = {
  v: 1,
  id: 'strict-buyer',
  name: '엄격 구매자',
  author: 'shvil community',
  description:
    '실제 돈을 주고 코인을 사는 사람을 위한 팩. 코어를 통과한 코인 중 소명을 요청할 만한 것을 골라낸다. 지목 = 위조가 아니라 질문이다.',
  rules: [
    // ── 증명 한 건 ──────────────────────────────────────────────────
    {
      id: 'span-over-14d',
      scope: 'proof',
      severity: 'SIGNAL',
      detail:
        '이 코인의 걷기 구간이 {spanDays}일에 걸쳐 있습니다. 코어는 90일까지 허용하지만(종주자를 위해), 큰 거래라면 왜 그렇게 오래 정산하지 않았는지 물어볼 만합니다.',
      when: { op: 'gt', field: 'spanDays', value: 14 },
    },
    {
      id: 'rate-over-2x',
      scope: 'proof',
      severity: 'SIGNAL',
      detail:
        '1 km당 {dshvPerKm} dSHV로 발행되었습니다(기준 요율은 10). 난이도 계수가 ×2를 넘는 구간만으로 이루어졌다는 뜻이니, 어느 코스였는지 물어볼 만합니다.',
      when: { op: 'and', of: [{ op: 'gte', field: 'distanceM', value: 1000 }, { op: 'gt', field: 'dshvPerKm', value: 20 }] },
    },
    {
      id: 'fast-for-walking',
      scope: 'proof',
      severity: 'SIGNAL',
      detail: '평균 속도가 {speedKmh} km/h입니다. 도보로 보기에는 빠릅니다 — 자전거였다면 정상입니다.',
      when: { op: 'gt', field: 'speedKmh', value: 8 },
    },
    {
      id: 'big-single-coin',
      scope: 'proof',
      severity: 'SIGNAL',
      detail: '증명 한 건이 {amountDshv} dSHV입니다. 큰 액수일수록 쪼개진 코인 전부를 함께 검사하십시오.',
      when: { op: 'gt', field: 'amountDshv', value: 2000 },
    },
    {
      id: 'breakdown-vs-span',
      scope: 'proof',
      severity: 'SIGNAL',
      detail:
        '일자별 내역이 {breakdownDays}일치인데 걷기 구간은 {spanDays}일입니다. 거의 하루도 쉬지 않고 걸었다는 기록입니다.',
      when: { op: 'and', of: [{ op: 'gt', field: 'breakdownDays', value: 20 }, { op: 'gt', field: 'maxDayDshv', value: 300 }] },
    },
    {
      id: 'too-old-to-accept',
      scope: 'proof',
      severity: 'FATAL',
      detail:
        '정산된 지 {ageDays}일 지난 코인입니다. **위조라는 뜻이 아닙니다** — 이 팩을 쓰는 사람이 2년 넘게 잠들어 있던 코인은 실물 거래로 받지 않기로 스스로 정한 것입니다. 판정이 아니라 내 기준입니다.',
      when: { op: 'gt', field: 'ageDays', value: 730 },
    },

    // ── 한 회원의 묶음 ──────────────────────────────────────────────
    {
      id: 'settle-burst',
      scope: 'member',
      severity: 'SIGNAL',
      detail: '정산 사이 최소 간격이 {minGapMs} ms입니다. 사람이 이렇게 촘촘히 정산하는 일은 드뭅니다.',
      when: { op: 'and', of: [{ op: 'gte', field: 'proofCount', value: 3 }, { op: 'lt', field: 'minGapMs', value: 600000 }] },
    },
    {
      id: 'sustained-near-cap',
      scope: 'member',
      severity: 'SIGNAL',
      detail:
        '흐른 시간 대비 평균 발행이 하루 {dshvPerDay} dSHV입니다. 하루 상한 400의 3/4를 오래 유지한 셈이니, 그만큼 매일 걸었는지 물어볼 만합니다.',
      when: { op: 'and', of: [{ op: 'gt', field: 'spanDays', value: 7 }, { op: 'gt', field: 'dshvPerDay', value: 300 }] },
    },
    {
      id: 'multi-device',
      scope: 'member',
      severity: 'SIGNAL',
      detail:
        '한 회원 번호에 서로 다른 기기 키가 {deviceCount}개 있습니다. 기기를 바꾸면 정상이지만, 두 대를 동시에 돌린 흔적일 수도 있습니다.',
      when: { op: 'gt', field: 'deviceCount', value: 1 },
    },
  ],
};
