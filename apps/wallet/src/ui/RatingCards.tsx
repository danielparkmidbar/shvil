/**
 * 별점 — 구조화 메시지(RATING)를 채팅에서 카드로 보여준다 (M7-B).
 * 원문은 E2E 평문 — 기기 안에만 있다. 공개 여부(makePublic)는 평가자 동의다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RatingCardPayload } from '@shvil/shared';
import { RATING_DIRECTION_LABEL, starGlyphs } from '../core/ratingFormat';
import { Muted, colors } from './common';

export function RatingMessageCard({ payload }: { payload: RatingCardPayload }) {
  return (
    <View style={styles.card}>
      <Text style={styles.head}>
        <Text style={styles.stars}>{starGlyphs(payload.stars)}</Text> 별점 · {RATING_DIRECTION_LABEL[payload.direction]}
      </Text>
      {payload.review ? <Text style={styles.review}>{payload.review}</Text> : null}
      <View style={styles.fromBox}>
        <Text style={styles.fromName}>— {payload.fromDisplayName}</Text>
      </View>
      <Muted>
        {payload.makePublic
          ? '평가자가 프로필 공개에 동의했습니다.'
          : '평가자가 프로필 공개에 동의하지 않았습니다 (비공개).'}
      </Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  head: { fontSize: 15, fontWeight: '800', color: colors.primary, marginBottom: 2 },
  stars: { color: '#B26A00' },
  review: { fontSize: 15, color: '#1A1F1A', lineHeight: 21 },
  fromBox: {
    backgroundColor: 'rgba(178,106,0,0.08)',
    borderRadius: 8,
    padding: 8,
    marginTop: 2,
    gap: 1,
  },
  fromName: { fontSize: 14, fontWeight: '700' },
});
