/**
 * 예시 규칙 팩 모음 — **커뮤니티가 보고 따라 쓰라고** 두는 본보기다.
 *
 * 여기 있는 팩은 특별하지 않다. 누가 만든 팩이든 같은 해석기(rulePack.ts)를 통과하고
 * 같은 힘을 갖는다 — 그리고 어떤 팩도 코어 판정(coreVerdict)을 바꾸지 못한다.
 * 이 파일은 그저 "팩이란 이렇게 생겼다"를 보여 주는 곳이며, 쉬빌이 승인한 목록이
 * 아니다. 자기 팩을 만들어 쓰는 것이 이 기능의 목적이다.
 */
import type { RulePack } from '../rulePack';
import { STRICT_BUYER_PACK } from './strictBuyer';
import { WALK_ONLY_PACK } from './walkOnly';

export { STRICT_BUYER_PACK } from './strictBuyer';
export { WALK_ONLY_PACK } from './walkOnly';

/** 동봉된 예시 팩 전부. 기본으로 적용되지 않는다 — 쓰려면 직접 골라 넣어야 한다. */
export const EXAMPLE_RULE_PACKS: readonly RulePack[] = [STRICT_BUYER_PACK, WALK_ONLY_PACK];
