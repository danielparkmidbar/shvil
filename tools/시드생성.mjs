#!/usr/bin/env node
/**
 * SHVIL_ROOT_SEED 생성기 — 한 번만 쓴다.
 *
 *   node tools/시드생성.mjs          시드를 새로 만든다
 *   node tools/시드생성.mjs --확인    이미 가진 시드를 붙여넣어 열쇠 이름을 다시 계산한다
 *
 * 출력된 64자 hex 한 줄이 이 화폐 배포의 **발행 권위 전체**다. 이 값에서 회원 증서 루트키,
 * 엔젤 보너스·클레임·격려·보물 발행키, 배포 서명키, 스팟 리저브 주소가 전부 결정적으로
 * 유도된다(packages/shared/src/keyDerivation.ts).
 *
 * ── ★왜 열쇠 이름·지문까지 같이 찍는가 (적대검증 2026-07-28 ⑤) ──────────
 * 시드를 대시보드에 붙여넣다가 **한 글자를 틀려도 서버는 정상 기동한다.** 길이가 64자면
 * 형식 검사를 통과하고, 다른 시드에서 다른 열쇠가 조용히 나온다. `/health`의
 * `keySource: SEED` 와 `warnings: []` 는 그 사고를 **잡지 못한다** — 오타 난 시드도
 * 훌륭한 시드이기 때문이다.
 *
 * 그래서 이 도구가 **종이에 함께 적을 값**을 찍는다. 넣은 뒤 `/health`의 값이 종이와
 * 같은지 보면 오타가 그 자리에서 드러난다. 같은 값이 폰의 「서버 열쇠」 화면에서
 * 지문 대조의 기준이 되기도 한다(그때는 전화·직접으로 전해야 한다).
 *
 * ★반드시 지킬 것
 *  1. 시드를 **종이에 적어** 안전한 곳에 둔다. 잃어버리면 되찾을 방법이 없다.
 *  2. 채팅·메일·저장소·스크린샷에 넣지 않는다. 새어 나가면 누구나 이 화폐를 발행할 수 있다.
 *  3. 넣을 곳은 Render 대시보드의 Environment 변수 `SHVIL_ROOT_SEED` 한 곳뿐이다.
 *  4. 이미 넣은 시드를 **바꾸지 않는다.** 바꾸는 것은 발행자를 갈아치우는 것과 같다.
 *
 * ★유도식은 규격(docs/쉬빌코인_규격.md 9.6)과 같아야 한다. 이 파일은 라이브러리를 쓰지 않고
 *   직접 계산하므로(운영자가 `node` 하나로 돌릴 수 있어야 하기 때문에) 어긋날 수 있다.
 *   `server/test/시드생성도구.test.ts`가 라이브러리 값과 대조해 그것을 막는다.
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

/** 규격 9.6 — 유도식 버전 문자열(salt이자 info 접두사). */
const SPEC = 'shvil-deployment-key/v1';

/** 규격 9.2/9.6 — 슬롯 슬러그. 이름은 이 슬러그 + 공개키 해시 앞 32 hex. */
const SLOTS = [
  ['MEMBERSHIP_ROOT', 'membership-root', '회원 증서 루트 (모든 회원 번호의 근거)'],
  ['ANGEL_BONUS', 'promo-angel', '엔젤 보너스 발행'],
  ['COMMUNITY_CLAIM', 'community-claim', '커뮤니티 클레임 발행'],
  ['COMMUNITY_REWARD', 'community-reward', '격려 코인 발행'],
  ['TREASURE', 'promo-treasure', '보물 발행'],
  ['DISTRIBUTION', 'distribution', '★배포 서명 (폰이 기억하는 바로 그 열쇠)'],
  ['SPOT_RESERVE', 'spot-reserve', '스팟 예치 리저브 주소 (소각 수령)'],
];

/** 시드 문자열 → IKM 바이트 (hex 64자면 그 32바이트, 아니면 UTF-8). */
export function normalizeSeed(seed) {
  const s = seed.trim();
  return /^[0-9a-fA-F]{64}$/.test(s) ? hexToBytes(s.toLowerCase()) : utf8ToBytes(s);
}

/** 규격 9.6 — 시드 + 슬롯 + 세대 → 공개키 hex. */
export function derivePublicKey(seed, slug, generation) {
  const secret = hkdf(sha256, normalizeSeed(seed), utf8ToBytes(SPEC), utf8ToBytes(`${SPEC}|${slug}|${generation}`), 32);
  return bytesToHex(ed25519.getPublicKey(secret));
}

/** 규격 9.2 I-1 — 이름 = 슬러그 + '-' + SHA256(공개키 32바이트) 앞 32 hex. */
export function keyIdOf(slug, publicKeyHex) {
  return `${slug}-${bytesToHex(sha256(hexToBytes(publicKeyHex))).slice(0, 32)}`;
}

/** 폰 화면·서버 /health와 같은 형식의 지문 (앞 16 hex, 4자씩, 대문자). */
export function fingerprint(publicKeyHex) {
  const head = publicKeyHex.slice(0, 16).toUpperCase();
  return `${head.slice(0, 4)} ${head.slice(4, 8)} ${head.slice(8, 12)} ${head.slice(12, 16)}`;
}

/** 시드 하나에서 나오는 전부 — 도구와 테스트가 같은 함수를 본다. */
export function summarize(seed, generation = 0) {
  return SLOTS.map(([slot, slug, 설명]) => {
    const publicKey = derivePublicKey(seed, slug, generation);
    return {
      slot,
      slug,
      설명,
      publicKey,
      // SPOT_RESERVE는 코인 발행 용도가 아니어서 /keys에 실리지 않는다 — 이름도 없다.
      keyId: slot === 'SPOT_RESERVE' ? null : keyIdOf(slug, publicKey),
      fingerprint: fingerprint(publicKey),
    };
  });
}

function 출력(seed, generation) {
  const rows = summarize(seed, generation);
  const dist = rows.find((r) => r.slot === 'DISTRIBUTION');
  const root = rows.find((r) => r.slot === 'MEMBERSHIP_ROOT');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' ① 이 한 줄이 시드입니다 — 종이에 적으세요');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  SHVIL_ROOT_SEED = ${seed}`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' ② ★이 두 줄도 같은 종이에 적으세요 — 확인할 때 씁니다');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  배포 열쇠 이름 : ${dist.keyId}`);
  console.log(`  배포 열쇠 지문 : ${dist.fingerprint}`);
  console.log('');
  console.log('  Render에 넣은 뒤 https://shvil-directory.onrender.com/health 를 열어');
  console.log('  distKeyId 와 distKeyFingerprint 가 위 두 줄과 **같은지** 보세요.');
  console.log('  다르면 붙여넣기가 잘못된 것입니다 (한 글자만 틀려도 다른 값이 나오는데,');
  console.log('  서버는 그래도 정상으로 보입니다 — 그래서 이 대조가 유일한 확인 방법입니다).');
  console.log('');
  console.log('  폰에 "서버 열쇠가 바뀌었습니다" 화면이 뜨면, 거기 보이는 지문이');
  console.log('  위 「배포 열쇠 지문」과 같을 때만 받으라고 알려 주세요.');
  console.log('');
  console.log('───────────────────────────────────────────────────────────');
  console.log(` 참고: 이 시드에서 나오는 열쇠 전부 (세대 ${generation})`);
  console.log('───────────────────────────────────────────────────────────');
  for (const r of rows) {
    console.log(`  ${r.설명}`);
    console.log(`    ${r.keyId ?? '(이름 없음 — 주소로만 쓰임)'}`);
    console.log(`    지문 ${r.fingerprint}`);
  }
  console.log('');
  console.log('★ 시드는 채팅·메일·사진·스크린샷에 넣지 마세요. 잃어버리면 되찾을 수 없습니다.');
  console.log(`★ 루트 열쇠 이름: ${root.keyId}`);
  console.log('');
}

async function main() {
  const 확인모드 = process.argv.includes('--확인') || process.argv.includes('--verify');
  if (!확인모드) {
    출력(randomBytes(32).toString('hex'), 0);
    return;
  }
  // ★시드를 명령줄 인자로 받지 않는다 — 명령어 기록에 남기 때문이다. 붙여넣기로만 받는다.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const seed = await new Promise((resolve) => {
    rl.question('종이에 적어 둔 시드를 붙여넣고 Enter: ', (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
  if (seed.length < 32) {
    console.error('\n시드가 너무 짧습니다 (최소 32자). 다시 확인해 주세요.\n');
    process.exitCode = 1;
    return;
  }
  const g = Number(process.env.SHVIL_KEY_GENERATION ?? '0');
  출력(seed, Number.isInteger(g) && g >= 0 ? g : 0);
}

// 라이브러리로 불러 쓸 때(테스트)는 실행하지 않는다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
