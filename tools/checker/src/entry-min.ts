/** 최소 진입점 — checkAuthenticity 하나만. 번들 하한 크기 측정용. */
import { checkAuthenticity } from '../../../packages/shared/src/authenticity';

(globalThis as unknown as Record<string, unknown>)['ShvilChecker'] = { checkAuthenticity };
export { checkAuthenticity };
