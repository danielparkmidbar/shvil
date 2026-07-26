/**
 * M2 완료 기준 통합 테스트 (지시서 7장):
 * 엔젤 등록 → 지도 표시 → 채팅 → 접대 → 수령 → 보너스 민팅 전 과정.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PendingWalkLedger,
  acceptPayment,
  buildAuthHeaders,
  buildCharge,
  buildPayment,
  buildWalkSegmentProof,
  generateKeyPair,
  generateMessagingKeyPair,
  mintGrantCoin,
  mintWalkCoin,
  openMessage,
  sealMessage,
  signerFromKeyPair,
  splitCoin,
  verifyCoin,
  verifyGrant,
  type Coin,
  type MessageEnvelope,
  type MessagingKeyPair,
  type Signer,
  type SignedGrant,
  type WalkSample,
} from '@shvil/shared';
import { buildApp } from '../src/app';

const T0 = Date.parse('2026-07-10T06:00:00Z');
const app = buildApp({ dbPath: ':memory:', registrationQuota: 500, devMode: true });

interface TestIdentity {
  memberId: string;
  signer: Signer;
  msg: MessagingKeyPair;
}

async function register(phone: string, email: string, displayName: string): Promise<TestIdentity> {
  const signer = signerFromKeyPair(generateKeyPair());
  const msg = generateMessagingKeyPair();
  const otpRes = await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone } });
  const { devCode } = otpRes.json() as { devCode: string };
  const regRes = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      phone,
      code: devCode,
      email,
      displayName,
      devicePublicKey: signer.publicKeyHex,
      messagingPublicKey: msg.publicKeyHex,
    },
  });
  expect(regRes.statusCode).toBe(200);
  const { memberId } = regRes.json() as { memberId: string };
  return { memberId, signer, msg };
}

async function signedInject(
  who: TestIdentity,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  body?: unknown,
) {
  const path = url.split('?')[0]!;
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  const headers = {
    ...buildAuthHeaders(who.memberId, who.signer, method, path, bodyText, Date.now()),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
  };
  return app.inject({ method, url, headers, ...(body !== undefined ? { payload: bodyText } : {}) });
}

/** 정상 보행 샘플로 코스 위 걷기를 잠정 누적 → 정산 → 민팅. */
function mintWalkCoinFor(who: TestIdentity, km: number): Coin {
  const ledger = new PendingWalkLedger({ memberId: who.memberId });
  const windows = Math.round(km * 10);
  let t = T0;
  for (let i = 0; i < windows; i++) {
    const sample: WalkSample = {
      durationS: 72,
      distanceM: 100,
      steps: 140,
      tier: 'ON_COURSE',
      timestamp: t,
      courseId: 'shvil-israel',
    };
    const verdict = ledger.recordSample(sample);
    if (!verdict.accepted) throw new Error('sample rejected');
    t += 72_000;
  }
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(t)!, who.signer));
}

let aviva: TestIdentity; // 엔젤
let lior: TestIdentity; // 리스트
let promoKey: { keyId: string; publicKey: string };
let avivaCoins: Coin[] = [];

beforeAll(async () => {
  await app.ready();
  aviva = await register('+972-50-111-2222', 'aviva@example.org', '아비바');
  lior = await register('+972-52-333-4444', 'lior@example.org', '리오르');
  promoKey = (await app.inject({ method: 'GET', url: '/keys/promo' })).json() as typeof promoKey;
});

afterAll(async () => {
  await app.close();
});

describe('가입 — 의무 정보는 전화 OTP + 이메일뿐 (지시서 2.1)', () => {
  it('회원 번호가 발급된다 (SHV-6자리)', () => {
    expect(aviva.memberId).toMatch(/^SHV-\d{6}$/);
    expect(lior.memberId).toMatch(/^SHV-\d{6}$/);
    expect(aviva.memberId).not.toBe(lior.memberId);
  });

  it('잘못된 OTP는 거부된다', async () => {
    await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone: '+82-10-0000-0000' } });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        phone: '+82-10-0000-0000',
        code: '000000',
        email: 'x@example.org',
        devicePublicKey: 'aa',
        messagingPublicKey: 'bb',
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('엔젤 등록 → 지도 표시 → 등록 보너스', () => {
  it('서명 인증 없이 엔젤 등록은 불가', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/angels/me',
      payload: { name: 'x', location: { lat: 33.229, lon: 35.655 } },
    });
    expect(res.statusCode).toBe(401);
  });

  it('엔젤 등록 시 등록 보너스 grant(20 SHV)가 1회 발급되고 폰에서 민팅된다', async () => {
    const res = await signedInject(aviva, 'PUT', '/angels/me', {
      name: '아비바의 집',
      location: { lat: 33.229, lon: 35.655 },
      services: { bed: 'ROOM', internet: true, shower: true, meal: true },
      capacity: 3,
      conditions: null,
      visible: true,
    });
    expect(res.statusCode).toBe(200);
    const { registrationGrant } = res.json() as { registrationGrant: SignedGrant };
    expect(registrationGrant).toBeDefined();
    expect(registrationGrant.amountDshv).toBe(200); // 등록 20 SHV
    expect(verifyGrant(registrationGrant)).toBe(true);

    // 엔젤 폰에서 민팅 → 로컬 검증 (신뢰 발행 키 목록 사용)
    const bonusCoin = mintGrantCoin(registrationGrant);
    const verdict = verifyCoin(bonusCoin, { trustedIssuerKeys: { [promoKey.keyId]: promoKey.publicKey } });
    expect(verdict.valid).toBe(true);
    avivaCoins.push(bonusCoin);

    // 프로필 갱신을 반복해도 보너스는 다시 나오지 않는다
    const again = await signedInject(aviva, 'PUT', '/angels/me', {
      name: '아비바의 집',
      location: { lat: 33.229, lon: 35.655 },
      services: { bed: 'ROOM', internet: true, shower: true, meal: true },
      visible: true,
    });
    expect((again.json() as { registrationGrant?: SignedGrant }).registrationGrant).toBeUndefined();
  });

  it('지도 조회: 코스 근처에서 거리순으로 보인다', async () => {
    const res = await app.inject({ method: 'GET', url: '/angels?lat=33.2271&lon=35.6386&radiusKm=20' });
    const { angels } = res.json() as { angels: { memberId: string; name: string; distanceKm: number; services: { bed: string } }[] };
    const found = angels.find((a) => a.memberId === aviva.memberId);
    expect(found).toBeDefined();
    expect(found!.name).toBe('아비바의 집');
    expect(found!.services.bed).toBe('ROOM');
    expect(found!.distanceKm).toBeLessThan(5);
  });

  it('비공개 전환(엔젤의 자율성)은 즉시 지도에서 사라진다', async () => {
    await signedInject(aviva, 'PUT', '/angels/me', {
      name: '아비바의 집',
      location: { lat: 33.229, lon: 35.655 },
      services: { bed: 'ROOM' },
      visible: false,
    });
    const hidden = await app.inject({ method: 'GET', url: '/angels' });
    expect((hidden.json() as { angels: { memberId: string }[] }).angels.some((a) => a.memberId === aviva.memberId)).toBe(false);
    // 되돌리기
    await signedInject(aviva, 'PUT', '/angels/me', {
      name: '아비바의 집',
      location: { lat: 33.229, lon: 35.655 },
      services: { bed: 'ROOM', internet: true, shower: true, meal: true },
      visible: true,
    });
  });
});

describe('채팅 — E2E 암호화, 서버는 중계만 (지시서 0-4)', () => {
  const PLAINTEXT = '오늘 저녁 도착 예정입니다. 마당 텐트 가능할까요?';

  it('리스트→엔젤 메시지가 릴레이를 거쳐 복호화된다', async () => {
    const envelope = sealMessage({
      plaintext: PLAINTEXT,
      fromMemberId: lior.memberId,
      toMemberId: aviva.memberId,
      senderMsgKeyPair: lior.msg,
      recipientMsgPublicKey: aviva.msg.publicKeyHex,
      deviceSigner: lior.signer,
      now: Date.now(),
    });
    const sendRes = await signedInject(lior, 'POST', '/messages', { envelope });
    expect(sendRes.statusCode).toBe(200);

    const inbox = await signedInject(aviva, 'GET', '/messages?sinceId=0');
    const { messages } = inbox.json() as { messages: { id: number; envelope: MessageEnvelope }[] };
    expect(messages).toHaveLength(1);
    const opened = openMessage(messages[0]!.envelope, aviva.msg);
    expect(opened.plaintext).toBe(PLAINTEXT);
    expect(opened.signatureValid).toBe(true);
    expect(messages[0]!.envelope.senderDevicePublicKey).toBe(lior.signer.publicKeyHex);
  });

  it('서버 DB에는 평문이 존재하지 않는다', () => {
    const rows = app.db.prepare('SELECT envelope_json FROM messages').all() as { envelope_json: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.envelope_json).not.toContain(PLAINTEXT);
      expect(row.envelope_json).not.toContain('텐트');
    }
  });

  it('타인 명의 발신은 거부된다', async () => {
    const forged = sealMessage({
      plaintext: 'x',
      fromMemberId: aviva.memberId, // 리오르가 아비바 행세
      toMemberId: lior.memberId,
      senderMsgKeyPair: lior.msg,
      recipientMsgPublicKey: lior.msg.publicKeyHex,
      deviceSigner: lior.signer,
      now: Date.now(),
    });
    const res = await signedInject(lior, 'POST', '/messages', { envelope: forged });
    expect(res.statusCode).toBe(403);
  });
});

describe('접대 → 수령 → 첫 접대 보너스 (지시서 2.4)', () => {
  let receivedCoin: Coin;

  it('QR 지불 왕복은 서버 없이 완결된다 (여기서는 로컬 함수 호출로 재현)', () => {
    const walkCoin = mintWalkCoinFor(lior, 17.3); // 173 dSHV
    const charge = buildCharge(
      { chargeId: 'chg-hosting-1', angelMemberId: aviva.memberId, amountDshv: 100, serviceType: 'BED', createdAt: Date.now() },
      aviva.signer,
    );
    const [pay] = splitCoin(walkCoin, lior.signer, [100, 73], Date.now());
    const payment = buildPayment(charge, [pay!], lior.memberId, lior.signer, Date.now());
    const result = acceptPayment(charge, payment, aviva.signer);
    receivedCoin = result.coins[0]!;
    expect(verifyCoin(receivedCoin).valid).toBe(true);
    expect(receivedCoin.memberId).toBe(lior.memberId); // 생성 회원 번호 각인 유지
  });

  it('수령 코인을 증빙으로 첫 접대 보너스(30 SHV)가 발급·민팅된다', async () => {
    const res = await signedInject(aviva, 'POST', '/angels/first-hosting', { coin: receivedCoin });
    expect(res.statusCode).toBe(200);
    const { grant } = res.json() as { grant: SignedGrant };
    expect(grant.amountDshv).toBe(300); // 첫 접대 30 SHV
    const coin = mintGrantCoin(grant);
    expect(verifyCoin(coin, { trustedIssuerKeys: { [promoKey.keyId]: promoKey.publicKey } }).valid).toBe(true);
    avivaCoins.push(coin);
  });

  it('첫 접대 보너스는 1회뿐 — 재제출은 409', async () => {
    const res = await signedInject(aviva, 'POST', '/angels/first-hosting', { coin: receivedCoin });
    expect(res.statusCode).toBe(409);
  });

  it('자기 발행 코인(이전 체인 없음)은 접대 증빙이 될 수 없다', async () => {
    // 다른 엔젤 가입 + 등록 → 자기 보너스 코인으로 시도
    const mika = await register('+972-54-555-6666', 'mika@example.org', '미카');
    const reg = await signedInject(mika, 'PUT', '/angels/me', {
      name: '미카의 소파',
      location: { lat: 33.218, lon: 35.625 },
      services: { bed: 'SOFA' },
      visible: true,
    });
    const { registrationGrant } = reg.json() as { registrationGrant: SignedGrant };
    const ownBonus = mintGrantCoin(registrationGrant);
    const res = await signedInject(mika, 'POST', '/angels/first-hosting', { coin: ownBonus });
    expect(res.statusCode).toBe(400);
  });
});

describe('투명성 공시 + 승인 기능 부재', () => {
  it('프로모션 발행 현황이 공시된다', async () => {
    const res = await app.inject({ method: 'GET', url: '/transparency/promo' });
    expect(res.json()).toEqual({
      registrationIssued: 2, // 아비바 + 미카
      firstHostingIssued: 1,
      registrationQuota: 500,
      // 첫 접대 보너스도 수량 한정 — 등록과 같은 기본 500명분이 공시된다.
      firstHostingQuota: 500,
      // 보물 마이닝 (M9) 집계 — 이 테스트에서는 등록된 보물이 없다.
      treasureIssued: 0,
      treasureQuota: 0,
      // 스팟 보물 (M12) 집계 — 이 테스트에서는 예치·발행이 없다. 발행 ≤ 예치(총량 보존)를
      // 공시로 확인 가능(둘 다 0). spotTransparency(db) 스프레드가 이 세 필드를 낸다.
      spotDepositedDshv: 0,
      spotIssuedDshv: 0,
      spotIssuedCount: 0,
    });
  });

  it('이 서버에 거래 승인·지불 엔드포인트는 존재하지 않는다', async () => {
    for (const url of ['/payments', '/transactions', '/approve', '/balance']) {
      const res = await app.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode).toBe(404);
    }
  });
});
