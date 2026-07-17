/**
 * 검증 가능한 신뢰 뱃지 (C — 별점 대신 사실, 검증가능신뢰_설계.md).
 *
 * 상대·본인이 공개한 TrustSummary(위조가 어려운 사실)를 뱃지 줄로 보여준다.
 * 위조가 어려운 핵심(완주·검증 걷기 실적·검토단 검증)은 강조색, 활동 기간·인증
 * 수 등 보조 지표는 연한 색. 정확한 코인 액수는 데이터에 없다(구간 뱃지만).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TrustSummary } from '@shvil/shared';
import { trustBadges } from '../core/trustFormat';
import { colors } from './common';

export function TrustBadges({ trust, compact = false }: { trust: TrustSummary | null; compact?: boolean }) {
  if (!trust) return null;
  const badges = trustBadges(trust, compact);
  if (badges.length === 0) return null;
  return (
    <View style={styles.row}>
      {badges.map((b) => (
        <View key={b.key} style={[styles.badge, b.strong ? styles.strong : styles.soft]}>
          <Text style={[styles.label, b.strong ? styles.strongLabel : styles.softLabel]}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badge: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  strong: { backgroundColor: colors.primary },
  soft: { backgroundColor: 'rgba(46,125,50,0.10)' },
  label: { fontSize: 12, fontWeight: '700' },
  strongLabel: { color: '#fff' },
  softLabel: { color: colors.primary },
});
