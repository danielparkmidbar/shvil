/**
 * 엔젤 지도 — 주변 엔젤을 거리순 리스트로 (지시서 4장 리스트 모드 화면 표).
 *
 * GET /angels(현 위치 기준) 실패 시 캐시 → 내장 SAMPLE_ANGELS 폴백 (오프라인 우선).
 * 현 위치는 거리 계산 그 순간에만 휘발성으로 쓰고 즉시 버린다 — 저장·전송 없음
 * (위치 비저장 원칙, 지시서 0-10).
 *
 * TODO(M2 후속): 진행 방향 앞쪽 엔젤 우선 정렬 (걷기 추적의 진행 벡터 활용).
 * TODO(M2 후속): MapLibre + OSM 오프라인 지도 팩 실지도 표시.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SAMPLE_ANGELS } from '@shvil/shared';
import type { AngelDirectoryEntry, AngelServices } from '../core/api';
import { cacheAngels, directoryApi, loadCachedAngels } from '../core/directory';
import { chatService } from '../core/chatService';
import { haversineM } from '../walk/geo';
import { Card, Muted, Title, colors } from '../ui/common';
import type { MoreStackParamList } from './navTypes';

const RADIUS_KM = 50;

interface AngelListItem {
  memberId: string;
  name: string;
  distanceKm: number | null;
  services: AngelServices | null;
  conditions: string;
  capacity: number | null;
  messagingPublicKey: string | null;
  /** M6 (R-3): 엔젤이 자발 공개한 "지금 손님 받기 가능" 여부. null = 미상(캐시·샘플). */
  available: boolean | null;
  sample: boolean;
}

function serviceIcons(s: AngelServices | null): string {
  if (!s) return '';
  const icons: string[] = [];
  // 잠자리 복수 선택: beds(유형별 인원)가 있으면 "🛏2 🛋1 ⛺4"처럼 유형별로,
  // 없으면(옛 레코드) 단일 bed 아이콘으로 폴백.
  if (s.beds && ((s.beds.room ?? 0) > 0 || (s.beds.sofa ?? 0) > 0 || (s.beds.tent ?? 0) > 0)) {
    if ((s.beds.room ?? 0) > 0) icons.push(`🛏${s.beds.room}`);
    if ((s.beds.sofa ?? 0) > 0) icons.push(`🛋${s.beds.sofa}`);
    if ((s.beds.tent ?? 0) > 0) icons.push(`⛺${s.beds.tent}`);
  } else {
    if (s.bed === 'ROOM') icons.push('🛏');
    if (s.bed === 'SOFA') icons.push('🛋');
    if (s.bed === 'TENT') icons.push('⛺');
  }
  if (s.internet) icons.push('📶');
  if (s.shower) icons.push('🚿');
  if (s.meal) icons.push('🍲');
  return icons.join(' ');
}

export function AngelMapScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const [items, setItems] = useState<AngelListItem[]>([]);
  const [source, setSource] = useState<'server' | 'cache' | 'sample'>('sample');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 현 위치 1회 조회 — 이 좌표는 아래 거리 계산에만 쓰이고 함수 종료와 함께 버려진다.
      let here: { lat: number; lon: number } | null = null;
      const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (perm?.status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
        if (pos) here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      }

      let entries: AngelDirectoryEntry[] | null = null;
      let src: 'server' | 'cache' | 'sample' = 'sample';
      if (here) {
        try {
          entries = await directoryApi.getAngels(here.lat, here.lon, RADIUS_KM);
          await cacheAngels(entries);
          src = 'server';
        } catch {
          entries = null;
        }
      }
      if (!entries) {
        entries = await loadCachedAngels().catch(() => null);
        if (entries) src = 'cache';
      }

      let list: AngelListItem[];
      if (entries && entries.length > 0) {
        list = entries
          .filter((a) => a.visible)
          .map((a) => ({
            memberId: a.memberId,
            name: a.name,
            distanceKm: a.distanceKm ?? (here ? haversineM(here, a.location) / 1000 : null),
            services: a.services,
            conditions: a.conditions,
            capacity: a.capacity,
            messagingPublicKey: a.messagingPublicKey,
            available: a.available ?? null,
            sample: false,
          }));
      } else {
        src = 'sample';
        list = SAMPLE_ANGELS.map((a) => ({
          memberId: a.memberId,
          name: a.name,
          distanceKm: here ? haversineM(here, a.location) / 1000 : null,
          services: null,
          conditions: '',
          capacity: null,
          messagingPublicKey: null,
          available: null,
          sample: true,
        }));
      }
      list.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
      setItems(list);
      setSource(src);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openChat = (item: AngelListItem) => {
    void (async () => {
      if (item.messagingPublicKey) {
        await chatService.registerPeer({
          memberId: item.memberId,
          name: item.name,
          messagingPublicKey: item.messagingPublicKey,
        });
      }
      navigation.navigate('채팅', { peerMemberId: item.memberId, peerName: item.name });
    })();
  };

  /** M6: 투숙 신청 폼으로 (R-7: 신청은 지갑에서만). available=false여도 신청은 가능 — 강제 아님. */
  const openBooking = (item: AngelListItem) => {
    void (async () => {
      if (item.messagingPublicKey) {
        await chatService.registerPeer({
          memberId: item.memberId,
          name: item.name,
          messagingPublicKey: item.messagingPublicKey,
        });
      }
      navigation.navigate('투숙 신청', {
        peerMemberId: item.memberId,
        peerName: item.name,
        ...(item.available !== null ? { available: item.available } : {}),
      });
    })();
  };

  return (
    <View style={styles.screen}>
      <Card>
        <Title>주변 엔젤 — 거리순</Title>
        <Muted>
          {source === 'server' && `디렉토리 서버 기준 반경 ${RADIUS_KM}km`}
          {source === 'cache' && '오프라인 — 마지막으로 받은 디렉토리 캐시'}
          {source === 'sample' && '오프라인 — 내장 샘플 엔젤 (서버·캐시 없음)'}
          {' · 현 위치는 거리 계산에만 쓰이고 즉시 버려집니다'}
        </Muted>
      </Card>
      <FlatList
        data={items}
        keyExtractor={(item) => item.memberId}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
        ListEmptyComponent={<Muted>표시할 엔젤이 없습니다. 아래로 당겨 새로고침하세요.</Muted>}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowHead}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.dist}>
                {item.distanceKm !== null ? `${item.distanceKm.toFixed(1)} km` : '거리 미상'}
              </Text>
            </View>
            {item.available !== null && (
              <Text style={item.available ? styles.availOn : styles.availOff}>
                {item.available ? '🟢 지금 손님 받는 중' : '⏸ 지금은 어려움'}
              </Text>
            )}
            {item.services && <Text style={styles.icons}>{serviceIcons(item.services)}</Text>}
            {item.capacity !== null && <Muted>수용 {item.capacity}명{item.conditions ? ` · ${item.conditions}` : ''}</Muted>}
            {item.sample && <Muted>샘플 데이터 — 메시지는 실제 등록 엔젤에게만 보낼 수 있습니다</Muted>}
            <View style={styles.btnRow}>
              <View style={styles.btnCol}>
                <Button
                  title={item.available === false ? '투숙 신청 (지금은 어려움)' : '투숙 신청'}
                  color={item.available === false ? colors.muted : colors.primary}
                  onPress={() => openBooking(item)}
                  disabled={item.sample && !item.messagingPublicKey}
                />
              </View>
              <View style={styles.btnCol}>
                <Button
                  title="메시지"
                  color={colors.detour}
                  onPress={() => openChat(item)}
                  disabled={item.sample && !item.messagingPublicKey}
                />
              </View>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  list: { gap: 8, paddingBottom: 24 },
  row: { backgroundColor: colors.card, borderRadius: 10, padding: 12 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  name: { fontSize: 16, fontWeight: '700' },
  dist: { fontSize: 14, fontWeight: '700', color: colors.primary },
  icons: { fontSize: 18, marginBottom: 4 },
  availOn: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: 2 },
  availOff: { fontSize: 13, fontWeight: '700', color: colors.warn, marginBottom: 2 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btnCol: { flex: 1 },
});
