/**
 * 보물 마이닝 UI (M9) — WalkScreen에 얹히는 선택 계층.
 *
 * 제1원칙: 보물이 근처에 없으면 이 컴포넌트는 아무것도 그리지 않는다 —
 * 걷기 화면(0층)은 기존과 완전히 동일하다. 존 근접 시에만 배너가 나타나고,
 * "도전"을 누르면 이동 지시 모달이 뜬다. 판정은 전부 폰 로컬이다.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LegRejectReason, MovementDir } from '@shvil/shared';
import { treasureService, useTreasure } from '../core/treasureService';
import { useWallet } from '../core/walletService';
import { Card, Muted, colors, fmtShv } from '../ui/common';

const DIR_KO: Record<MovementDir, string> = { N: '북쪽', E: '동쪽', S: '남쪽', W: '서쪽' };

const FAIL_TEXT: Record<LegRejectReason, string> = {
  STEPS_OUT_OF_BAND: '걸음 수가 지시와 맞지 않았습니다',
  DISTANCE_OUT_OF_BAND: '이동 거리가 걸음과 맞지 않았습니다',
  HEADING_OFF: '이동 방향이 지시와 달랐습니다',
  MALFORMED: '측정이 올바르지 않았습니다',
};

export function TreasureSection() {
  const t = useTreasure();
  const bike = useWallet().travelMode === 'BIKE';

  // 보물이 없으면 아무것도 그리지 않는다 (0층 신성불가침).
  if (!t.nearby && !t.session && !t.lastResult) return null;

  return (
    <>
      {t.nearby && !t.session && (
        <Card>
          <Text style={styles.bannerTitle}>
            {t.nearby.amountDshv > 0 ? '🎁 보물이 근처에 숨겨져 있습니다' : '📍 구간 인증 스탬프 지점입니다'}
          </Text>
          <Muted>
            약 {t.nearby.distanceM}m 이내 · {bike ? '자전거를 세우고 ' : ''}실시간 이동 지시를 몸으로 수행하면{' '}
            {t.nearby.amountDshv > 0 ? '보물이 열립니다' : '스탬프가 찍힙니다'}
          </Muted>
          {bike && <Muted>🚲 자전거 모드 — 세워두고 걸어서 실주행을 인증합니다 (안전한 곳에서).</Muted>}
          <Pressable style={styles.startBtn} onPress={() => treasureService.startChallenge()}>
            <Text style={styles.startBtnText}>도전하기</Text>
          </Pressable>
        </Card>
      )}

      {t.lastResult && !t.session && (
        <Card>
          <Text style={styles.bannerTitle}>{resultTitle(t.lastResult)}</Text>
          <Muted>{resultDetail(t.lastResult)}</Muted>
          <Pressable style={styles.closeLink} onPress={() => treasureService.dismissResult()}>
            <Text style={styles.closeLinkText}>닫기</Text>
          </Pressable>
        </Card>
      )}

      <Modal visible={t.session !== null} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.sheet}>{t.session && <ChallengeBody />}</View>
        </View>
      </Modal>
    </>
  );
}

function resultTitle(r: NonNullable<ReturnType<typeof useTreasure>['lastResult']>): string {
  if (r.stamp) return '📍 구간 인증 스탬프 완료';
  if (r.minted) return `🎉 보물 발견 — ${fmtShv(r.amountDshv)}`;
  if (r.queued) return '✅ 몸 인증 완료';
  return '보물을 받을 수 없었습니다';
}

function resultDetail(r: NonNullable<ReturnType<typeof useTreasure>['lastResult']>): string {
  if (r.stamp) return '이 구간을 실제로 이동했다는 인증이 기록되었습니다.';
  if (r.minted) return '보너스 계보로 지갑에 담겼습니다 (걸음 코인과 영구 구분).';
  if (r.queued) return '지금은 통신이 없어 청구를 보관했습니다 — 통신이 복구되면 자동으로 받아옵니다.';
  return '이미 받았거나, 수량이 소진되었거나, 기간이 지난 보물입니다.';
}

function ChallengeBody() {
  const t = useTreasure();
  const bike = useWallet().travelMode === 'BIKE';
  const s = t.session;
  if (!s) return null;

  if (s.state === 'BLOCKED') {
    return (
      <>
        <Text style={styles.failTitle}>⚠ 가짜 위치 감지</Text>
        <Muted>mock location이 감지되어 몸 인증이 차단되었습니다.</Muted>
        <Pressable style={styles.closeBtn} onPress={() => treasureService.dismissChallenge()}>
          <Text style={styles.closeBtnText}>닫기</Text>
        </Pressable>
      </>
    );
  }

  if (s.state === 'FAILED') {
    return (
      <>
        <Text style={styles.failTitle}>인증 실패</Text>
        <Muted>{s.failedReason ? FAIL_TEXT[s.failedReason] : '지시대로 수행되지 않았습니다'}</Muted>
        <Muted>존 안에서 다시 도전할 수 있습니다.</Muted>
        <Pressable style={styles.closeBtn} onPress={() => treasureService.dismissChallenge()}>
          <Text style={styles.closeBtnText}>닫기</Text>
        </Pressable>
      </>
    );
  }

  if (s.state === 'SUCCESS') {
    return (
      <>
        <Text style={styles.instruction}>🎉 성공!</Text>
        <Muted>모든 지시를 수행했습니다 — 몸 인증이 이 폰 안에서 완결되었습니다.</Muted>
        <Pressable style={styles.closeBtn} onPress={() => treasureService.dismissChallenge()}>
          <Text style={styles.closeBtnText}>확인</Text>
        </Pressable>
      </>
    );
  }

  // ACTIVE — 현재 다리 지시 큰 글씨 + 진행 표시.
  return (
    <>
      <Muted>
        {s.amountDshv > 0 ? '보물 열기' : '구간 인증 스탬프'} · 단계 {s.legIndex + 1} / {s.legCount}
      </Muted>
      {bike && s.legIndex === 0 && <Text style={styles.bikeHint}>🚲 자전거를 세우고 지시대로 걸으세요</Text>}
      <Text style={styles.instruction}>
        {DIR_KO[s.currentLeg.dir]}으로 {s.currentLeg.steps}걸음
      </Text>
      <Text style={styles.progress}>
        {Math.min(s.stepsInLeg, s.currentLeg.steps)} / {s.currentLeg.steps} 걸음
      </Text>
      <View style={styles.progressTrack}>
        <View
          style={[styles.progressFill, { width: `${Math.min(100, (s.stepsInLeg / s.currentLeg.steps) * 100)}%` }]}
        />
      </View>
      <Muted>지시대로 몸으로 움직이세요 — 판정은 이 폰 안에서만 이루어지고, 좌표는 저장되지 않습니다.</Muted>
      <Pressable style={styles.closeLink} onPress={() => treasureService.dismissChallenge()}>
        <Text style={styles.closeLinkText}>그만두기</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  bannerTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  startBtn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  startBtnText: { color: 'white', fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: 'white', borderRadius: 16, padding: 24, gap: 8 },
  instruction: { fontSize: 32, fontWeight: '900', textAlign: 'center', marginVertical: 12 },
  bikeHint: { fontSize: 15, fontWeight: '700', color: colors.detour, textAlign: 'center', marginTop: 6 },
  progress: { fontSize: 18, fontWeight: '700', textAlign: 'center', color: colors.primary },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.card, overflow: 'hidden', marginVertical: 8 },
  progressFill: { height: 8, backgroundColor: colors.primary },
  failTitle: { fontSize: 20, fontWeight: '800', color: colors.danger, marginBottom: 4 },
  closeBtn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  closeBtnText: { color: 'white', fontWeight: '800' },
  closeLink: { alignItems: 'center', paddingVertical: 8, marginTop: 4 },
  closeLinkText: { color: colors.muted, fontWeight: '700' },
});
