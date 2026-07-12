/** 홈 — 걸음 수·잠정 누적 진행 바·확정 잔액·다음 엔젤 거리 (지시서 4장). */
import React from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useWallet } from '../core/walletService';
import { walkService } from '../core/walkService';
import { Card, Muted, Title, colors, fmtKm, fmtShv } from '../ui/common';

const STANDARD_DSHV = 200; // 하루의 성실한 걸음 ≈ 20 SHV
const CAP_DSHV = 400; // 1일 상한 40 SHV

export function HomeScreen() {
  const w = useWallet();
  const totalBalance = w.walkedBalanceDshv + w.receivedBalanceDshv + w.bonusBalanceDshv;
  const pendingRatio = Math.min(1, w.pending.pendingDshvEstimate / CAP_DSHV);
  const standardMark = STANDARD_DSHV / CAP_DSHV;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Title>이번 구간 걸음</Title>
        <Text style={styles.big}>{w.pending.stepCount.toLocaleString()} 걸음</Text>
        <Muted>{fmtKm(w.pending.distanceM)} 걸음 · 정산 전 잠정 누적</Muted>
      </Card>

      <Card>
        <Title>잠정 누적 SHV</Title>
        <Text style={styles.big}>{fmtShv(w.pending.pendingDshvEstimate)}</Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pendingRatio * 100}%` }]} />
          <View style={[styles.standardMark, { left: `${standardMark * 100}%` }]} />
        </View>
        <Muted>표준 20 SHV · 1일 상한 40 SHV — 사용하거나 "여기서 정산"해야 확정됩니다</Muted>
        {Object.entries(w.pending.detourPendingByAngel).map(([angelId, dshv]) => (
          <Muted key={angelId}>엔젤 우회 잠정 {fmtShv(dshv)} — {angelId}에게 사용 시 확정</Muted>
        ))}
      </Card>

      <Card>
        <Title>확정 잔액</Title>
        <Text style={styles.big}>{fmtShv(totalBalance)}</Text>
        <Muted>걸음 생성 {fmtShv(w.walkedBalanceDshv)} · 받은 코인 {fmtShv(w.receivedBalanceDshv)} · 보너스 {fmtShv(w.bonusBalanceDshv)}</Muted>
        <Muted>스테이블코인(USDC) 0.00 — 마켓 결제용, M3에서 활성화</Muted>
      </Card>

      <Card>
        <Title>다음 엔젤</Title>
        {w.liveStatus?.nearestAngel ? (
          <Text style={styles.medium}>
            {w.liveStatus.nearestAngel.name} · {fmtKm(w.liveStatus.nearestAngel.distanceM)}
          </Text>
        ) : (
          <Muted>걷기 추적을 시작하면 표시됩니다</Muted>
        )}
      </Card>

      <Button
        title={w.walkTracking ? '걷기 추적 중지' : '걷기 추적 시작 (만보기 모드)'}
        color={w.walkTracking ? colors.danger : colors.primary}
        onPress={() => {
          if (w.walkTracking) walkService.stop();
          else {
            void walkService.start().then((err) => {
              if (err) console.warn(err);
            });
          }
        }}
      />
      <Muted>회원 번호 {w.memberId} · 좌표는 판정 즉시 폐기됩니다 (남는 것은 거리뿐)</Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 4 },
  big: { fontSize: 28, fontWeight: '800', marginBottom: 6 },
  medium: { fontSize: 18, fontWeight: '600' },
  barTrack: {
    height: 10,
    backgroundColor: '#DDE3DD',
    borderRadius: 5,
    marginVertical: 8,
    overflow: 'visible',
  },
  barFill: { height: 10, backgroundColor: colors.primary, borderRadius: 5 },
  standardMark: {
    position: 'absolute',
    top: -3,
    width: 2,
    height: 16,
    backgroundColor: colors.warn,
  },
});
