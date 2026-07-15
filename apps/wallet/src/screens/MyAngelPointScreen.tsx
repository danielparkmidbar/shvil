/**
 * 내 포인트 (엔젤 모드) — 지시서 4장 엔젤 모드 화면 표.
 *
 * - 모드 전환 토글: "오늘의 엔젤이 내일의 쉬빌리스트" — 토글 한 번으로 전환.
 * - 위치 등록: expo-location 1회 조회. 이 좌표는 본인이 자발 공개하는 엔젤
 *   포인트다 (위치 비저장 원칙의 유일한 예외 — 이동 궤적이 아니다).
 * - 공개 on/off: 엔젤의 자율성 — 언제든 비공개 가능.
 * - 서비스 등록: 수면은 복수 선택 — 유형(방/소파/마당 텐트)별 수용 인원
 *   (2026-07-15 다니엘 쌤). 총 수용 인원은 합계로 자동 계산된다.
 *   인터넷/샤워/식사, 수용 조건은 기존대로.
 * - 저장 → PUT /angels/me. 최초 등록 보너스 20 SHV grant 수신 시 즉시 민팅.
 * - 첫 접대 보너스 30 SHV 수동 재시도 버튼.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import type { GeoPoint } from '@shvil/shared';
import type { AngelProfileInput } from '../core/api';
import {
  BED_COUNT_MAX,
  bedCountsFromProfile,
  bedFieldsFromCounts,
  isFirstHostingClaimed,
  loadAngelProfile,
  maybeClaimFirstHosting,
  saveAngelProfile,
  type BedCounts,
} from '../core/angelService';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet, wallet } from '../core/walletService';
import { Card, Muted, Title, colors, fmtShv } from '../ui/common';

const BED_KINDS: { key: keyof BedCounts; label: string }[] = [
  { key: 'room', label: '🛏 방 베드' },
  { key: 'sofa', label: '🛋 거실 소파' },
  { key: 'tent', label: '⛺ 마당 텐트' },
];

export function MyAngelPointScreen() {
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);

  const [name, setName] = useState('');
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [visible, setVisible] = useState(true);
  /** M6 (R-3): "지금 손님 받기 가능" — 가능 여부 수준만 자발 공개. */
  const [available, setAvailable] = useState(true);
  /** 유형별 수용 인원 (잠자리 복수 선택 — 0 = 미제공). 총원은 합계로 파생. */
  const [beds, setBeds] = useState<BedCounts>({ room: 2, sofa: 0, tent: 0 });
  const [internet, setInternet] = useState(false);
  const [shower, setShower] = useState(false);
  const [meal, setMeal] = useState(false);
  const [conditions, setConditions] = useState('');
  const [busy, setBusy] = useState(false);
  const [hostingClaimed, setHostingClaimed] = useState(true);

  useEffect(() => {
    void loadAngelProfile().then((p) => {
      if (!p) return;
      setName(p.name);
      setLocation(p.location);
      setVisible(p.visible);
      setAvailable(p.available !== false);
      // 옛 레코드(beds 없음)는 단일 bed 유형에 capacity를 넣어 보여준다 (폴백).
      setBeds(bedCountsFromProfile(p));
      setInternet(p.services.internet);
      setShower(p.services.shower);
      setMeal(p.services.meal);
      setConditions(p.conditions);
    });
    void isFirstHostingClaimed().then((claimed) => setHostingClaimed(claimed));
  }, []);

  const captureLocation = () => {
    setBusy(true);
    void (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('권한 필요', '엔젤 포인트 등록에는 위치 권한이 필요합니다.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
    })()
      .catch((e) => Alert.alert('위치 조회 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  /**
   * 입력 상태 → 서버 계약 프로필. 유형별 인원(beds)에서 하위 호환 필드를
   * 파생한다: bed = 최다 유형, capacity = 합계 (bedFieldsFromCounts).
   */
  const buildProfile = (loc: GeoPoint, availableNow: boolean): AngelProfileInput => {
    const bedFields = bedFieldsFromCounts(beds);
    return {
      name: name.trim(),
      location: loc,
      services: { bed: bedFields.bed, internet, shower, meal, ...(bedFields.beds ? { beds: bedFields.beds } : {}) },
      capacity: bedFields.capacity,
      conditions: conditions.trim(),
      visible,
      available: availableNow,
    };
  };

  const save = () => {
    if (!name.trim()) {
      Alert.alert('입력 오류', '포인트 이름을 입력하세요.');
      return;
    }
    if (!location) {
      Alert.alert('입력 오류', '"현재 위치로 등록"으로 위치를 먼저 지정하세요.');
      return;
    }
    const profile = buildProfile(location, available);
    setBusy(true);
    void saveAngelProfile(profile)
      .then((result) => {
        if (result.registrationBonusCoin) {
          Alert.alert(
            '엔젤 등록 완료',
            `등록 보너스 ${fmtShv(result.registrationBonusCoin.amountDshv)}가 지갑에 발행되었습니다.\n(기간·수량 한정 프로모션 — 이 기기에서 민팅되었습니다)`,
          );
        } else if (result.synced) {
          Alert.alert('저장 완료', '엔젤 포인트가 디렉토리에 반영되었습니다.');
        } else {
          Alert.alert('로컬 저장됨', `기기에는 저장되었지만 서버 반영에 실패했습니다.\n${result.syncError ?? ''}\n온라인이 되면 다시 저장하세요.`);
        }
      })
      .catch((e) => Alert.alert('저장 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  /**
   * M6 (R-3): 가능 여부 토글 — 프로필이 갖춰져 있으면 즉시 서버에 반영한다.
   * 서버에 가는 것은 "지금 손님을 받을 수 있는가" + 갱신 시각뿐 — 날짜·캘린더 없음.
   */
  const toggleAvailable = (on: boolean) => {
    setAvailable(on);
    if (!name.trim() || !location) return; // 아직 미등록 — "저장" 때 함께 반영된다.
    const profile = buildProfile(location, on);
    setBusy(true);
    void saveAngelProfile(profile)
      .then((result) => {
        if (!result.synced) {
          Alert.alert('로컬 저장됨', `서버 반영에 실패했습니다.\n${result.syncError ?? ''}\n온라인이 되면 "저장"을 다시 누르세요.`);
        }
      })
      .catch((e) => Alert.alert('반영 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  const retryFirstHosting = () => {
    setBusy(true);
    void maybeClaimFirstHosting()
      .then((coin) => {
        if (coin) {
          setHostingClaimed(true);
          Alert.alert('첫 접대 보너스', `${fmtShv(coin.amountDshv)}가 지갑에 발행되었습니다.`);
        } else {
          void isFirstHostingClaimed().then(setHostingClaimed);
          Alert.alert(
            '보너스 청구 불가',
            '조건: 정식 가입 + 수령(접대) 코인 보유 + 미수령 상태. 이미 받았다면 다시 받을 수 없습니다.',
          );
        }
      })
      .catch((e) => Alert.alert('청구 실패 (오프라인?)', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  /** 총 수용 인원 = 유형별 인원 합계 (자동 계산 — 별도 입력 없음). */
  const totalCapacity = beds.room + beds.sofa + beds.tent;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Title>모드</Title>
        <View style={styles.row}>
          <Text style={styles.modeLabel}>{w.mode === 'ANGEL' ? '🏠 엔젤 모드 — 맞이하는 중' : '🥾 리스트 모드 — 걷는 중'}</Text>
          <Switch
            value={w.mode === 'ANGEL'}
            onValueChange={(on) => void wallet.setMode(on ? 'ANGEL' : 'LIST')}
          />
        </View>
        <Muted>오늘의 엔젤이 내일의 쉬빌리스트 — 지갑·코인·회원 번호는 두 모드가 공유합니다.</Muted>
      </Card>

      <Card>
        <Title>내 엔젤 포인트</Title>
        {!registered && (
          <Text style={styles.warn}>서버 등록에는 가입이 필요합니다 (더보기 → 가입/설정). 입력 내용은 기기에 저장됩니다.</Text>
        )}
        <Muted>포인트 이름:</Muted>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="예: 다프나의 집" />

        <Muted>위치:</Muted>
        <Text style={styles.locText}>
          {location ? `등록됨 (${location.lat.toFixed(4)}, ${location.lon.toFixed(4)})` : '아직 등록되지 않음'}
        </Text>
        <Button title={busy ? '처리 중…' : '현재 위치로 등록'} color={colors.primary} onPress={captureLocation} disabled={busy} />
        <Muted>
          이 좌표는 순례자들에게 안내하기 위해 본인이 자발적으로 공개하는 엔젤 포인트입니다. 이동
          경로 추적이 아니며, 공개를 끄면 지도에서 즉시 사라집니다.
        </Muted>
        <Muted>
          지도에는 대략 위치만 공개됩니다(약 1km). 정확한 좌표는 이 기기에만 저장되고 서버로
          보내지 않으며, 정확한 주소는 승인한 상대에게만 메시지로 직접 전달하세요.
        </Muted>

        <View style={styles.row}>
          <Text>지도에 공개</Text>
          <Switch value={visible} onValueChange={setVisible} />
        </View>
        <Muted>공개 여부는 언제든 바꿀 수 있습니다 — 엔젤의 자율입니다.</Muted>

        <View style={styles.row}>
          <Text>지금 손님 받기 가능</Text>
          <Switch value={available} onValueChange={toggleAvailable} disabled={busy} />
        </View>
        <Muted>
          걷는 사람들의 지도에 "지금 손님 받는 중 / 지금은 어려움"으로 표시됩니다. 공개되는
          것은 이 가능 여부와 갱신 시각뿐 — 구체 날짜는 신청·회신 메시지로만 오갑니다.
          꺼도 신청은 받을 수 있으며, 수락 여부는 언제나 엔젤의 결정입니다.
        </Muted>
      </Card>

      <Card>
        <Title>서비스 등록</Title>
        <Muted>잠자리 (복수 선택 — 유형별로 몇 명까지 받을 수 있는지):</Muted>
        {BED_KINDS.map(({ key, label }) => (
          <View key={key} style={styles.row}>
            <Text style={beds[key] > 0 ? styles.bedOn : styles.bedOff}>{label}</Text>
            <View style={styles.stepper}>
              <View style={styles.stepBtn}>
                <Button
                  title="−"
                  color={colors.muted}
                  disabled={busy || beds[key] <= 0}
                  onPress={() => setBeds((b) => ({ ...b, [key]: Math.max(0, b[key] - 1) }))}
                />
              </View>
              <Text style={styles.bedCount}>{beds[key] > 0 ? `${beds[key]}명` : '미제공'}</Text>
              <View style={styles.stepBtn}>
                <Button
                  title="＋"
                  color={colors.primary}
                  disabled={busy || beds[key] >= BED_COUNT_MAX}
                  onPress={() => setBeds((b) => ({ ...b, [key]: Math.min(BED_COUNT_MAX, b[key] + 1) }))}
                />
              </View>
            </View>
          </View>
        ))}
        <Muted>
          {totalCapacity > 0
            ? `총 수용 인원 ${totalCapacity}명 (유형별 인원의 합계로 자동 계산됩니다)`
            : '잠자리 미제공 — 식사·샤워 등만 내어줄 수도 있습니다.'}
        </Muted>
        <View style={styles.row}>
          <Text>📶 인터넷</Text>
          <Switch value={internet} onValueChange={setInternet} />
        </View>
        <View style={styles.row}>
          <Text>🚿 샤워</Text>
          <Switch value={shower} onValueChange={setShower} />
        </View>
        <View style={styles.row}>
          <Text>🍲 식사</Text>
          <Switch value={meal} onValueChange={setMeal} />
        </View>
        <Muted>수용 조건 (자기 결정 — 예: 팀만, 여성만):</Muted>
        <TextInput style={styles.input} value={conditions} onChangeText={setConditions} placeholder="예: 2인 이하, 애견 동반 불가" />
      </Card>

      <Button title={busy ? '저장 중…' : '저장 (디렉토리에 등록)'} color={colors.primary} onPress={save} disabled={busy} />

      {!hostingClaimed && (
        <Card>
          <Title>첫 접대 보너스 (30 SHV)</Title>
          <Muted>
            첫 접대는 리스트의 지불 수령으로 자동 확인됩니다. 수령 당시 오프라인이었다면 여기서
            다시 청구하세요.
          </Muted>
          <Button title="첫 접대 보너스 다시 청구" color={colors.warn} onPress={retryFirstHosting} disabled={busy} />
        </Card>
      )}

      <Muted>수령(청구 QR)은 거래 탭에서, 리스트 문의는 메시지 화면에서 확인하세요.</Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 6 },
  modeLabel: { fontSize: 16, fontWeight: '700' },
  warn: { color: colors.warn, marginBottom: 6 },
  locText: { fontWeight: '600', marginVertical: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
    fontSize: 16,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { minWidth: 44 },
  bedCount: { minWidth: 52, textAlign: 'center', fontWeight: '600' },
  bedOn: { fontWeight: '600' },
  bedOff: { color: colors.muted },
});
