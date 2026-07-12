/** 공통 UI 유틸 — 포맷·색·작은 컴포넌트. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Coin } from '@shvil/shared';

/** dSHV → "12.3 SHV" 표기. */
export function fmtShv(dshv: number): string {
  return `${(dshv / 10).toFixed(1)} SHV`;
}

export function fmtKm(meters: number): string {
  return `${(meters / 1000).toFixed(2)} km`;
}

/** 코인 계보 한 줄 설명 — "이 코인은 32km의 걸음에서 태어났다" (거리·날짜만, 위치 없음). */
export function provenanceText(coin: Coin): string {
  let root = coin;
  while (root.provenance.kind === 'SPLIT') root = root.provenance.parent;
  if (root.provenance.kind === 'WALK') {
    const p = root.provenance.proof;
    const from = p.dailyBreakdown[0]?.date ?? '';
    const to = p.dailyBreakdown[p.dailyBreakdown.length - 1]?.date ?? '';
    const period = from === to ? from : `${from}~${to}`;
    const split = coin !== root ? ' (분할)' : '';
    return `${(p.distanceM / 1000).toFixed(1)}km의 걸음에서 태어남 · ${period}${split}`;
  }
  const g = root.provenance.grant;
  const label =
    g.kind === 'ANGEL_BONUS' ? '엔젤 보너스' : g.kind === 'COMMUNITY_CLAIM' ? '클레임 구제' : '격려 코인';
  return `${label} 발행 · ${new Date(g.issuedAt).toISOString().slice(0, 10)}`;
}

export const colors = {
  primary: '#2E7D32',
  warn: '#B26A00',
  danger: '#C62828',
  muted: '#667085',
  card: '#F4F6F4',
  onCourse: '#2E7D32',
  offCourse: '#B26A00',
  detour: '#1565C0',
  daily: '#667085',
};

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 13 },
});
