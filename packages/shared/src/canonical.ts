/**
 * 정준(canonical) 직렬화 — 서명 대상 바이트열은 항상 이 함수로 만든다.
 * 객체 키를 재귀적으로 정렬해 플랫폼·직렬화 순서 차이로 서명이 갈라지는 것을 막는다.
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonical: non-finite number');
      return JSON.stringify(value);
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(',')}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`canonical: unsupported type ${typeof value}`);
  }
}
