/** 걷기 상세 — 코스 위/밖/우회 상태 표시 + "여기서 정산" (지시서 4장). */
import React from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useWallet, wallet } from '../core/walletService';
import { Card, Muted, Title, colors, fmtKm, fmtShv } from '../ui/common';

const TIER_LABEL: Record<string, { text: string; color: string }> = {
  ON_COURSE: { text: '코스 위 — 인정 중 (기준 요율)', color: colors.onCourse },
  OFF_COURSE: { text: '코스 밖 — 감액 중 (1/10 요율)', color: colors.offCourse },
  ANGEL_DETOUR: { text: '엔젤 우회 — 잠정 (사용 시 확정)', color: colors.detour },
  DAILY_LIFE: { text: '일상 걸음 — 미세 요율', color: colors.daily },
  IDLE: { text: '대기 중', color: colors.daily },
};

export function WalkScreen() {
  const w = useWallet();
  const tier = w.liveStatus?.tier ?? 'IDLE';
  const label = TIER_LABEL[tier] ?? TIER_LABEL.IDLE!;

  const settleHere = () => {
    Alert.alert(
      '여기서 정산',
      `잠정 누적 ${fmtShv(w.pending.pendingDshvEstimate)}를 지금 확정할까요?\n(트레킹을 중도에 끝낼 때 사용하세요. 확정 후 새 구간이 시작됩니다.)`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '정산',
          style: 'default',
          onPress: () => {
            void wallet.settleManual(Date.now()).then((coin) => {
              Alert.alert(
                '정산 완료',
                coin
                  ? `${fmtShv(coin.amountDshv)} 코인이 확정되었습니다.`
                  : '확정할 잠정 누적이 없습니다 — 순례길 위의 생성이 없으면 아무것도 만들어지지 않습니다.',
              );
            });
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Title>현재 상태</Title>
        <View style={[styles.badge, { backgroundColor: label.color }]}>
          <Text style={styles.badgeText}>{label.text}</Text>
        </View>
        {!w.walkTracking && <Muted>홈에서 걷기 추적을 시작하세요.</Muted>}
        {w.liveStatus?.mockLocationDetected && (
          <Text style={styles.warn}>⚠ 가짜 위치(mock location) 감지 — 걷기 기록이 차단됩니다</Text>
        )}
        {w.liveStatus?.courseName && <Muted>코스: {w.liveStatus.courseName}</Muted>}
        {w.liveStatus?.distanceToCourseM !== null && w.liveStatus?.distanceToCourseM !== undefined && (
          <Muted>코스까지 {fmtKm(w.liveStatus.distanceToCourseM)}</Muted>
        )}
      </Card>

      <Card>
        <Title>이번 구간 (정산 전)</Title>
        <Text style={styles.big}>{fmtShv(w.pending.pendingDshvEstimate)}</Text>
        <Muted>
          {fmtKm(w.pending.distanceM)} · {w.pending.stepCount.toLocaleString()} 걸음
          {w.pending.startedAt ? ` · ${new Date(w.pending.startedAt).toLocaleDateString()} 시작` : ''}
        </Muted>
        {Object.entries(w.pending.detourPendingByAngel).map(([angelId, dshv]) => (
          <Muted key={angelId}>+ 엔젤 우회 잠정 {fmtShv(dshv)} ({angelId})</Muted>
        ))}
      </Card>

      <Button title="여기서 정산" color={colors.warn} onPress={settleHere} />
      <Muted>
        정산은 사용(지불) 또는 이 버튼으로만 이루어집니다. 자동 정산은 없습니다.
        정산되지 않은 잠정 누적은 폰 분실 시 복구가 보장되지 않습니다.
      </Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 4 },
  big: { fontSize: 28, fontWeight: '800', marginBottom: 6 },
  badge: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 8 },
  badgeText: { color: 'white', fontWeight: '700' },
  warn: { color: colors.danger, fontWeight: '700', marginTop: 6 },
});
