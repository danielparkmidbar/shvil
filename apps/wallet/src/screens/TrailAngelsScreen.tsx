/**
 * 기존 트레일 엔젤 명단 (INT 커뮤니티 공개 명단 — 참고용).
 *
 * ★쉬빌 회원이 아니다: 회원 번호·E2E 메시지·코인 수령이 없다 — 엔젤 지도(회원)와
 * 절대 섞지 않는 별도 화면이다. 데이터는 @shvil/shared에 정적으로 번들되어
 * 오프라인(광야)에서도 열린다. 원본 위키와 같은 북(단)→남(에일라트) 지리 순서.
 * 데이터 성격·출처·삭제 정책: @shvil/shared legacyAngels.ts 주석.
 *
 * details는 영어 원문(사용자 콘텐츠) 그대로 보여준다 — 번역하지 않는다.
 * 전화는 탭하면 국제 형식(+972)으로 걸린다.
 */
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import {
  INT_TRAIL_ANGELS,
  INT_TRAIL_ANGELS_SOURCE,
  INT_TRAIL_ANGELS_UPDATED,
  INT_TRAIL_ANGEL_REGIONS,
  type LegacyAngelEntry,
  type LegacyAngelService,
} from '@shvil/shared';
import { Card, Muted, Title, colors } from '../ui/common';

/** 서비스 코드 → 한국어 라벨 (서버·데이터는 코드만 나른다). */
const SERVICE_LABEL: Record<LegacyAngelService, string> = {
  SLEEP: '숙박',
  SHOWER: '샤워',
  MEAL: '식사',
  LAUNDRY: '세탁',
  INTERNET: '인터넷',
  GROCERY: '식료품',
  KITCHEN: '취사',
  PICKUP: '픽업/드롭',
  WATER: '식수',
  MAIL: '우편물',
};

/** 이스라엘 국내형(0…) 표시 형식. */
function fmtPhone(d: string): string {
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return d;
}

export function TrailAngelsScreen() {
  const [region, setRegion] = useState<string>(INT_TRAIL_ANGEL_REGIONS[0]!);

  const sections = useMemo(() => {
    const inRegion = INT_TRAIL_ANGELS.filter((a) => a.region === region);
    const locations = [...new Set(inRegion.map((a) => a.location))];
    return locations.map((loc) => ({
      title: loc,
      data: inRegion.filter((a) => a.location === loc),
    }));
  }, [region]);

  const renderItem = ({ item }: { item: LegacyAngelEntry }) => (
    <View style={styles.row}>
      {/* 원문(영어 사용자 콘텐츠) 그대로 — 항상 이것이 우선이다 */}
      <Text style={styles.details}>{item.details}</Text>
      <View style={styles.meta}>
        {item.sho && <Text style={styles.sho}>안식일 준수</Text>}
        {item.services.map((svc) => (
          <Text key={svc} style={styles.tag}>
            {SERVICE_LABEL[svc]}
          </Text>
        ))}
        {item.phones.map((p) => (
          <Pressable key={p} onPress={() => void Linking.openURL(`tel:+972${p.slice(1)}`)}>
            <Text style={styles.phone}>📞 {fmtPhone(p)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <Card>
        <Title>INT 기존 트레일 엔젤 (참고 명단)</Title>
        <Muted>
          이스라엘 국립 트레일 하이커 커뮤니티가 수십 년 이어온 공개 명단입니다. 쉬빌 회원이
          아니므로 코인·메시지는 쓸 수 없고, 연락은 전화로 합니다 — 도착 48시간 전 연락, 21시 이후
          전화 금지. "안식일 준수" 가정은 금요일 일몰~토요일 일몰 전화 금지입니다.
        </Muted>
        <Muted>
          {INT_TRAIL_ANGELS.length}명 · 원본 갱신 {INT_TRAIL_ANGELS_UPDATED} · 출처:{' '}
          {INT_TRAIL_ANGELS_SOURCE.replace('https://', '')}
        </Muted>
      </Card>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.regionRow}>
        {INT_TRAIL_ANGEL_REGIONS.map((r) => (
          <Pressable
            key={r}
            style={[styles.chip, region === r && styles.chipOn]}
            onPress={() => setRegion(r)}
          >
            <Text style={region === r ? styles.chipTextOn : styles.chipText}>{r}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.order)}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => <Text style={styles.location}>{section.title}</Text>}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  regionRow: { flexGrow: 0, marginBottom: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'white',
    marginRight: 8,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: '#1A1F1A', fontSize: 13 },
  chipTextOn: { color: 'white', fontSize: 13, fontWeight: '700' },
  list: { paddingBottom: 24 },
  location: { fontSize: 15, fontWeight: '800', color: colors.primary, marginTop: 12, marginBottom: 4 },
  row: { backgroundColor: colors.card, borderRadius: 10, padding: 10, marginBottom: 6, gap: 6 },
  details: { fontSize: 13, lineHeight: 18, color: '#1A1F1A' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  sho: {
    backgroundColor: '#FFF3E0',
    color: '#8A4B00',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
  },
  tag: {
    backgroundColor: 'rgba(46,125,50,0.10)',
    color: colors.primary,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: '600',
    overflow: 'hidden',
  },
  phone: { fontSize: 13, fontWeight: '700', color: colors.detour },
});
