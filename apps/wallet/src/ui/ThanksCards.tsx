/**
 * 감사 카드 — 구조화 메시지(THANKS_CARD)를 채팅에서 쪽지 카드로 보여준다 (M7-A).
 * 원문은 E2E 평문 — 기기 안에만 있다. 게스트북 공개 여부(makePublic)는 작성자 동의다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ThanksCardPayload } from '@shvil/shared';
import { THANKS_TEMPLATE_EMOJI, THANKS_TEMPLATE_LABEL } from '../core/thanksCardFormat';
import { Muted, colors } from './common';

export function ThanksCardMessageCard({ payload }: { payload: ThanksCardPayload }) {
  return (
    <View style={styles.card}>
      <Text style={styles.head}>
        {THANKS_TEMPLATE_EMOJI[payload.template]} 감사 카드 · {THANKS_TEMPLATE_LABEL[payload.template]}
      </Text>
      <Text style={styles.message}>{payload.message}</Text>
      <View style={styles.fromBox}>
        <Text style={styles.fromName}>— {payload.fromDisplayName}</Text>
        {payload.journeyLine ? <Muted>{payload.journeyLine}</Muted> : null}
      </View>
      <Muted>
        {payload.makePublic
          ? '작성자가 게스트북 공개에 동의했습니다.'
          : '작성자가 게스트북 공개에 동의하지 않았습니다 (비공개).'}
      </Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  head: { fontSize: 15, fontWeight: '800', color: colors.primary, marginBottom: 2 },
  message: { fontSize: 15, color: '#1A1F1A', lineHeight: 21 },
  fromBox: {
    backgroundColor: 'rgba(178,106,0,0.08)',
    borderRadius: 8,
    padding: 8,
    marginTop: 2,
    gap: 1,
  },
  fromName: { fontSize: 14, fontWeight: '700' },
});
