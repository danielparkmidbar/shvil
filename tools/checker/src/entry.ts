/**
 * 오프라인 위폐 감지기 진입점 (재현 B 시제품).
 *
 * 이 파일이 번들의 뿌리다. 여기서 import 하는 것만 단일 HTML 안으로 들어간다.
 * 네트워크를 쓰는 코드는 한 줄도 없다 — fetch·XHR·WebSocket·외부 URL 전부 없음.
 */
import { checkAuthenticity, checkCoinAuthenticity } from '../../../packages/shared/src/authenticity';
import { parseCheckerInput } from '../../../packages/shared/src/checkerInput';
import { verifyCoin } from '../../../packages/shared/src/coin';
import { coinSerial } from '../../../packages/shared/src/serial';

// 전역에 노출한다 — HTML의 인라인 스크립트와 자동 점검 스크립트가 같이 쓴다.
const api = { checkAuthenticity, checkCoinAuthenticity, parseCheckerInput, verifyCoin, coinSerial };
(globalThis as unknown as Record<string, unknown>)['쉬빌감지기'] = api;
(globalThis as unknown as Record<string, unknown>)['ShvilChecker'] = api;

export { checkAuthenticity, checkCoinAuthenticity, parseCheckerInput, verifyCoin, coinSerial };
