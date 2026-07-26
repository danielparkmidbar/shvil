/**
 * 오프라인 위폐 감지기 빌드 — 단일 HTML 파일 하나를 만든다.
 *
 * 결과물은 배포/쉬빌_위폐감지기.html 하나뿐이다. 이 파일 밖의 어떤 것도 필요하지 않다.
 * 레포에 이미 있는 esbuild를 쓴다 (추가 설치 없음).
 *
 * 실행: node tools/checker/build.mjs
 * 점검: node tools/checker/smoke.mjs
 */
import { build } from '../../node_modules/esbuild/lib/main.js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// ★'dist'·'build'는 레포 .gitignore에 걸린다 — 배포물은 커밋되어야 하므로 '배포'를 쓴다.
const dist = join(here, '배포');
mkdirSync(dist, { recursive: true });

const result = await build({
  entryPoints: [join(here, 'src/entry.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser', // ★node 조건을 쓰지 않게 한다 — node:crypto 가 딸려 들어오면 안 된다
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
});

const js = result.outputFiles[0].text;

// 인라인 전에 확인한다: 번들이 </script> 를 품고 있으면 HTML이 깨진다.
if (/<\/script/i.test(js)) throw new Error('번들에 </script 가 들어 있다 — 인라인 불가');

// 네트워크 통로가 번들에 남아 있지 않은지 스스로 검사한다 (빌드가 실패해야 한다).
const 금지 = [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /EventSource/, /importScripts/, /\brequire\s*\(/, /node:[a-z]/, /https?:\/\//];
for (const re of 금지) {
  if (re.test(js)) throw new Error(`번들에 금지 패턴이 있다: ${re}`);
}

const hash = createHash('sha256').update(js).digest('hex');
const html = readFileSync(join(here, 'shell.html'), 'utf8')
  .replace('__BUNDLE__', () => js)
  .replace('__BUNDLE_HASH__', hash)
  .replace('__BUILT_AT__', new Date().toISOString().slice(0, 10));

const out = join(dist, '쉬빌_위폐감지기.html');
writeFileSync(out, html, 'utf8');

const bytes = Buffer.byteLength(html, 'utf8');
console.log(`빌드 완료: ${out}`);
console.log(`  크기      ${(bytes / 1024).toFixed(1)} KB (${bytes} bytes)`);
console.log(`  JS 부분   ${(Buffer.byteLength(js, 'utf8') / 1024).toFixed(1)} KB`);
console.log(`  번들 지문 ${hash}`);
console.log(`  파일 지문 ${createHash('sha256').update(html).digest('hex')}`);
