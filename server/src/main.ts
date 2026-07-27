import { buildApp } from './app';

const PORT = Number(process.env.PORT ?? 8787);

// 보안 감사 C-1: dev 라우트(OTP 코드 반환·dev-deposit·소명 수동 등재)는
// SHVIL_DEV_MODE=1을 명시할 때만 켜진다. 운영 기본은 꺼짐.
const devMode = process.env.SHVIL_DEV_MODE === '1';

// 보안 감사 H-2: 운영에서는 발행 개인키 봉인용 KEK가 필수다. buildApp이
// resolveKek로 검사하지만, 기동 시점에 명확한 안내를 남긴다.
if (!devMode && !process.env.SHVIL_KEK) {
  console.error('SHVIL_KEK 환경변수가 필요합니다 (발행 개인키 봉인용). 운영 기동을 중단합니다.');
  process.exit(1);
}

/**
 * ★루트 시드 관문 (2026-07-27) — **조용히 무작위 키를 만드는 것을 여기서 막는다.**
 *
 * ── 왜 이 관문이 필요한가 ────────────────────────────────────────────
 * 이번 사고는 "서버가 재배포될 때마다 새 발행자가 되었는데 아무도 몰랐다"이다. 원인은
 * 실패가 **조용했던 것**이다. `SealedKeystore`는 키가 없으면 만들었고, 만들었다는 사실이
 * 어디에도 남지 않았다. 그래서 관문을 둔다.
 *
 * ── 왜 devMode와 무관하게 거는가 ─────────────────────────────────────
 * 지금 Render에는 `SHVIL_DEV_MODE=1`이 켜져 있다(닫힌 시험 중 OTP 코드가 필요해서다).
 * 관문을 devMode에 걸면 **정작 살아 있는 운영 인스턴스에서 관문이 안 걸린다.** 두 플래그는
 * 다른 것을 뜻한다 — devMode는 "dev 라우트를 여는가", 시드는 "이 배포가 영속하는가".
 *
 * ── 왜 고정 개발용 시드를 쓰지 않는가 ───────────────────────────────
 * 코드에 박힌 개발용 시드를 devMode 폴백으로 두면, `SHVIL_DEV_MODE=1`인 **지금의 운영
 * 인스턴스가 공개된 시드로 화폐를 발행**하게 된다. 누구나 저장소를 보고 발행 개인키를
 * 계산할 수 있다는 뜻이다. KEK의 `DEV_FALLBACK_KEK`은 봉인만 약해질 뿐이지만, 시드는
 * **발행 권위 자체**다 — 같은 패턴을 쓰면 안 된다.
 *
 * ── 그래서 정책 (권고안) ─────────────────────────────────────────────
 *  1. `SHVIL_ROOT_SEED`가 있으면 → 결정적 유도. 재배포해도 같은 키.
 *  2. 없고 `SHVIL_ALLOW_EPHEMERAL_KEYS=1`도 없으면 → **기동 거부.**
 *  3. 없지만 옵트아웃을 명시했으면 → 예전 동작(무작위) + 대형 경고 + `/health` 노출.
 *
 * 기동 거부가 안전한 이유: **0층("설치하고 걸으면 끝")은 서버를 한 번도 부르지 않는다.**
 * 서버가 안 떠도 걷기·정산·민팅·QR 대면 지불·수령은 그대로 된다. 그리고 Render는 새
 * 배포가 뜨지 못하면 **직전 배포를 계속 서비스**하므로, 관문에 걸린 배포가 서비스를
 * 끊지도 않는다. 반대로 조용한 재키잉은 되돌릴 수 없다 — 비대칭이 명백하다.
 */
if (!process.env.SHVIL_ROOT_SEED?.trim()) {
  const allowEphemeral = process.env.SHVIL_ALLOW_EPHEMERAL_KEYS === '1';
  if (!allowEphemeral) {
    console.error(
      '\n★ SHVIL_ROOT_SEED 환경변수가 없습니다 — 기동을 중단합니다.\n' +
        '\n' +
        '  없이 뜨면 이 서버는 발행 키를 새로 만들고, 재배포·재시작 때마다 다른\n' +
        '  발행자가 됩니다. 이미 설치된 지갑은 코스·신뢰 키·소명 목록 갱신이\n' +
        '  재설치 전까지 영구히 끊깁니다(배포 키 TOFU 핀 불일치).\n' +
        '\n' +
        '  ▸ 시드 만들기 (한 번만):  node tools/시드생성.mjs\n' +
        '  ▸ 넣을 곳: Render 대시보드 → 이 서비스 → Environment → Add Environment Variable\n' +
        '      Key   = SHVIL_ROOT_SEED\n' +
        '      Value = 생성한 64자 hex\n' +
        '  ▸ ★그 값을 종이에 적어 보관하세요. 잃어버리면 이 화폐의 발행 권위가\n' +
        '    영구히 사라집니다(옛 코인은 그대로 살아 있지만, 새 발행과 배포 갱신이\n' +
        '    옛 지갑에서 다시는 신뢰받지 못합니다).\n' +
        '\n' +
        '  (그래도 시드 없이 띄우려면 SHVIL_ALLOW_EPHEMERAL_KEYS=1 — 권장하지 않습니다.)\n',
    );
    process.exit(1);
  }
  console.warn(
    '★ SHVIL_ALLOW_EPHEMERAL_KEYS=1 — 시드 없이 기동합니다. 재배포하면 발행 키가 전부 바뀝니다.',
  );
}

const app = buildApp({ dbPath: process.env.SHVIL_DB ?? 'shvil-directory.db', devMode });

/**
 * ★선택 관문 — **시드 오타를 기계가 잡는다** (적대검증 2026-07-28 ⑤).
 *
 * 시드를 대시보드에 붙여넣다가 한 글자를 틀려도 서버는 **정상 기동한다.** 길이만 맞으면
 * 그것도 훌륭한 시드이기 때문이다. `keySource: SEED`도, `warnings: []`도 그 사고를
 * 잡지 못한다 — 그리고 폰에서 보이는 증상은 중간자 공격과 **똑같다**("서버 열쇠가
 * 바뀌었습니다"). 즉 조용한 사고 하나가 가장 무서운 화면을 띄운다.
 *
 * `SHVIL_EXPECT_DIST_KEY_ID`에 종이에 적어 둔 배포 열쇠 이름을 넣어 두면, 유도 결과가
 * 그것과 다를 때 **기동을 거부**한다. 이 값은 비밀이 아니다(누구나 `/keys`에서 본다) —
 * 새는 것이 없고, 사람이 눈으로 대조하는 절차를 기계가 대신한다.
 *
 * 넣지 않아도 된다. 그때는 다니엘 쌤이 `/health`의 `distKeyId`·`distKeyFingerprint`를
 * 종이와 대조하는 것이 유일한 확인 방법이다(docs/Render_설정_절차.md 4단계).
 */
const expectDistKeyId = process.env.SHVIL_EXPECT_DIST_KEY_ID?.trim();
if (expectDistKeyId && expectDistKeyId !== app.keyIds.distribution) {
  console.error(
    '\n★ 배포 열쇠 이름이 예상과 다릅니다 — 기동을 중단합니다.\n' +
      '\n' +
      `  종이에 적힌 값 (SHVIL_EXPECT_DIST_KEY_ID): ${expectDistKeyId}\n` +
      `  지금 시드에서 나온 값                    : ${app.keyIds.distribution}\n` +
      '\n' +
      '  ▸ 시드를 붙여넣을 때 한 글자가 빠지거나 더 붙었을 가능성이 가장 큽니다.\n' +
      '    Render → Environment → SHVIL_ROOT_SEED 를 종이와 다시 대조하세요.\n' +
      '  ▸ 세대를 올리셨다면(SHVIL_KEY_GENERATION) 이름이 바뀌는 것이 정상입니다.\n' +
      '    그때는 `node tools/시드생성.mjs --확인`으로 새 이름을 뽑아 이 값을 고치세요.\n',
  );
  process.exit(1);
}

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() =>
    console.log(
      `쉬빌 디렉토리 서버 — http://localhost:${PORT} (거래 승인 기능 없음)` +
        (devMode ? ' [DEV MODE — 운영 배포 금지]' : ''),
    ),
  )
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
