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
