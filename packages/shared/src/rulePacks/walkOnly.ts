/**
 * 예시 규칙 팩 ②: walk-only — 가장 짧은 본보기.
 *
 * 어떤 사람은 "나는 두 발로 걸은 코인만 받겠다"고 정할 수 있다. 자전거 코인은
 * 위조가 아니다 — 규칙상 완전히 정상이다. 다만 그것을 받을지 말지는 **받는 사람의
 * 자유**다(헌법 제9조: 엔젤의 자율을 침해하지 않는다).
 *
 * 규칙 세 줄짜리 팩이 어떻게 생겼는지 보여 주려고 만들었다. 자기 팩을 처음 만드는
 * 사람은 이 파일을 복사해 숫자만 고치면 된다.
 */
import type { RulePack } from '../rulePack';

export const WALK_ONLY_PACK: RulePack = {
  v: 1,
  id: 'walk-only',
  name: '도보만',
  author: 'shvil community',
  description: '두 발로 걸은 코인만 받는 사람을 위한 팩. 자전거 계보는 위조가 아니라 취향의 문제다.',
  rules: [
    {
      id: 'no-steps',
      scope: 'proof',
      severity: 'FATAL',
      detail:
        '걸음 수가 0입니다 — 자전거 계보의 코인입니다. **위조가 아닙니다.** 이 팩을 쓰는 사람이 도보 코인만 받기로 정한 것뿐입니다.',
      when: { op: 'eq', field: 'stepCount', value: 0 },
    },
    {
      id: 'stride-too-long',
      scope: 'proof',
      severity: 'SIGNAL',
      detail: '한 걸음이 {strideM} m입니다. 도보 대역(0.5~0.9 m)보다 깁니다.',
      when: { op: 'gt', field: 'strideM', value: 0.9 },
    },
    {
      id: 'faster-than-walking',
      scope: 'proof',
      severity: 'SIGNAL',
      detail: '평균 속도가 {speedKmh} km/h로 보행 인정 상한(6 km/h)을 넘습니다.',
      when: { op: 'gt', field: 'speedKmh', value: 6 },
    },
  ],
};
