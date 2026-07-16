/**
 * 스팟 보물 운영 (M12 — docs/몸인증_보물마이닝_설계.md 4장) — 사업자 UI.
 *
 * 사업자(호텔·식당·주유소)가 자기 사업장에 코인을 숨겨 손님을 유인한다. 핵심 원칙:
 * 사업자는 발행 주체가 아니다 — 마켓에서 구매/생성한 자기 코인을 보물 리저브로
 * **예치(소각)**한 만큼만 서버가 손님에게 재배포한다(총량 보존). 무기명 베어러가
 * 아니라 서버 선착순 회계다(M10 폐기). 남은 예치 소각분은 회수되지 않는다.
 *
 * 흐름: 스팟 생성 → 자기 코인 예치(소각) → 손님이 벽 QR 스캔 → 서버 선착순 지급.
 * 제1원칙: 더보기 아래 선택 기능 — 기본 걷기·지불 경험(0층)은 손대지 않는다.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { SPOT_PER_CLAIM_MAX_DSHV, SPOT_PER_CLAIM_MIN_DSHV, type GeoPoint } from '@shvil/shared';
import { ApiError, type SpotMineEntry } from '../core/api';
import { isProvisionalMemberId } from '../core/identity';
import { spotQrLink, spotService } from '../core/spotService';
import { useWallet } from '../core/walletService';
import { Card, Muted, Title, colors, fmtShv } from '../ui/common';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;

/** 랜덤 spotId — /^[a-z0-9-]{3,64}$/ 충족 (표시명이 한글이어도 안전). */
function newSpotId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `spot-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** SHV 문자열 → dSHV 정수 (0.1 SHV = 1 dSHV). 유효하지 않으면 null. */
function shvToDshv(text: string): number | null {
  const shv = Number(text.trim());
  if (!Number.isFinite(shv) || shv <= 0) return null;
  const dshv = Math.round(shv * 10);
  return dshv > 0 ? dshv : null;
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.message) {
      case 'INVALID_SPOT_SPEC':
        return '스팟 정보가 올바르지 않습니다 (이름·위치·1인당 양·기간 확인).';
      case 'SPOT_ID_TAKEN':
        return '이미 쓰인 스팟 ID입니다 — 다시 시도하세요.';
      case 'NOT_SPOT_SPONSOR':
        return '이 스팟의 사업자만 예치할 수 있습니다.';
      case 'SPOT_CLOSED':
        return '마감된 스팟입니다.';
      case 'INVALID_DEPOSIT_COIN':
        return '예치 코인이 유효하지 않습니다 (자기 소유 코인만 예치할 수 있습니다).';
      case 'COIN_ALREADY_DEPOSITED':
        return '이미 예치된 코인입니다 (같은 코인 이중 예치 불가).';
      case 'unauthorized':
        return '가입(전화+이메일) 후에 운영할 수 있습니다 — 더보기 → 가입/설정.';
      default:
        return e.status === 0 ? '통신이 없어 처리하지 못했습니다 — 온라인에서 다시 시도하세요.' : e.message;
    }
  }
  return String(e instanceof Error ? e.message : e);
}

export function SpotSponsorScreen() {
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);
  const spendableDshv = w.walkedBalanceDshv + w.receivedBalanceDshv + w.bonusBalanceDshv;

  const [name, setName] = useState('');
  const [perClaimShv, setPerClaimShv] = useState('3');
  const [days, setDays] = useState(String(DEFAULT_DAYS));
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [visibleNote, setVisibleNote] = useState(true);
  const [busy, setBusy] = useState(false);

  const [mySpots, setMySpots] = useState<SpotMineEntry[] | null>(null);
  const [reservePublicKey, setReservePublicKey] = useState<string | null>(null);
  const [depositInputs, setDepositInputs] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    if (!registered) {
      setMySpots([]);
      return;
    }
    setMySpots(null);
    void spotService
      .loadMySpots()
      .then((res) => {
        setMySpots(res.spots);
        setReservePublicKey(res.reservePublicKey);
      })
      .catch(() => setMySpots([]));
  }, [registered]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const captureLocation = () => {
    setBusy(true);
    void (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('권한 필요', '스팟 위치 등록에는 위치 권한이 필요합니다.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
    })()
      .catch((e) => Alert.alert('위치 조회 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  const createSpot = () => {
    if (!name.trim()) {
      Alert.alert('입력 오류', '사업장 표시명을 입력하세요.');
      return;
    }
    if (!location) {
      Alert.alert('입력 오류', '"현재 위치로 등록"으로 위치를 먼저 지정하세요.');
      return;
    }
    const perClaimDshv = shvToDshv(perClaimShv);
    if (perClaimDshv === null || perClaimDshv < SPOT_PER_CLAIM_MIN_DSHV || perClaimDshv > SPOT_PER_CLAIM_MAX_DSHV) {
      Alert.alert('입력 오류', `1인당 양은 ${SPOT_PER_CLAIM_MIN_DSHV / 10} ~ ${SPOT_PER_CLAIM_MAX_DSHV / 10} SHV 사이여야 합니다.`);
      return;
    }
    const dayN = Math.round(Number(days.trim()));
    if (!Number.isFinite(dayN) || dayN < 1) {
      Alert.alert('입력 오류', '유효 기간(일)은 1 이상이어야 합니다.');
      return;
    }
    const now = Date.now();
    setBusy(true);
    void spotService
      .create({
        spotId: newSpotId(),
        regionId: 'israel-national',
        displayName: name.trim(),
        location,
        perClaimDshv,
        validFrom: now,
        validUntil: now + dayN * DAY_MS,
      })
      .then((res) => {
        setReservePublicKey(res.reservePublicKey);
        Alert.alert(
          '스팟 생성됨',
          '아직 코인이 없어 지도에는 뜨지 않습니다. 아래 목록에서 코인을 예치(소각)하면 손님이 받을 수 있습니다.',
        );
        setName('');
        refresh();
      })
      .catch((e) => Alert.alert('생성 실패', errMessage(e)))
      .finally(() => setBusy(false));
  };

  const deposit = (spotId: string) => {
    const dshv = shvToDshv(depositInputs[spotId] ?? '');
    if (dshv === null) {
      Alert.alert('입력 오류', '예치할 SHV 수량을 입력하세요.');
      return;
    }
    if (dshv > spendableDshv) {
      Alert.alert('잔액 부족', `예치 가능 잔액: ${fmtShv(spendableDshv)}`);
      return;
    }
    if (!reservePublicKey) {
      Alert.alert('오류', '리저브 주소를 아직 받지 못했습니다 — 새로고침 후 다시 시도하세요.');
      return;
    }
    setBusy(true);
    void spotService
      .deposit(spotId, reservePublicKey, dshv)
      .then((res) => {
        setDepositInputs((m) => ({ ...m, [spotId]: '' }));
        Alert.alert(
          '예치 완료',
          `${fmtShv(res.depositedDshv)}를 소각해 재배포 잔고에 넣었습니다.\n선착순 ${res.totalSlots}명 (남은 ${res.remainingSlots}명).`,
        );
        refresh();
      })
      .catch((e) => Alert.alert('예치 실패', errMessage(e)))
      .finally(() => setBusy(false));
  };

  const close = (spotId: string) => {
    Alert.alert('스팟 마감', '마감하면 더는 지급되지 않고, 남은 예치 소각분은 회수되지 않습니다. 진행할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '마감',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void spotService
            .close(spotId)
            .then(() => refresh())
            .catch((e) => Alert.alert('마감 실패', errMessage(e)))
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Title>🏪 스팟 보물 운영 (사업자)</Title>
        <Muted>
          내 사업장에 코인을 숨겨 손님을 유인합니다. 사업자는 발행하지 못합니다 — 내가 마켓에서 구매하거나
          걸어서 만든 코인을 **예치(소각)**한 만큼만 서버가 손님에게 재배포합니다(총량 보존). 무기명 QR이
          아니라 서버 선착순 회계입니다.
        </Muted>
        {!registered && <Text style={styles.warn}>운영에는 가입이 필요합니다 (더보기 → 가입/설정).</Text>}
        <Muted>예치 가능 잔액: {fmtShv(spendableDshv)}</Muted>
      </Card>

      <Card>
        <Title>새 스팟 만들기</Title>
        <Muted>사업장 표시명:</Muted>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="예: 갈릴리 카페" />

        <Muted>1인당 지급액 (SHV):</Muted>
        <TextInput
          style={styles.input}
          value={perClaimShv}
          onChangeText={setPerClaimShv}
          keyboardType="decimal-pad"
          placeholder="예: 3"
        />

        <Muted>유효 기간 (일):</Muted>
        <TextInput style={styles.input} value={days} onChangeText={setDays} keyboardType="number-pad" placeholder="30" />

        <Muted>위치 (사업장 — 공개됩니다):</Muted>
        <Text style={styles.locText}>
          {location ? `등록됨 (${location.lat.toFixed(4)}, ${location.lon.toFixed(4)})` : '아직 등록되지 않음'}
        </Text>
        <Button title={busy ? '처리 중…' : '현재 위치로 등록'} color={colors.primary} onPress={captureLocation} disabled={busy} />

        <View style={styles.row}>
          <Text>사업장 위치 공개 이해함</Text>
          <Switch value={visibleNote} onValueChange={setVisibleNote} />
        </View>
        <Muted>
          엔젤 집과 달리 스팟은 사업장이므로 위치가 공개됩니다(눈금화 없음). 걷는 사람이 지도를 보고
          "걸으며 갈지"를 정할 수 있게 하기 위함입니다. 정확 공개 수위는 운영 정책으로 조정될 수 있습니다.
        </Muted>

        <Button
          title={busy ? '생성 중…' : '스팟 생성 (예치 전)'}
          color={colors.primary}
          onPress={createSpot}
          disabled={busy || !registered || !visibleNote}
        />
      </Card>

      <Title>내 스팟</Title>
      {mySpots === null ? (
        <Muted>불러오는 중…</Muted>
      ) : mySpots.length === 0 ? (
        <Muted>아직 스팟이 없습니다. 위에서 새 스팟을 만드세요.</Muted>
      ) : (
        mySpots.map((s) => (
          <Card key={s.spotId}>
            <Text style={styles.spotName}>
              {s.displayName} {s.status === 'CLOSED' ? '(마감됨)' : ''}
            </Text>
            <Muted>
              1인당 {fmtShv(s.perClaimDshv)} · 예치 {fmtShv(s.depositTotalDshv)} · 지급 {s.issuedCount}명 · 남은{' '}
              {s.remainingSlots} / {s.totalSlots}명
            </Muted>
            <Muted>손님용 QR 링크 (인쇄해 붙이세요):</Muted>
            <Text selectable style={styles.qrLink}>
              {spotQrLink(s.spotId)}
            </Text>
            {s.status !== 'CLOSED' && (
              <>
                <Muted>예치(소각)할 SHV:</Muted>
                <View style={styles.depositRow}>
                  <TextInput
                    style={[styles.input, styles.depositInput]}
                    value={depositInputs[s.spotId] ?? ''}
                    onChangeText={(v) => setDepositInputs((m) => ({ ...m, [s.spotId]: v }))}
                    keyboardType="decimal-pad"
                    placeholder="예: 30"
                  />
                  <View style={styles.depositBtn}>
                    <Button title="예치" color={colors.primary} onPress={() => deposit(s.spotId)} disabled={busy} />
                  </View>
                </View>
                <Button title="스팟 마감" color={colors.warn} onPress={() => close(s.spotId)} disabled={busy} />
              </>
            )}
          </Card>
        ))
      )}
      <Muted>
        예치한 코인은 리저브에 영구 봉인(소각)되어 지갑에서 빠집니다. 발행 슬롯 수 = 예치총액 ÷ 1인당 양이므로
        지급이 예치를 넘을 수 없습니다.
      </Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 6 },
  warn: { color: colors.warn, marginVertical: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 6 },
  locText: { fontWeight: '600', marginVertical: 4 },
  spotName: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  qrLink: { fontFamily: 'monospace', color: colors.detour, marginVertical: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
    fontSize: 16,
  },
  depositRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  depositInput: { flex: 1 },
  depositBtn: { minWidth: 72 },
});
