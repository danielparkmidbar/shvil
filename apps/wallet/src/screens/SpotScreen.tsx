/**
 * 스팟 보물 받기 (M12 — docs/몸인증_보물마이닝_설계.md 4장) — 스캐너(걷는 사람) UI.
 *
 * 트레일 근처 사업장이 숨겨둔 코인을 벽 QR 스캔(또는 근처 목록)으로 받는다. 무기명
 * 베어러가 아니라 서버 선착순 회계다(M10 폐기) — QR은 spotId만 담고, 지급은 서버가
 * 인증된 회원에게만 낸다. 1인 1회·선착순은 서버가 셈한다. 코인이 없는 스팟은 방문
 * 스탬프만 찍힌다.
 *
 * 제1원칙: 이 화면은 더보기 아래 선택 기능이다 — 기본 걷기 화면(0층)은 손대지 않는다.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MovementDir } from '@shvil/shared';
import { ApiError, type SpotListEntry } from '../core/api';
import { isProvisionalMemberId } from '../core/identity';
import { parseSpotQr, spotService } from '../core/spotService';
import { spotPresenceService, useSpotPresence } from '../core/spotPresenceService';
import { useWallet } from '../core/walletService';
import { QrScanner } from '../ui/QrScanner';
import { Card, Muted, Title, colors, fmtShv } from '../ui/common';

/** 방위 코드 → 화면 문구 (서버는 코드만 준다 — noUiStrings). */
const DIR_LABEL: Record<MovementDir, string> = { N: '북쪽', E: '동쪽', S: '남쪽', W: '서쪽' };

/** 서버 도메인 오류 코드 → 한국어 문구 (서버는 코드만, 문구는 클라이언트가 조립). */
function rejectMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.message) {
      case 'SPOT_ALREADY_CLAIMED':
        return '이미 이 스팟에서 받았습니다 (1인 1회).';
      case 'SPOT_EXHAUSTED':
        return '선착순이 마감되었습니다 — 코인이 모두 소진되었습니다.';
      case 'SPOT_OUT_OF_VALIDITY':
        return '지금은 받을 수 있는 기간이 아닙니다.';
      case 'SPOT_CLOSED':
        return '마감된 스팟입니다.';
      case 'UNKNOWN_SPOT':
        return '알 수 없는 스팟입니다 (QR을 다시 확인하세요).';
      case 'unauthorized':
        return '가입(전화+이메일) 후에 받을 수 있습니다 — 더보기 → 가입/설정.';
      // R-스팟-현장결속 — 현장 인증 관련 거절 (서버는 코드만, 문구는 여기서).
      case 'SPOT_PRESENCE_REQUIRED':
        return '이 스팟은 현장에서 몸으로 인증해야 받을 수 있습니다.';
      case 'SPOT_PRESENCE_CHALLENGE_INVALID':
        return '지시가 유효하지 않습니다 — 스팟 앞에서 다시 시작하세요.';
      case 'SPOT_PRESENCE_CHALLENGE_USED':
        return '이미 사용한 지시입니다 — 다시 받아 새로 수행하세요.';
      case 'SPOT_PRESENCE_CHALLENGE_EXPIRED':
        return '지시 시간이 지났습니다 — 다시 받아 바로 수행하세요.';
      case 'SPOT_PRESENCE_TOO_FAST':
        return '너무 빨랐습니다 — 지시대로 실제로 걸어야 합니다.';
      case 'SPOT_PRESENCE_STEPS_OUT_OF_BAND':
        return '걸음 수가 지시와 맞지 않습니다 — 다시 받아 수행하세요.';
      case 'SPOT_PRESENCE_LEGS_MISMATCH':
        return '수행 내용이 지시와 다릅니다 — 다시 받아 수행하세요.';
      default:
        return e.status === 0 ? '통신이 없어 받을 수 없습니다 — 온라인에서 다시 시도하세요.' : e.message;
    }
  }
  return String(e instanceof Error ? e.message : e);
}

export function SpotScreen() {
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);
  const presence = useSpotPresence();
  const [spots, setSpots] = useState<SpotListEntry[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);

  // 화면을 벗어나면 센서 구독을 반드시 닫는다 (세션 밖에서 위치를 듣지 않는다).
  useEffect(() => () => spotPresenceService.dismiss(), []);

  const refresh = useCallback(() => {
    setSpots(null);
    void spotService
      .loadSpots()
      .then(setSpots)
      .catch(() => setSpots([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** 청구 결과 안내 (현장 인증 유무 공통). */
  const announce = (res: { minted: boolean; amountDshv: number }) => {
    if (res.minted) {
      Alert.alert(
        '스팟 보물 받음',
        `${fmtShv(res.amountDshv)}가 지갑에 담겼습니다.\n(BONUS 계보 — 걸음 코인과 영구 구분됩니다)`,
      );
    } else {
      Alert.alert('스탬프 완료', '이 장소 방문이 기록되었습니다 (코인이 없는 스팟).');
    }
    refresh();
  };

  /**
   * 현장 인증 시작 — 서버에서 1회용 지시를 받아 세션을 연다. 근접 판정 기준은
   * 지시 응답의 스팟 공개 위치다(사업장 좌표 — 사용자 좌표 아님). 수행이 끝나면
   * 아래 useEffect가 보고를 실어 청구한다.
   */
  const startPresence = (spotId: string) => {
    setBusy(true);
    void spotService
      .requestChallenge(spotId)
      .then((ch) => spotPresenceService.start(spotId, ch.location, ch.challengeId, ch.legs))
      .catch((e) => Alert.alert('시작할 수 없음', rejectMessage(e)))
      .finally(() => setBusy(false));
  };

  /**
   * 청구 — 현장 인증을 요구하는 스팟이면 먼저 지시·수행 세션을 시작하고, 아니면
   * 종전대로 즉시 청구한다. 요구 여부를 모르는 스팟(목록 밖 QR)은 즉시 청구를
   * 시도하고, 서버가 SPOT_PRESENCE_REQUIRED로 답하면 현장 인증으로 전환한다.
   */
  const doClaim = (spotId: string, requirePresence: boolean | undefined) => {
    setScanning(false);
    if (requirePresence) {
      startPresence(spotId);
      return;
    }
    setBusy(true);
    void spotService
      .claim(spotId)
      .then(announce)
      .catch((e) => {
        if (e instanceof ApiError && e.message === 'SPOT_PRESENCE_REQUIRED') {
          startPresence(spotId);
          return;
        }
        Alert.alert('받을 수 없음', rejectMessage(e));
      })
      .finally(() => setBusy(false));
  };

  // 현장 수행이 끝나면(SUCCESS) 보고를 실어 청구한다. 실패·이탈은 안내만 한다.
  useEffect(() => {
    const s = presence.session;
    if (!s || s.state === 'ACTIVE') return;
    if (s.state === 'SUCCESS') {
      const report = spotPresenceService.report();
      if (!report) return;
      spotPresenceService.dismiss();
      setBusy(true);
      void spotService
        .claim(s.spotId, report)
        .then(announce)
        .catch((e) => Alert.alert('받을 수 없음', rejectMessage(e)))
        .finally(() => setBusy(false));
      return;
    }
    spotPresenceService.dismiss();
    Alert.alert(
      '현장 인증 실패',
      s.state === 'TOO_FAR'
        ? '스팟에서 너무 멉니다 — 가게 앞에서 다시 시작하세요.'
        : s.state === 'BLOCKED'
          ? '위치 조작이 감지되어 중단되었습니다.'
          : '지시대로 수행되지 않았습니다 — 다시 시작해 주세요.',
    );
    // announce/refresh는 안정적인 참조가 아니므로 세션 상태만 의존한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presence.session?.state]);

  const onScanned = (data: string) => {
    const spotId = parseSpotQr(data);
    if (!spotId) {
      setScanning(false);
      Alert.alert('QR 오류', '스팟 QR이 아닙니다.');
      return;
    }
    // 목록에 있으면 현장 인증 요구 여부를 미리 안다. 목록 밖(미충전 스탬프 스팟)은
    // undefined로 넘겨 즉시 청구 → 서버 코드에 따라 현장 인증으로 전환한다.
    doClaim(spotId, spots?.find((s) => s.spotId === spotId)?.requirePresence);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Title>🎁 스팟 보물</Title>
        <Muted>
          트레일 근처 사업장이 숨겨둔 코인입니다. 벽 QR을 스캔하거나 아래 목록에서 골라 받으세요 —
          선착순 1인 1회입니다. 코인이 없는 스팟은 방문 스탬프만 찍힙니다.
        </Muted>
        {!registered && <Text style={styles.warn}>받으려면 가입이 필요합니다 (더보기 → 가입/설정).</Text>}
        <Pressable style={[styles.scanBtn, busy && styles.btnDisabled]} onPress={() => setScanning(true)} disabled={busy}>
          <Text style={styles.scanBtnText}>📷 스팟 QR 스캔</Text>
        </Pressable>
      </Card>

      <View style={styles.listHead}>
        <Title>근처 스팟</Title>
        <Button title="새로고침" color={colors.primary} onPress={refresh} disabled={busy} />
      </View>

      {spots === null ? (
        <Muted>불러오는 중…</Muted>
      ) : spots.length === 0 ? (
        <Muted>지금 코인이 있는 스팟이 없습니다. (코인이 없는 스팟은 지도에 뜨지 않습니다.)</Muted>
      ) : (
        spots.map((s) => (
          <Card key={s.spotId}>
            <Text style={styles.spotName}>{s.displayName}</Text>
            <Muted>
              1인당 {fmtShv(s.perClaimDshv)} · 남은 인원 {s.remainingSlots} / {s.totalSlots}명
            </Muted>
            <Muted>
              위치 {s.location.lat.toFixed(4)}, {s.location.lon.toFixed(4)} · 규모 {fmtShv(s.depositTotalDshv)}
            </Muted>
            {s.requirePresence && <Text style={styles.presenceTag}>🚶 현장 인증 필요 — 가게 앞에서 지시대로 걷기</Text>}
            <Pressable
              style={[styles.claimBtn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => doClaim(s.spotId, s.requirePresence)}
            >
              <Text style={styles.claimBtnText}>{s.requirePresence ? '현장 인증 시작' : '여기서 받기'}</Text>
            </Pressable>
          </Card>
        ))
      )}

      <Muted>남은 인원이 0이 되면 스팟은 지도에서 사라집니다 — 걸으며 갈지 미리 정하세요.</Muted>

      {/* 현장 결속 세션 — 서버가 낸 1회용 지시를 그 자리에서 수행한다 (R-스팟-현장결속).
          좌표는 화면 어디에도 표시하지 않는다 — 남는 것은 걸음 수뿐이다. */}
      <Modal visible={presence.session !== null} animationType="slide" transparent>
        <View style={styles.presenceWrap}>
          <View style={styles.presenceCard}>
            {presence.sensorUnavailable ? (
              <>
                <Text style={styles.presenceTitle}>센서를 쓸 수 없습니다</Text>
                <Muted>
                  현장 인증에는 위치 권한과 만보기가 필요합니다. 권한을 허용하거나 만보기가 있는 기기에서
                  시도해 주세요.
                </Muted>
              </>
            ) : presence.session?.state === 'ACTIVE' ? (
              <>
                <Text style={styles.presenceTitle}>
                  지시 {presence.session.legIndex + 1} / {presence.session.legCount}
                </Text>
                <Text style={styles.presenceLeg}>
                  {DIR_LABEL[presence.session.currentLeg.dir]}으로 {presence.session.currentLeg.steps}걸음
                </Text>
                <Text style={styles.presenceSteps}>
                  {presence.session.stepsInLeg} / {presence.session.currentLeg.steps} 걸음
                </Text>
                <Muted>지시대로 실제로 걸어야 합니다. 위치는 저장되지 않습니다 — 걸음만 셉니다.</Muted>
              </>
            ) : (
              <Text style={styles.presenceTitle}>확인 중…</Text>
            )}
            <Button title="취소" color={colors.muted} onPress={() => spotPresenceService.dismiss()} />
          </View>
        </View>
      </Modal>

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={styles.scanWrap}>
          <QrScanner onScanned={onScanned} hint="스팟 벽 QR을 비추세요 — spotId만 담깁니다 (비밀키 없음)" />
          <Button title="취소" color={colors.muted} onPress={() => setScanning(false)} />
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 4 },
  warn: { color: colors.warn, marginVertical: 6 },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 8 },
  spotName: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  scanBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  scanBtnText: { color: 'white', fontWeight: '800', fontSize: 16 },
  claimBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  claimBtnText: { color: 'white', fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },
  scanWrap: { flex: 1, padding: 16, gap: 12, backgroundColor: 'black' },
  presenceTag: { color: colors.detour, fontSize: 13, fontWeight: '700', marginTop: 6 },
  presenceWrap: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.55)' },
  presenceCard: { backgroundColor: 'white', borderRadius: 16, padding: 20, gap: 10 },
  presenceTitle: { fontSize: 15, fontWeight: '700', color: colors.muted },
  presenceLeg: { fontSize: 28, fontWeight: '900', color: colors.primary },
  presenceSteps: { fontSize: 18, fontWeight: '700' },
});
