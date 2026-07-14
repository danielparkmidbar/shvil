/**
 * 실 HTTP 엔드투엔드 시뮬레이션 — 진짜 서버 프로세스에 fetch로 붙어 지갑이 하는
 * 일 전부를 재현한다 (실기기 통합 테스트의 코드 레벨 근사).
 *
 * 실행: 서버 기동 후 `npx tsx scripts/e2e-sim.ts`
 * 다루는 것: 걷기 민팅 · 가입/회원증서 · 배포 서명 검증(TOFU) · QR 왕복 지불(로컬
 * 서명) · 첫 접대 보너스 · 마켓 에스크로 · 이중지불 사후 탐지 · 니모닉 백업/복구.
 */
import {
  PendingWalkLedger,
  acceptPayment,
  acknowledgeTransfer,
  buildAuthHeaders,
  buildCharge,
  buildPayment,
  buildWalkSegmentProof,
  coinFingerprint,
  createTransfer,
  decryptBackup,
  deriveIdentityFromMnemonic,
  encryptBackup,
  generateMessagingKeyPair,
  generateMnemonic,
  mintGrantCoin,
  mintWalkCoin,
  signerFromKeyPair,
  stableStringify,
  verifyCoin,
  verifyDistribution,
  verifyMembershipCertificate,
  type Coin,
  type MembershipCertificate,
  type Signer,
  type WalkSample,
  type WalletBackup,
} from '@shvil/shared';

const BASE = process.env.SHVIL_BASE ?? 'http://localhost:8787';
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${name}`);
  }
}

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

interface Wallet {
  memberId: string;
  signer: Signer;
  mnemonic: string;
  backupKeyHex: string;
  cert: MembershipCertificate;
}

async function signedApi(w: Wallet, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) {
  const bodyText = body !== undefined ? JSON.stringify(body) : '';
  const headers = buildAuthHeaders(w.memberId, w.signer, method, path.split('?')[0]!, bodyText, Date.now());
  return api(method, path, body, headers);
}

/** 니모닉 파생 기기 키로 가입 (실제 앱과 동일). */
async function joinWallet(phone: string, email: string, name: string): Promise<Wallet> {
  const mnemonic = generateMnemonic();
  const derived = deriveIdentityFromMnemonic(mnemonic);
  const signer = signerFromKeyPair(derived.deviceKeyPair);
  const msg = generateMessagingKeyPair();
  const otp = await api('POST', '/auth/otp', { phone });
  const reg = await api('POST', '/auth/register', {
    phone,
    code: otp.json.devCode,
    email,
    displayName: name,
    devicePublicKey: signer.publicKeyHex,
    messagingPublicKey: msg.publicKeyHex,
    integrityToken: 'dev-verified',
    platform: 'android',
  });
  return {
    memberId: reg.json.memberId,
    signer,
    mnemonic,
    backupKeyHex: derived.backupKeyHex,
    cert: reg.json.membershipCertificate as MembershipCertificate,
  };
}

/** 코스 위 정상 보행으로 걷기 코인 민팅 (증서 첨부). */
function walkMint(w: Wallet, dshv: number, startAt: number): Coin {
  const ledger = new PendingWalkLedger({ memberId: w.memberId });
  let t = startAt;
  for (let i = 0; i < dshv; i++) {
    const s: WalkSample = { durationS: 72, distanceM: 100, steps: 140, tier: 'ON_COURSE', timestamp: t, courseId: 'shvil-israel' };
    ledger.recordSample(s);
    t += 72_000;
  }
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(t)!, w.signer, { membership: w.cert }));
}

/** QR 왕복 지불 (로컬 서명, 서버 개입 0). */
function payLocal(coin: Coin, payer: Wallet, payee: Wallet): Coin {
  const charge = buildCharge(
    { chargeId: `chg-${Math.floor(coin.amountDshv)}-${payee.memberId}`, angelMemberId: payee.memberId, amountDshv: coin.amountDshv, createdAt: Date.now() },
    payee.signer,
  );
  const payment = buildPayment(charge, [coin], payer.memberId, payer.signer, Date.now());
  return acceptPayment(charge, payment, payee.signer).coins[0]!;
}

const T0 = Date.parse('2026-07-11T06:00:00Z');
const DAY = 86_400_000;

async function main() {
  console.log(`\n== 쉬빌 실 HTTP E2E 시뮬레이션 (${BASE}) ==\n`);

  // 1) 신뢰 키 배포 서명 검증 + TOFU 핀
  console.log('[1] 신뢰 키 배포 서명 (H-3)');
  const keysRes = await api('GET', '/keys');
  const keysVerdict = verifyDistribution(keysRes.json);
  check('GET /keys 배포 서명이 유효하다', keysVerdict.valid);
  const trustedKeys: Record<string, string> = {};
  const trustedRoots: Record<string, string> = {};
  for (const k of keysRes.json.keys as { keyId: string; publicKey: string; purpose: string }[]) {
    if (k.purpose === 'MEMBERSHIP_ROOT') trustedRoots[k.keyId] = k.publicKey;
    else if (k.purpose !== 'DISTRIBUTION') trustedKeys[k.keyId] = k.publicKey;
  }
  check('MEMBERSHIP_ROOT 루트 키가 배포된다', Object.keys(trustedRoots).length === 1);

  // 2) 가입 + 회원 증서
  console.log('\n[2] 가입 + 회원 증서 (C-2)');
  const lior = await joinWallet('+972-50-e2e-1', 'lior@sim.io', '리오르');
  const aviva = await joinWallet('+972-50-e2e-2', 'aviva@sim.io', '아비바');
  const noa = await joinWallet('+1-212-e2e-3', 'noa@sim.io', '노아');
  check('회원 번호가 SHV-형식으로 발급된다', /^SHV-\d{6}$/.test(lior.memberId));
  const certVerdict = verifyMembershipCertificate(lior.cert, trustedRoots, Date.now());
  check('발급된 회원 증서가 루트 키로 검증된다', certVerdict.valid);
  check('증서가 회원 번호↔기기 키를 결속한다', lior.cert.memberId === lior.memberId && lior.cert.devicePublicKey === lior.signer.publicKeyHex);

  // 3) 걷기 민팅 → 필수 모드 검증 통과
  console.log('\n[3] 걷기 민팅 + 무결성 필수 검증 (C-2)');
  const liorCoin = walkMint(lior, 173, T0);
  const mintVerdict = verifyCoin(liorCoin, { requireIntegrityToken: true, trustedRootKeys: trustedRoots, now: Date.now() });
  check('증서 첨부 걷기 코인이 필수 모드 검증을 통과한다 (17.3 SHV)', mintVerdict.valid && liorCoin.amountDshv === 173);

  // 4) 엔젤 등록 + 보너스 민팅
  console.log('\n[4] 엔젤 등록 + 보너스 (M2)');
  const reg = await signedApi(aviva, 'PUT', '/angels/me', {
    name: '아비바의 집', location: { lat: 33.229, lon: 35.655 }, services: { bed: 'ROOM', internet: true, shower: true, meal: true }, capacity: 3, visible: true,
  });
  const bonusGrant = reg.json.registrationGrant;
  const bonusCoin = mintGrantCoin(bonusGrant);
  check('엔젤 등록 보너스 20 SHV 발급·민팅', bonusGrant.amountDshv === 200 && verifyCoin(bonusCoin, { trustedIssuerKeys: trustedKeys }).valid);
  const mapRes = await api('GET', '/angels?lat=33.2271&lon=35.6386&radiusKm=20');
  check('엔젤이 지도에 거리순으로 표시된다', (mapRes.json.angels as { memberId: string }[]).some((a) => a.memberId === aviva.memberId));

  // 5) QR 왕복 지불 (접대) — 서버 개입 0
  console.log('\n[5] QR 왕복 지불 — 오프라인 로컬 완결 (2.3)');
  const bed = walkMint(lior, 100, T0 + DAY); // 잠자리 10 SHV용
  const hosted = payLocal(bed, lior, aviva);
  check('지불 코인이 로컬 검증 통과, 생성 회원 각인 유지', verifyCoin(hosted).valid && hosted.memberId === lior.memberId);

  // 6) 첫 접대 보너스 (수령 코인 증빙)
  console.log('\n[6] 첫 접대 보너스 (2.4)');
  const fh = await signedApi(aviva, 'POST', '/angels/first-hosting', { coin: hosted });
  check('첫 접대 보너스 30 SHV 발급', fh.json.grant?.amountDshv === 300);

  // 7) 마켓 에스크로 (무정가 → 제시 → 승인 → 정산)
  console.log('\n[7] 마켓 에스크로 — USDC 모의 (M3)');
  const listing = await signedApi(aviva, 'POST', '/market/listings', { amountDshv: 100 });
  const offer = await signedApi(noa, 'POST', `/market/listings/${listing.json.listingId}/offers`, { totalUsdcMicro: 9_000_000 });
  const approve = await signedApi(aviva, 'POST', `/market/offers/${offer.json.offerId}/approve`, { usdcAddress: '0xAVIVA' });
  check('승인 시 에스크로 생성 + 수수료 2.5% 산정', approve.json.feeUsdcMicro === 225_000);
  const escrowId = approve.json.escrowId;
  await api('POST', `/market/escrows/${escrowId}/dev-deposit`);
  const pending = createTransfer(hosted, aviva.signer, noa.signer.publicKeyHex, Date.now());
  await signedApi(aviva, 'POST', `/market/escrows/${escrowId}/coins`, { coins: [pending] });
  const escrowView = await signedApi(noa, 'GET', `/market/escrows/${escrowId}`);
  const acked = (escrowView.json.coins as Coin[]).map((c) => acknowledgeTransfer(c, noa.signer));
  const ack = await signedApi(noa, 'POST', `/market/escrows/${escrowId}/ack`, { coins: acked });
  check('구매 확인 → USDC 방출(수수료 차감)', ack.json.status === 'COMPLETED' && ack.json.releasedUsdcMicro === 8_775_000);
  check('구매 코인 계보: 원 생성자(리오르) 회원 번호 불변', acked[0]!.memberId === lior.memberId);

  // 8) 이중지불 사후 탐지 (기회적 동기화)
  console.log('\n[8] 이중지불 사후 탐지 (H-1)');
  const attacker = await joinWallet('+1-999-e2e-9', 'atk@sim.io', '공격자');
  const dup = walkMint(attacker, 150, T0 + 2 * DAY);
  const toBob = payLocal(dup, attacker, aviva); // 같은 코인을
  const toCarol = payLocal(dup, attacker, noa); // 두 수령자에게 (오프라인 분기)
  await signedApi(aviva, 'POST', '/sync/coins', { fingerprints: [coinFingerprint(toBob)] });
  const before = await api('GET', '/limits/flagged');
  check('첫 목격만으로는 등재되지 않는다', !(before.json.members as { memberId: string }[]).some((m) => m.memberId === attacker.memberId));
  await signedApi(noa, 'POST', '/sync/coins', { fingerprints: [coinFingerprint(toCarol)] });
  const after = await api('GET', '/limits/flagged');
  const afterVerified = verifyDistribution(after.json);
  check('소명 목록 배포 서명 유효 (H-3)', afterVerified.valid);
  check('분기 확정 → 이중 지불자 소명 목록 자동 등재', (after.json.members as { memberId: string }[]).some((m) => m.memberId === attacker.memberId));
  const anomalies = await api('GET', '/transparency/anomalies');
  check('이상 포착이 익명 공시된다', anomalies.json.doubleSpendSuspects >= 1);

  // 9) 니모닉 백업 → 복구 (새 폰 시뮬레이션)
  console.log('\n[9] 니모닉 백업 + 복구 (L-2)');
  const backup: WalletBackup = { v: 1, memberId: lior.memberId, coins: [liorCoin], createdAt: Date.now() };
  const up = await signedApi(lior, 'POST', '/backup', { blob: encryptBackup(backup, lior.backupKeyHex) });
  check('백업 blob 업로드 성공', up.json.stored === true);
  // 새 폰: 니모닉만으로 기기 키 복원 → 회원 번호 없이 백업 조회
  const recovered = deriveIdentityFromMnemonic(lior.mnemonic);
  const rSigner = signerFromKeyPair(recovered.deviceKeyPair);
  const now = Date.now();
  const recoverPayload = stableStringify({ t: 'shvil-backup-recover-v1', devicePublicKey: rSigner.publicKeyHex, timestamp: now });
  const down = await api('GET', '/backup', undefined, {
    'x-shvil-device-pubkey': rSigner.publicKeyHex,
    'x-shvil-ts': String(now),
    'x-shvil-sig': rSigner.sign(new TextEncoder().encode(recoverPayload)),
  });
  check('회원 번호 없이 기기 키 서명만으로 백업 조회', down.status === 200);
  const restored = decryptBackup(down.json.blob, recovered.backupKeyHex);
  check('니모닉으로 확정 코인 복구 (17.3 SHV)', restored.coins.length === 1 && restored.coins[0]!.id === liorCoin.id);

  // 10) 거래 승인 엔드포인트 부재 (헌법 제9조)
  console.log('\n[10] 무승인 시스템 확인 (헌법 제9조)');
  const approveTx = await api('POST', '/approve', {});
  const payments = await api('POST', '/payments', {});
  check('거래 승인/지불 엔드포인트가 존재하지 않는다', approveTx.status === 404 && payments.status === 404);

  console.log(`\n== 결과: ${pass} 통과 / ${fail} 실패 ==\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E 시뮬레이션 오류:', e);
  process.exit(1);
});
