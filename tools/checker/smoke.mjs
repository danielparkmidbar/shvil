/**
 * 시제품 점검 — **실제로 배포될 dist/쉬빌_위폐감지기.html 그 파일**을 검사한다.
 *
 * 1. HTML 안에 인라인된 스크립트를 꺼낸다 (다른 파일을 읽지 않는다 = 자족성 증명).
 * 2. 네트워크·노드 API가 **아예 없는** 샌드박스에서 돌린다.
 *    fetch·XMLHttpRequest·WebSocket·require·process·Buffer·fs·crypto 전부 부재.
 * 3. 정직한 코인과 위조 코인의 판정을 확인한다.
 *
 * 여기서 판정이 나오면 비행기 모드 브라우저에서도 나온다.
 * 실행: node tools/checker/smoke.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./배포/쉬빌_위폐감지기.html', import.meta.url), 'utf8');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/표본.json', import.meta.url), 'utf8'));

// HTML 안의 첫 <script> — 감지기 본체. 이것 말고 아무 파일도 읽지 않는다.
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('HTML 안에서 인라인 스크립트를 찾지 못했다');
const bundle = m[1];

// 외부 리소스 참조가 하나도 없어야 한다.
const 외부참조 = html.match(/\ssrc=|\shref=|url\(|@import|https?:\/\//g);
if (외부참조) throw new Error('외부 리소스 참조가 남아 있다: ' + 외부참조.join(', '));

// 의도적으로 빈약한 전역 — 브라우저 표준 전역만, 네트워크 통로는 하나도 없다.
const sandbox = { TextEncoder, TextDecoder };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(bundle, sandbox, { filename: 'shvil-checker.js' });

const api = sandbox.ShvilChecker;
if (!api) throw new Error('번들이 전역을 노출하지 못했다');

const NOW = Date.parse('2026-07-26T12:00:00Z');
const 결과 = [];
for (const [이름, 묶음] of Object.entries(fixture)) {
  const { coins } = api.parseCheckerInput(JSON.stringify(묶음));
  const r = api.checkAuthenticity(coins, { now: NOW });
  결과.push({ 이름, verdict: r.verdict, findings: r.findings.map((f) => `${f.severity}:${f.check}`) });
}

console.log('샌드박스 전역:', Object.keys(sandbox).sort().join(', '));
console.log('HTML 크기:', (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1), 'KB');
console.log('외부 리소스 참조: 0');
for (const r of 결과) console.log(` ${r.이름} → ${r.verdict} ${JSON.stringify(r.findings)}`);

const 정직 = 결과.find((r) => r.이름 === '정직');
const 위조 = 결과.find((r) => r.이름 === '위조');
if (정직?.verdict !== 'AUTHENTIC' || 위조?.verdict !== 'FORGED') {
  console.error('점검 실패');
  process.exit(1);
}
console.log('점검 통과');
