/**
 * 실 HTTP 엔드투엔드 시뮬레이션 — 진짜 서버 프로세스에 fetch로 붙어 지갑이 하는
 * 일 전부를 재현한다 (실기기 통합 테스트의 코드 레벨 근사).
 *
 * 실행: 서버 기동 후 `npx tsx scripts/e2e-sim.ts`
 * 다루는 것: 걷기 민팅 · 가입/회원증서 · 배포 서명 검증(TOFU) · QR 왕복 지불(로컬
 * 서명) · 첫 접대 보너스 · 마켓 에스크로 · 이중지불 사후 탐지 · 니모닉 백업/복구 ·
 * 예약 왕복(M6 — E2E 신청→승인→정확 위치 전달, 서버는 암호문만) ·
 * 보물 마이닝 왕복(M9 — 폰 로컬 몸 인증 → 클레임 → 민팅 → 중복 거부).
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
  newBookingRequestId,
  openMessage,
  parseBookingPayload,
  sealMessage,
  serializeBookingPayload,
  signerFromKeyPair,
  snapToPrivacyGrid,
  stableStringify,
  treasureTranscriptHash,
  verifyCoin,
  verifyDistribution,
  verifyLeg,
  verifyMembershipCertificate,
  type BookingReplyPayload,
  type BookingRequestPayload,
  type Coin,
  type MembershipCertificate,
  type MessageEnvelope,
  type LegTranscript,
  type MessagingKeyPair,
  type Signer,
  type SignedGrant,
  type TreasureSpec,
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
  /** E2E 메신저 키쌍 — 예약 왕복(M6)에서 봉인·개봉에 쓴다. */
  msg: MessagingKeyPair;
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
    msg,
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
  // 잠자리 복수 선택 (2026-07-15): beds = 유형별 인원, bed·capacity는 파생값(호환).
  const reg = await signedApi(aviva, 'PUT', '/angels/me', {
    name: '아비바의 집', location: { lat: 33.229, lon: 35.655 }, services: { bed: 'ROOM', internet: true, shower: true, meal: true, beds: { room: 2, sofa: 1 } }, capacity: 3, visible: true,
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

  // 10) 예약 왕복 (M6) — E2E 신청 → 승인 → 정확 위치 전달. 서버는 암호문만 중계한다.
  console.log('\n[10] 예약 왕복 — 신청→승인→정확 위치 E2E 전달 (M6)');
  const AVIVA_PROFILE = {
    name: '아비바의 집',
    location: { lat: 33.229, lon: 35.655 },
    services: { bed: 'ROOM', internet: true, shower: true, meal: true },
    capacity: 3,
    visible: true,
  };
  // R-3: 가능 여부 자발 공개 — 서버가 아는 것은 이 수준뿐.
  await signedApi(aviva, 'PUT', '/angels/me', { ...AVIVA_PROFILE, available: false });
  const dirOff = await api('GET', '/angels');
  const angelOff = (dirOff.json.angels as { memberId: string; available: boolean; availabilityUpdatedAt: number | null }[]).find(
    (a) => a.memberId === aviva.memberId,
  );
  check('가능 여부(지금은 어려움)가 갱신 시각과 함께 공개된다 (R-3)', angelOff?.available === false && typeof angelOff?.availabilityUpdatedAt === 'number');
  await signedApi(aviva, 'PUT', '/angels/me', { ...AVIVA_PROFILE, available: true });
  const dirOn = await api('GET', '/angels');
  const angelOn = (dirOn.json.angels as { memberId: string; available: boolean; location: { lat: number; lon: number }; messagingPublicKey: string }[]).find(
    (a) => a.memberId === aviva.memberId,
  )!;
  check('가능으로 되돌리기가 반영된다 (엔젤의 자율)', angelOn.available === true);

  // 신청 (리오르 → 아비바): 디렉토리에서 얻은 메시징 공개키로 E2E 봉인.
  const bookingRequest: BookingRequestPayload = {
    kind: 'BOOKING_REQUEST',
    requestId: newBookingRequestId(),
    dates: { fromDate: '2026-07-20', toDate: '2026-07-21' },
    partySize: 2,
    note: '북쪽에서 이틀째 걷고 있습니다',
    profile: { displayName: '리오르', memberSince: '2026-05', journeyLine: '쉬빌 북부 구간 걷는 중' },
  };
  const reqEnvelope = sealMessage({
    plaintext: serializeBookingPayload(bookingRequest),
    fromMemberId: lior.memberId,
    toMemberId: aviva.memberId,
    senderMsgKeyPair: lior.msg,
    recipientMsgPublicKey: angelOn.messagingPublicKey,
    deviceSigner: lior.signer,
    now: Date.now(),
  });
  check('신청 봉투(서버가 보는 전부)에 평문·프로필이 없다', !JSON.stringify(reqEnvelope).includes('BOOKING_REQUEST') && !JSON.stringify(reqEnvelope).includes('리오르'));
  await signedApi(lior, 'POST', '/messages', { envelope: reqEnvelope });

  // 엔젤 수신함: 복호화 → 구조화 메시지 판별 (파싱 실패면 일반 텍스트 폴백).
  const avivaInbox = await signedApi(aviva, 'GET', '/messages?sinceId=0');
  const reqEnv = (avivaInbox.json.messages as { envelope: MessageEnvelope }[])
    .map((m) => m.envelope)
    .filter((e) => e.fromMemberId === lior.memberId)
    .pop()!;
  const openedReq = openMessage(reqEnv, aviva.msg);
  const parsedReq = parseBookingPayload(openedReq.plaintext);
  check(
    '엔젤 지갑이 신청을 복호화·파싱한다 (날짜·인원·첨부 프로필)',
    openedReq.signatureValid &&
      parsedReq?.kind === 'BOOKING_REQUEST' &&
      parsedReq.partySize === 2 &&
      parsedReq.profile.displayName === '리오르',
  );

  // 승인 회신 — 정확한 위치(서버는 모르는 좌표)·주소를 첨부해 이 손님에게만 (R-4).
  const PRECISE = { lat: 33.22947, lon: 35.65513 };
  const bookingReply: BookingReplyPayload = {
    kind: 'BOOKING_REPLY',
    requestId: bookingRequest.requestId,
    decision: 'APPROVED',
    note: '기다릴게요',
    preciseLocation: PRECISE,
    addressText: '마을 어귀 파란 대문 집',
    contact: '+972-50-000-0000',
  };
  const repEnvelope = sealMessage({
    plaintext: serializeBookingPayload(bookingReply),
    fromMemberId: aviva.memberId,
    toMemberId: lior.memberId,
    senderMsgKeyPair: aviva.msg,
    recipientMsgPublicKey: reqEnv.senderMsgPublicKey, // 신청 봉투에서 얻은 상대 키
    deviceSigner: aviva.signer,
    now: Date.now(),
  });
  check('승인 봉투에도 정확 위치·주소가 드러나지 않는다', !JSON.stringify(repEnvelope).includes('33.22947') && !JSON.stringify(repEnvelope).includes('파란 대문'));
  await signedApi(aviva, 'POST', '/messages', { envelope: repEnvelope });

  const liorInbox = await signedApi(lior, 'GET', '/messages?sinceId=0');
  const repEnv = (liorInbox.json.messages as { envelope: MessageEnvelope }[])
    .map((m) => m.envelope)
    .filter((e) => e.fromMemberId === aviva.memberId)
    .pop()!;
  const parsedRep = parseBookingPayload(openMessage(repEnv, lior.msg).plaintext);
  check(
    '신청자가 승인과 정확한 위치·주소를 받았다 (승인된 두 사람 사이에만)',
    parsedRep?.kind === 'BOOKING_REPLY' &&
      parsedRep.decision === 'APPROVED' &&
      parsedRep.preciseLocation?.lat === PRECISE.lat &&
      parsedRep.addressText === '마을 어귀 파란 대문 집',
  );
  // R-4 재확인: 디렉토리가 공개하는 좌표는 눈금화된 대략 위치 — 정확 위치와 다르다.
  const snapped = snapToPrivacyGrid(AVIVA_PROFILE.location.lat, AVIVA_PROFILE.location.lon);
  check(
    '서버 디렉토리 좌표는 ~1km 눈금 — 정확한 집 위치를 서버는 모른다 (R-4)',
    angelOn.location.lat === snapped.lat && angelOn.location.lon === snapped.lon && angelOn.location.lat !== PRECISE.lat,
  );

  // 11) 보물 마이닝 (M9) — 등록→목록→폰 로컬 몸 인증→클레임→민팅→중복 거부.
  //     서버로 가는 것은 treasureId + 성공 요약 해시뿐 — 이동 검증은 100% 폰 로컬이다.
  console.log('\n[11] 보물 마이닝 — 몸 인증 왕복 (M9)');
  const treasureSpec: TreasureSpec = {
    treasureId: `promo-e2e-${Date.now()}`,
    regionId: 'israel-national',
    zone: { center: { lat: 33.229, lon: 35.652 }, radiusM: 60 },
    amountDshv: 50,
    totalCount: 5,
    validFrom: Date.now() - 1000,
    validUntil: Date.now() + DAY,
    legs: [
      { dir: 'N', steps: 10 },
      { dir: 'E', steps: 30 },
      { dir: 'S', steps: 3 },
    ],
  };
  const treReg = await api('POST', '/treasures', { spec: treasureSpec });
  check('개발 시드로 보물 등록', treReg.json.registered === true);
  const treList = await api('GET', '/treasures?region=israel-national');
  const treFound = (treList.json.treasures as (TreasureSpec & { remaining: number })[]).find(
    (t) => t.treasureId === treasureSpec.treasureId,
  );
  check(
    '보물 목록 배포 서명 유효 + 지시 포함 (존에 가야 의미 있음)',
    verifyDistribution(treList.json).valid && treFound?.legs.length === 3 && treFound.remaining === 5,
  );
  // 폰 로컬 몸 인증: 지시대로 움직인 상대 변위(보폭 0.7 m 가정)를 verifyLeg로 판정.
  const DIR_VEC: Record<string, [number, number]> = { N: [1, 0], E: [0, 1], S: [-1, 0], W: [0, -1] };
  const transcript: LegTranscript[] = [];
  let allLegsOk = true;
  for (const leg of treFound!.legs) {
    const [n, e] = DIR_VEC[leg.dir]!;
    const d = leg.steps * 0.7;
    if (!verifyLeg(n * d, e * d, leg.steps, leg).ok) allLegsOk = false;
    transcript.push({ dir: leg.dir, steps: leg.steps, measuredSteps: leg.steps });
  }
  check('이동 검증이 전부 폰 로컬에서 완결된다 (서버 개입 0)', allLegsOk);
  check('방향이 틀리면 로컬 판정이 실패한다 (몸 인증 보안)', !verifyLeg(-21, 0, 30, { dir: 'N', steps: 30 }).ok);
  const treHash = treasureTranscriptHash(treasureSpec.treasureId, lior.memberId, transcript);
  const treClaim = await signedApi(lior, 'POST', '/treasures/claim', {
    treasureId: treasureSpec.treasureId,
    transcriptHash: treHash,
  });
  const treGrant = treClaim.json.grant as SignedGrant;
  check('클레임 → TREASURE 승인서 발행 (5 SHV)', treClaim.status === 200 && treGrant?.kind === 'TREASURE' && treGrant.amountDshv === 50);
  const treCoin = mintGrantCoin(treGrant);
  check(
    '폰 민팅 코인이 검증 통과 + 잔액 반영 (BONUS 계보 — 걸음 코인과 구분)',
    verifyCoin(treCoin, { trustedIssuerKeys: trustedKeys }).valid && treCoin.amountDshv === 50 && treCoin.memberId === lior.memberId,
  );
  const treDup = await signedApi(lior, 'POST', '/treasures/claim', {
    treasureId: treasureSpec.treasureId,
    transcriptHash: treHash,
  });
  check('중복 클레임 거부 (1인 1회, 에러 코드)', treDup.status === 409 && treDup.json.error === 'TREASURE_ALREADY_CLAIMED');
  const promoT = await api('GET', '/transparency/promo');
  check('투명성 공시에 보물 발행·총량 집계 (T-3)', promoT.json.treasureIssued >= 1 && promoT.json.treasureQuota >= 5);

  // 12) 거래 승인 엔드포인트 부재 (헌법 제9조)
  console.log('\n[12] 무승인 시스템 확인 (헌법 제9조)');
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
