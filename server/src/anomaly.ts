/**
 * 사후 이상 탐지 — 공유 검사 (보안 감사 H-1, 지시서 2.3·3장 4~5절).
 *
 * 여기 담긴 순수 검사 함수들은 **두 경로가 공유한다**:
 *  ① 기회적 동기화 (sync.ts /sync/coins) — 지갑이 온라인이 될 때 지문을 제출한다.
 *  ② 스팟 예치 (spotTreasure.ts /spot/deposit) — 사업자가 자기 코인을 리저브로
 *     소각(예치)한다. 예치도 걷기 코인(WALK)일 수 있으므로, ★예치가 fake-walk 방어의
 *     한 겹(sync 기반 초과생성 탐지)을 우회하는 조용한 세탁 경로가 되지 않도록
 *     같은 checkOverproduction/checkFork에 연결한다 (적대적 검증 V-3).
 *
 * 이것은 거래 승인이 아니다 — 거래·예치는 이미 서명으로 완결됐고, 여기서의 포착은
 * 소명 책임 절차(3장 5절)의 입구일 뿐이다. 등재는 신규 수령만 보류시킨다.
 */
import type { DatabaseSync } from 'node:sqlite';
import { addressFromPublicKey, type CoinFingerprint, type FlagReason } from '@shvil/shared';

/** 인간 한계 (확정 파라미터): 일 400 dSHV / 7일 3,000 dSHV. */
export interface HumanLimits {
  dailyMaxDshv: number;
  weeklyMaxDshv: number;
}

interface SightingRow {
  chain_len: number;
  owner_address: string;
  last_from_address: string | null;
}

function dateToEpochDay(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/**
 * 소명 대기 등재 — 사유는 코드 + 파라미터로만 기록한다 (자연어 없음, noUiStrings).
 * 이미 PENDING이면 유지한다 (최초 포착 사유를 덮어쓰지 않는다).
 */
export function flagMember(db: DatabaseSync, memberId: string, reason: FlagReason, now: number): void {
  const existing = db.prepare('SELECT status FROM flagged_members WHERE member_id = ?').get(memberId) as
    | { status: string }
    | undefined;
  if (existing?.status === 'PENDING') return;
  db.prepare(
    "INSERT OR REPLACE INTO flagged_members (member_id, reason_code, params_json, status, flagged_at) VALUES (?, ?, ?, 'PENDING', ?)",
  ).run(memberId, reason.reasonCode, JSON.stringify(reason.params), now);
}

/** 주소 → 회원 번호 (기기 공개키에서 주소 계산). 없으면 null. */
export function memberByAddress(db: DatabaseSync, address: string): string | null {
  const rows = db.prepare('SELECT member_id, device_public_key FROM members').all() as unknown as {
    member_id: string;
    device_public_key: string;
  }[];
  for (const r of rows) {
    if (addressFromPublicKey(r.device_public_key) === address) return r.member_id;
  }
  return null;
}

/**
 * ① 이중 사용 검사: 같은 (coinId, chainLen)의 기존 목격과 소유자 분기 대조.
 * 분기점 소유자(마지막 링크의 지불자)가 이중 지불자 → 소명 대기 등재.
 * ※ 반드시 이 지문의 목격을 저장하기 **전에** 호출해야 분기가 보인다.
 */
export function checkFork(db: DatabaseSync, fp: CoinFingerprint, now: number): string | null {
  const rows = db
    .prepare('SELECT chain_len, owner_address, last_from_address FROM coin_sightings WHERE coin_id = ? AND chain_len = ?')
    .all(fp.coinId, fp.chainLen) as unknown as SightingRow[];
  for (const row of rows) {
    if (
      row.owner_address !== fp.ownerAddress &&
      fp.chainLen > 0 &&
      row.last_from_address === fp.lastFromAddress &&
      fp.lastFromAddress
    ) {
      const suspect = memberByAddress(db, fp.lastFromAddress);
      if (suspect) {
        flagMember(
          db,
          suspect,
          { reasonCode: 'DOUBLE_SPEND_SUSPECT', params: { coinId: fp.coinId, chainLen: fp.chainLen } },
          now,
        );
        return suspect;
      }
    }
  }
  return null;
}

/**
 * ② 초과 생성 검사: 걷기 증명 합산이 인간 한계 초과 → 생산자 등재.
 * proofHash당 1회만 walk_proof_stats에 저장(분할 형제·중복 보고 dedup)하고, 그
 * 생산자의 전체 증명을 일자별로 합산해 일/주 한계를 넘으면 생산자를 소명 등재한다.
 */
export function checkOverproduction(
  db: DatabaseSync,
  fp: CoinFingerprint,
  limits: HumanLimits,
  now: number,
): string | null {
  if (fp.rootKind !== 'WALK' || !fp.proofHash || !fp.dailyBreakdown) return null;
  const exists = db.prepare('SELECT 1 FROM walk_proof_stats WHERE proof_hash = ?').get(fp.proofHash);
  if (!exists) {
    const total = fp.dailyBreakdown.reduce((s, d) => s + d.amountDshv, 0);
    db.prepare(
      'INSERT INTO walk_proof_stats (proof_hash, producer_member, breakdown_json, total_dshv, first_seen) VALUES (?, ?, ?, ?, ?)',
    ).run(fp.proofHash, fp.producerMemberId, JSON.stringify(fp.dailyBreakdown), total, now);
  }

  const rows = db
    .prepare('SELECT breakdown_json FROM walk_proof_stats WHERE producer_member = ?')
    .all(fp.producerMemberId) as unknown as { breakdown_json: string }[];
  const perDay = new Map<number, number>();
  for (const r of rows) {
    for (const d of JSON.parse(r.breakdown_json) as { date: string; amountDshv: number }[]) {
      const day = dateToEpochDay(d.date);
      perDay.set(day, (perDay.get(day) ?? 0) + d.amountDshv);
    }
  }
  const days = [...perDay.keys()].sort((a, b) => a - b);
  for (const day of days) {
    if (perDay.get(day)! > limits.dailyMaxDshv) {
      const date = new Date(day * 86_400_000).toISOString().slice(0, 10);
      flagMember(
        db,
        fp.producerMemberId,
        {
          reasonCode: 'OVERPRODUCTION_DAILY',
          params: { date, totalDshv: perDay.get(day)!, limitDshv: limits.dailyMaxDshv },
        },
        now,
      );
      return fp.producerMemberId;
    }
    let week = 0;
    for (let d = day - 6; d <= day; d++) week += perDay.get(d) ?? 0;
    if (week > limits.weeklyMaxDshv) {
      const date = new Date(day * 86_400_000).toISOString().slice(0, 10);
      flagMember(
        db,
        fp.producerMemberId,
        {
          reasonCode: 'OVERPRODUCTION_WEEKLY',
          params: { date, totalDshv: week, limitDshv: limits.weeklyMaxDshv },
        },
        now,
      );
      return fp.producerMemberId;
    }
  }
  return null;
}
