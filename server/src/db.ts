/**
 * 디렉토리 서버 저장소 (node:sqlite).
 *
 * 저장하는 것: 회원(전화 해시 — 원문 비저장), 엔젤 공개 프로필(본인 자발 공개),
 * E2E 암호문 봉투(평문 없음), 프로모션 발행 기록.
 * 저장하지 않는 것: 사용자 이동 궤적, 거래 내역, 잔고 — 이 서버는 거래를 모른다.
 */
import { DatabaseSync } from 'node:sqlite';

export function createDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS members (
      member_id TEXT PRIMARY KEY,
      phone_hash TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      display_name TEXT,
      device_public_key TEXT NOT NULL,
      messaging_public_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS otp (
      phone_hash TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS angels (
      member_id TEXT PRIMARY KEY REFERENCES members(member_id),
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      services_json TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1,
      conditions TEXT,
      visible INTEGER NOT NULL DEFAULT 1,
      registered_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS promo_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      grant_json TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      UNIQUE(member_id, kind)
    );
    CREATE TABLE IF NOT EXISTS hosting_evidence (
      coin_id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      submitted_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_member TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_member, id);
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_member TEXT NOT NULL,
      amount_dshv INTEGER NOT NULL,
      status TEXT NOT NULL, -- OPEN | ESCROW | SETTLED | CANCELLED
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL REFERENCES listings(id),
      buyer_member TEXT NOT NULL,
      total_usdc_micro INTEGER NOT NULL,
      status TEXT NOT NULL, -- PENDING | APPROVED | REJECTED | SETTLED
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS escrows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      offer_id INTEGER UNIQUE NOT NULL REFERENCES offers(id),
      status TEXT NOT NULL, -- AWAITING_DEPOSIT | DEPOSITED | COINS_SUBMITTED | COMPLETED | REFUNDED
      deposit_ref TEXT NOT NULL,
      coins_json TEXT,
      fee_usdc_micro INTEGER NOT NULL,
      payout_address TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    -- 코스 등록부 (shvilist.org 중심 기능, 지시서 6장 3절)
    CREATE TABLE IF NOT EXISTS course_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      proposer_member TEXT NOT NULL,
      polyline_json TEXT NOT NULL,
      segments_json TEXT NOT NULL,
      status TEXT NOT NULL, -- CANDIDATE | OFFICIAL
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS completion_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      distance_m INTEGER NOT NULL,
      days INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(course_id, member_id)
    );
    -- 클레임 게시판 (누락 걸음 구제, 지시서 2.5)
    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      walked_at INTEGER NOT NULL,
      distance_m INTEGER NOT NULL,
      photos_json TEXT NOT NULL,
      status TEXT NOT NULL, -- OPEN | APPROVED
      grant_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claim_votes (
      claim_id INTEGER NOT NULL REFERENCES claims(id),
      voter_member TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(claim_id, voter_member)
    );
    -- 완주 인증 게시판 (격려 코인, 지시서 2.6)
    CREATE TABLE IF NOT EXISTS certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      kind TEXT NOT NULL, -- FULL | SECTION
      photos_json TEXT NOT NULL,
      data_json TEXT NOT NULL,
      grant_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(member_id, course_id, kind)
    );
    -- 검증 트레커 탑 100 (지역별, 본인 동의 — 거리·총량만, 위치 없음)
    CREATE TABLE IF NOT EXISTS leaderboard (
      member_id TEXT PRIMARY KEY,
      region TEXT NOT NULL,
      display_name TEXT NOT NULL,
      total_distance_m INTEGER NOT NULL,
      total_minted_dshv INTEGER NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    -- 소명 대기 목록 (지시서 3장 5절) — 지갑들이 내려받아 수령 보류
    CREATE TABLE IF NOT EXISTS flagged_members (
      member_id TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      status TEXT NOT NULL, -- PENDING | CLEARED
      flagged_at INTEGER NOT NULL
    );
    -- 기회적 동기화 지문 (보안 감사 H-1, 지시서 2.3·3장 4절) — 사후 이상 탐지 통계.
    -- 좌표·경로 없음: 코인 ID·계보 요약·주소뿐 (코인에 이미 새겨진 공개 정보).
    CREATE TABLE IF NOT EXISTS coin_sightings (
      coin_id TEXT NOT NULL,
      chain_len INTEGER NOT NULL,
      owner_address TEXT NOT NULL,
      last_from_address TEXT,
      producer_member TEXT NOT NULL,
      amount_dshv INTEGER NOT NULL,
      root_kind TEXT NOT NULL,
      reporter_member TEXT NOT NULL,
      reported_at INTEGER NOT NULL,
      PRIMARY KEY (coin_id, chain_len, owner_address)
    );
    CREATE INDEX IF NOT EXISTS idx_sightings_coin ON coin_sightings(coin_id, chain_len);
    -- 걷기 증명 통계 — 회원별 일자 합산으로 초과 생성 포착 (proofHash당 1회 dedup)
    CREATE TABLE IF NOT EXISTS walk_proof_stats (
      proof_hash TEXT PRIMARY KEY,
      producer_member TEXT NOT NULL,
      breakdown_json TEXT NOT NULL,
      total_dshv INTEGER NOT NULL,
      first_seen INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_proof_stats_member ON walk_proof_stats(producer_member);
    -- 암호화 지갑 백업 (지시서 2.3, 보안 감사 L-2) — 서버는 blob을 보관만, 내용 못 봄.
    -- 기기 주소당 최신 1개. 니모닉 파생 키로만 복호화 가능 (종단간). 복구는 회원
    -- 번호 없이 기기 키 소유 증명만으로 자기 백업을 조회한다.
    CREATE TABLE IF NOT EXISTS wallet_backups (
      device_address TEXT PRIMARY KEY,
      blob TEXT NOT NULL,
      digest TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

export function kvGet(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function kvSet(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, value);
}
