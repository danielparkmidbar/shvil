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
import { ApiError, type SpotListEntry } from '../core/api';
import { isProvisionalMemberId } from '../core/identity';
import { parseSpotQr, spotService } from '../core/spotService';
import { useWallet } from '../core/walletService';
import { QrScanner } from '../ui/QrScanner';
import { Card, Muted, Title, colors, fmtShv } from '../ui/common';

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
      default:
        return e.status === 0 ? '통신이 없어 받을 수 없습니다 — 온라인에서 다시 시도하세요.' : e.message;
    }
  }
  return String(e instanceof Error ? e.message : e);
}

export function SpotScreen() {
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);
  const [spots, setSpots] = useState<SpotListEntry[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);

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

  const doClaim = (spotId: string) => {
    setScanning(false);
    setBusy(true);
    void spotService
      .claim(spotId)
      .then((res) => {
        if (res.minted) {
          Alert.alert(
            '스팟 보물 받음',
            `${fmtShv(res.amountDshv)}가 지갑에 담겼습니다.\n(BONUS 계보 — 걸음 코인과 영구 구분됩니다)`,
          );
        } else {
          Alert.alert('스탬프 완료', '이 장소 방문이 기록되었습니다 (코인이 없는 스팟).');
        }
        refresh();
      })
      .catch((e) => Alert.alert('받을 수 없음', rejectMessage(e)))
      .finally(() => setBusy(false));
  };

  const onScanned = (data: string) => {
    const spotId = parseSpotQr(data);
    if (!spotId) {
      setScanning(false);
      Alert.alert('QR 오류', '스팟 QR이 아닙니다.');
      return;
    }
    doClaim(spotId);
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
            <Pressable
              style={[styles.claimBtn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => doClaim(s.spotId)}
            >
              <Text style={styles.claimBtnText}>여기서 받기</Text>
            </Pressable>
          </Card>
        ))
      )}

      <Muted>남은 인원이 0이 되면 스팟은 지도에서 사라집니다 — 걸으며 갈지 미리 정하세요.</Muted>

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
});
