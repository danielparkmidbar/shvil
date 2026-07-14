/**
 * 내 포인트 (엔젤 모드) — 지시서 4장 엔젤 모드 화면 표.
 *
 * - 모드 전환 토글: "오늘의 엔젤이 내일의 쉬빌리스트" — 토글 한 번으로 전환.
 * - 위치 등록: expo-location 1회 조회. 이 좌표는 본인이 자발 공개하는 엔젤
 *   포인트다 (위치 비저장 원칙의 유일한 예외 — 이동 궤적이 아니다).
 * - 공개 on/off: 엔젤의 자율성 — 언제든 비공개 가능.
 * - 서비스 등록: 수면(방/소파/마당 텐트), 인터넷/샤워/식사, 수용 인원·조건.
 * - 저장 → PUT /angels/me. 최초 등록 보너스 20 SHV grant 수신 시 즉시 민팅.
 * - 첫 접대 보너스 30 SHV 수동 재시도 버튼.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import type { GeoPoint } from '@shvil/shared';
import type { AngelProfileInput, BedService } from '../core/api';
import { isFirstHostingClaimed, loadAngelProfile, maybeClaimFirstHosting, saveAngelProfile } from '../core/angelService';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet, wallet } from '../core/walletService';
import { Card, Muted, Title, colors, fmtShv } from '../ui/common';

const BED_OPTIONS: { value: BedService; label: string }[] = [
  { value: 'ROOM', label: '🛏 방' },
  { value: 'SOFA', label: '🛋 소파' },
  { value: 'TENT', label: '⛺ 마당 텐트' },
  { value: null, label: '수면 제공 없음' },
];

export function MyAngelPointScreen() {
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);

  const [name, setName] = useState('');
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [visible, setVisible] = useState(true);
  const [bed, setBed] = useState<BedService>('ROOM');
  const [internet, setInternet] = useState(false);
  const [shower, setShower] = useState(false);
  const [meal, setMeal] = useState(false);
  const [capacityText, setCapacityText] = useState('2');
  const [conditions, setConditions] = useState('');
  const [busy, setBusy] = useState(false);
  const [hostingClaimed, setHostingClaimed] = useState(true);

  useEffect(() => {
    void loadAngelProfile().then((p) => {
      if (!p) return;
      setName(p.name);
      setLocation(p.location);
      setVisible(p.visible);
      setBed(p.services.bed);
      setInternet(p.services.internet);
      setShower(p.services.shower);
      setMeal(p.services.meal);
      setCapacityText(String(p.capacity));
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

  const save = () => {
    if (!name.trim()) {
      Alert.alert('입력 오류', '포인트 이름을 입력하세요.');
      return;
    }
    if (!location) {
      Alert.alert('입력 오류', '"현재 위치로 등록"으로 위치를 먼저 지정하세요.');
      return;
    }
    const capacity = Math.max(1, parseInt(capacityText, 10) || 1);
    const profile: AngelProfileInput = {
      name: name.trim(),
      location,
      services: { bed, internet, shower, meal },
      capacity,
      conditions: conditions.trim(),
      visible,
    };
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
      </Card>

      <Card>
        <Title>서비스 등록</Title>
        <Muted>수면 조건:</Muted>
        <View style={styles.bedRow}>
          {BED_OPTIONS.map((opt) => (
            <View key={String(opt.value)} style={styles.bedBtn}>
              <Button
                title={opt.label}
                color={bed === opt.value ? colors.primary : colors.muted}
                onPress={() => setBed(opt.value)}
              />
            </View>
          ))}
        </View>
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
        <Muted>수용 인원:</Muted>
        <TextInput style={styles.input} value={capacityText} onChangeText={setCapacityText} keyboardType="number-pad" />
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
  bedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 },
  bedBtn: { flexGrow: 1, minWidth: '45%' },
});
