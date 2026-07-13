/**
 * 로컬 원장 (SQLite) — 지시서 4장 기술 스택.
 *
 * 저장 대상: 확정 코인, 잠정 원장 스냅숏, 발행 이력, 지불 영수증,
 * 메신저 대화(chat_messages — 평문은 기기 안에서만, 서버는 암호문만 중계).
 * 위치 비저장 원칙: 어떤 테이블에도 사용자 이동 궤적 좌표·경로 컬럼이 없다.
 * (엔젤 포인트는 본인이 자발 공개하는 좌표로 유일한 예외이며 kv에 저장된다.)
 */
import * as SQLite from 'expo-sqlite';
import type { Coin, PendingLedgerState } from '@shvil/shared';
import type { ConfirmMessage } from '@shvil/shared';

/** ESCROWED: 마켓 에스크로에 이전 서명을 제출해 잠긴 코인 (M3) — 완료 시 SPENT. */
export type CoinStatus = 'OWNED' | 'SPENT' | 'SPLIT_CONSUMED' | 'ESCROWED';
/** 잔액 구분 표시용 — 계보상 영구 구분 (지시서 4장 지갑 화면). */
export type CoinOrigin = 'WALK_SELF' | 'BONUS' | 'RECEIVED';

export interface StoredCoin {
  coin: Coin;
  status: CoinStatus;
  origin: CoinOrigin;
}

let db: SQLite.SQLiteDatabase | null = null;

export async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('shvil-wallet.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS coins (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      status TEXT NOT NULL,
      origin TEXT NOT NULL,
      amount_dshv INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts (
      charge_id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      amount_dshv INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer_member_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      text TEXT NOT NULL,
      sent_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_peer ON chat_messages (peer_member_id, sent_at);
  `);
  return db;
}

export async function saveCoin(coin: Coin, origin: CoinOrigin, now: number): Promise<void> {
  const d = await openDb();
  await d.runAsync(
    'INSERT OR REPLACE INTO coins (id, json, status, origin, amount_dshv, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    coin.id,
    JSON.stringify(coin),
    'OWNED',
    origin,
    coin.amountDshv,
    now,
  );
}

export async function setCoinStatus(coinId: string, status: CoinStatus): Promise<void> {
  const d = await openDb();
  await d.runAsync('UPDATE coins SET status = ? WHERE id = ?', status, coinId);
}

export async function loadOwnedCoins(): Promise<StoredCoin[]> {
  const d = await openDb();
  const rows = await d.getAllAsync<{ json: string; status: string; origin: string }>(
    "SELECT json, status, origin FROM coins WHERE status = 'OWNED' ORDER BY created_at ASC",
  );
  return rows.map((r) => ({
    coin: JSON.parse(r.json) as Coin,
    status: r.status as CoinStatus,
    origin: r.origin as CoinOrigin,
  }));
}

export async function saveReceipt(confirm: ConfirmMessage, amountDshv: number, now: number): Promise<void> {
  const d = await openDb();
  await d.runAsync(
    'INSERT OR REPLACE INTO receipts (charge_id, json, amount_dshv, created_at) VALUES (?, ?, ?, ?)',
    confirm.chargeId,
    JSON.stringify(confirm),
    amountDshv,
    now,
  );
}

/** 수신 코인 ID 중복 검사 — 같은 코인의 이중 수령(이중지불) 로컬 차단. */
export async function isKnownCoinId(coinId: string): Promise<boolean> {
  const d = await openDb();
  const row = await d.getFirstAsync<{ id: string }>('SELECT id FROM coins WHERE id = ?', coinId);
  return row !== null;
}

// ── 범용 kv (서버 URL 오버라이드·모드·엔젤 프로필·프로모 키 캐시 등) ──

export async function kvGet(key: string): Promise<string | null> {
  const d = await openDb();
  const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return row ? row.value : null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const d = await openDb();
  await d.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value);
}

export async function kvDelete(key: string): Promise<void> {
  const d = await openDb();
  await d.runAsync('DELETE FROM kv WHERE key = ?', key);
}

// ── 메신저 대화 저장 (평문은 기기 안에서만 — 서버는 암호문만 본다) ──

export type ChatDirection = 'IN' | 'OUT';

export interface ChatMessageRow {
  id: number;
  peerMemberId: string;
  direction: ChatDirection;
  text: string;
  sentAt: number;
}

export async function saveChatMessage(
  peerMemberId: string,
  direction: ChatDirection,
  text: string,
  sentAt: number,
): Promise<void> {
  const d = await openDb();
  await d.runAsync(
    'INSERT INTO chat_messages (peer_member_id, direction, text, sent_at) VALUES (?, ?, ?, ?)',
    peerMemberId,
    direction,
    text,
    sentAt,
  );
}

export async function loadChatMessages(peerMemberId: string): Promise<ChatMessageRow[]> {
  const d = await openDb();
  const rows = await d.getAllAsync<{
    id: number;
    peer_member_id: string;
    direction: string;
    text: string;
    sent_at: number;
  }>('SELECT * FROM chat_messages WHERE peer_member_id = ? ORDER BY sent_at ASC, id ASC', peerMemberId);
  return rows.map((r) => ({
    id: r.id,
    peerMemberId: r.peer_member_id,
    direction: r.direction as ChatDirection,
    text: r.text,
    sentAt: r.sent_at,
  }));
}

/** 대화 상대별 마지막 메시지 (대화 목록 화면용). */
export async function loadChatSummaries(): Promise<ChatMessageRow[]> {
  const d = await openDb();
  const rows = await d.getAllAsync<{
    id: number;
    peer_member_id: string;
    direction: string;
    text: string;
    sent_at: number;
  }>(
    `SELECT m.* FROM chat_messages m
     JOIN (SELECT peer_member_id, MAX(sent_at) AS max_at FROM chat_messages GROUP BY peer_member_id) t
       ON m.peer_member_id = t.peer_member_id AND m.sent_at = t.max_at
     GROUP BY m.peer_member_id
     ORDER BY m.sent_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    peerMemberId: r.peer_member_id,
    direction: r.direction as ChatDirection,
    text: r.text,
    sentAt: r.sent_at,
  }));
}

const PENDING_STATE_KEY = 'pendingLedgerState.v1';

export async function savePendingState(state: PendingLedgerState): Promise<void> {
  const d = await openDb();
  await d.runAsync(
    'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)',
    PENDING_STATE_KEY,
    JSON.stringify(state),
  );
}

export async function loadPendingState(): Promise<PendingLedgerState | null> {
  const d = await openDb();
  const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', PENDING_STATE_KEY);
  return row ? (JSON.parse(row.value) as PendingLedgerState) : null;
}
