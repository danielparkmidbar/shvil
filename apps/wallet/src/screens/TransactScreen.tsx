/**
 * 거래 — 상단 세그먼트로 지불/수령 전환 (기존 M1 PayScreen/ReceiveScreen 재사용).
 * 두 흐름 모두 QR 왕복 로컬 서명 — 서버 개입 0회, 오프라인 완결 (지시서 2.3).
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PayScreen } from './PayScreen';
import { ReceiveScreen } from './ReceiveScreen';
import { colors } from '../ui/common';

type Segment = 'PAY' | 'RECEIVE';

export function TransactScreen() {
  const [segment, setSegment] = useState<Segment>('PAY');

  return (
    <View style={styles.screen}>
      <View style={styles.segmentRow}>
        <Pressable
          style={[styles.segment, segment === 'PAY' && styles.segmentActive]}
          onPress={() => setSegment('PAY')}
        >
          <Text style={[styles.segmentText, segment === 'PAY' && styles.segmentTextActive]}>📲 지불</Text>
        </Pressable>
        <Pressable
          style={[styles.segment, segment === 'RECEIVE' && styles.segmentActive]}
          onPress={() => setSegment('RECEIVE')}
        >
          <Text style={[styles.segmentText, segment === 'RECEIVE' && styles.segmentTextActive]}>🤝 수령</Text>
        </Pressable>
      </View>
      {segment === 'PAY' ? <PayScreen /> : <ReceiveScreen />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  segmentRow: {
    flexDirection: 'row',
    margin: 12,
    marginBottom: 0,
    borderRadius: 10,
    backgroundColor: '#E4EAE4',
    padding: 3,
  },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontWeight: '700', color: colors.muted },
  segmentTextActive: { color: 'white' },
});
