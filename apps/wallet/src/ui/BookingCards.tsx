/**
 * 예약 카드 — 구조화 메시지(BOOKING_REQUEST/REPLY)를 채팅·손님 수신함에서
 * 카드 형태로 보여준다 (M6). 원문은 E2E 평문 JSON — 기기 안에만 있다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { BookingReplyPayload, BookingRequestPayload } from '@shvil/shared';
import { fmtBookingDates } from '../core/bookingFormat';
import { Muted, colors } from './common';

export function BookingRequestCard({ payload }: { payload: BookingRequestPayload }) {
  const p = payload.profile;
  return (
    <View style={styles.card}>
      <Text style={styles.head}>🛏 투숙 신청</Text>
      <Text style={styles.line}>날짜: {fmtBookingDates(payload.dates)}</Text>
      <Text style={styles.line}>인원: {payload.partySize}명</Text>
      {payload.note ? <Text style={styles.line}>한마디: {payload.note}</Text> : null}
      <View style={styles.profileBox}>
        <Text style={styles.profileName}>{p.displayName}</Text>
        {p.memberSince ? <Muted>가입 {p.memberSince}</Muted> : null}
        {p.journeyLine ? <Muted>{p.journeyLine}</Muted> : null}
      </View>
      <Muted>신청자가 동의해 첨부한 프로필 — 서버에는 저장되지 않습니다.</Muted>
    </View>
  );
}

const DECISION_HEAD: Record<BookingReplyPayload['decision'], string> = {
  APPROVED: '✅ 투숙 승인',
  DECLINED: '🙏 투숙 거절',
  SUGGEST: '📅 다른 날짜 제안',
};

export function BookingReplyCard({ payload }: { payload: BookingReplyPayload }) {
  return (
    <View style={styles.card}>
      <Text style={[styles.head, payload.decision === 'DECLINED' && styles.headDeclined]}>
        {DECISION_HEAD[payload.decision]}
      </Text>
      {payload.suggestedDates ? (
        <Text style={styles.line}>제안 날짜: {fmtBookingDates(payload.suggestedDates)}</Text>
      ) : null}
      {payload.note ? <Text style={styles.line}>{payload.note}</Text> : null}
      {payload.decision === 'APPROVED' && (
        <View style={styles.preciseBox}>
          {payload.preciseLocation ? (
            <Text style={styles.line}>
              📍 정확한 위치: {payload.preciseLocation.lat.toFixed(5)}, {payload.preciseLocation.lon.toFixed(5)}
            </Text>
          ) : null}
          {payload.addressText ? <Text style={styles.line}>🏠 {payload.addressText}</Text> : null}
          {payload.contact ? <Text style={styles.line}>📞 {payload.contact}</Text> : null}
          <Muted>승인된 두 사람 사이에만 암호화되어 전달된 정보입니다 (R-4).</Muted>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 3 },
  head: { fontSize: 15, fontWeight: '800', color: colors.primary, marginBottom: 2 },
  headDeclined: { color: colors.muted },
  line: { fontSize: 14, color: '#1A1F1A' },
  profileBox: {
    backgroundColor: 'rgba(46,125,50,0.08)',
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
    gap: 1,
  },
  profileName: { fontSize: 14, fontWeight: '700' },
  preciseBox: {
    backgroundColor: 'rgba(21,101,192,0.08)',
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
    gap: 2,
  },
});
