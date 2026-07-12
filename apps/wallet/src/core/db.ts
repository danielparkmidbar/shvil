/**
 * 로컬 원장 (SQLite) — 지시서 4장 기술 스택.
 *
 * 저장 대상: 확정 코인, 잠정 원장 스냅숏, 발행 이력, 지불 영수증.
 * 위치 비저장 원칙: 어떤 테이블에도 좌표·경로 컬럼이 없다.
 */
import * as SQLite from 'expo-sqlite';
import type { Coin, PendingLedgerState } from '@shvil/shared';
import type { ConfirmMessage } from '@shvil/shared';

export type CoinStatus = 'OWNED' | 'SPENT' | 'SPLIT_CONSUMED';
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
