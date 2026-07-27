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

/**
 * ★2026-07-27 적대검증에서 잡힌 것 — **배포본은 멀쩡한데 공개본이 낡아 있었다.**
 *
 * `apps/web-list/public/checker.html`은 이 파일의 손복사본이고(verify/page.tsx 주석),
 * 실제로 마지막 복사 이후 두 번의 커밋을 놓쳐 **압축 지불 QR(SHV2.)을 못 읽는 감지기가
 * 사이트에 걸려 있었다.** 사람이 기억해야만 지켜지는 규칙은 지켜지지 않는다 —
 * 빌드 점검이 대신 기억한다.
 */
const 공개본 = new URL('../../apps/web-list/public/checker.html', import.meta.url);
try {
  const 사본 = readFileSync(공개본, 'utf8');
  if (사본 !== html) {
    console.error(
      '점검 실패: apps/web-list/public/checker.html 이 배포본과 다르다 (사이트에 낡은 감지기가 걸린다).\n' +
        '  고치는 법: cp "tools/checker/배포/쉬빌_위폐감지기.html" apps/web-list/public/checker.html',
    );
    process.exit(1);
  }
  console.log('공개 사본 일치: apps/web-list/public/checker.html');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  console.warn('주의: apps/web-list/public/checker.html 이 없다 — /checker.html 내려받기 버튼이 404가 된다.');
}

console.log('점검 통과');
