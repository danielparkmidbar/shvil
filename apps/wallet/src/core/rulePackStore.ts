/**
 * 규칙 팩 보관 (kv) — 사용자가 자기 지갑에 얹은 위폐 감지 규칙.
 *
 * 여기 있는 것은 **데이터뿐**이다. 팩은 코드가 아니므로 다운로드가 코드 실행이 되지
 * 않는다 (rulePack.ts 설계 주석). 저장 전에 반드시 검증하고, 읽을 때 한 번 더 검증한다
 * — 저장소가 손상되거나 사람이 손으로 고쳤을 수 있기 때문이다(fail-closed).
 *
 * 이 팩들은 **수령 검토에만** 쓰인다. 코어 판정(coreVerdict)에는 어떤 영향도 주지
 * 못한다 — 그 보장은 정책이 아니라 구조다(applyRulePacks가 코어 발견을 인자로 받지
 * 않는다).
 */
import type { RulePack } from '@shvil/shared';
import { kvGet, kvSet } from './db';
import { parseStoredPacks, removePack, serializePacks, upsertPack } from './rulePackFormat';

const PACKS_KEY = 'rulePacks.v1';

/** 메모리 캐시 — 수령 경로가 매번 kv를 때리지 않게. init에서 채운다. */
let cache: RulePack[] | null = null;
let cacheErrors: string[] = [];

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribeRulePacks(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 저장된 팩 (검증 통과분). 처음 호출 시 kv에서 읽는다. */
export async function loadRulePacks(): Promise<{ packs: RulePack[]; errors: string[] }> {
  if (cache === null) {
    const parsed = parseStoredPacks(await kvGet(PACKS_KEY));
    cache = parsed.packs;
    cacheErrors = parsed.errors;
  }
  return { packs: cache, errors: cacheErrors };
}

/** 동기 조회 — 이미 읽어 둔 캐시. 아직 안 읽었으면 빈 목록(팩 없음과 같다). */
export function getRulePacksSync(): RulePack[] {
  return cache ?? [];
}

async function save(packs: RulePack[]): Promise<void> {
  cache = packs;
  await kvSet(PACKS_KEY, serializePacks(packs));
  notify();
}

/** 팩 추가·교체. 같은 id면 새 판으로 바꾼다. */
export async function addRulePack(pack: RulePack): Promise<RulePack[]> {
  const { packs } = await loadRulePacks();
  const next = upsertPack(packs, pack);
  await save(next);
  return next;
}

export async function removeRulePack(packId: string): Promise<RulePack[]> {
  const { packs } = await loadRulePacks();
  const next = removePack(packs, packId);
  await save(next);
  return next;
}

/** 테스트·복구용 — 캐시를 비워 다음 호출이 kv를 다시 읽게 한다. */
export function resetRulePackCache(): void {
  cache = null;
  cacheErrors = [];
}
