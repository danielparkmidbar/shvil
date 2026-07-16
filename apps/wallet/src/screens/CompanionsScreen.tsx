/**
 * 동행 찾기 — M8 (서비스 재조정 §4-6, R-6).
 *
 * 두 화면을 한 곳에서: "게시판"(모집 중인 여정을 둘러보고 관심 보내기)과 "내 글"
 * (내가 올린 글의 인원 갱신·마감·삭제). 관심 보내기는 게시자에게 E2E 1:1 메시지를
 * 보내고 그 대화로 넘어간다 — 서버는 확정 팀 관계를 저장하지 않는다 (관심·조율은 E2E).
 *
 * 3~4인 팀 권장을 부드럽게 표기한다 (신뢰도 — 다니엘 쌤 경험). 제1원칙: 기본 걷기에
 * 영향이 없다 — 이 화면에 능동적으로 들어와야 시작된다.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  COMPANION_TEAM_RECOMMENDED_MAX,
  COMPANION_TEAM_RECOMMENDED_MIN,
  WORLD_TRAILS,
  type CompanionMode,
} from '@shvil/shared';
import type { CompanionListing } from '../core/api';
import {
  closeCompanion,
  deleteCompanion,
  loadCompanions,
  loadMyCompanions,
  reopenCompanion,
  sendInterest,
} from '../core/companionService';
import { loadBookingProfileDraft } from '../core/bookingService';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet } from '../core/walletService';
import { Card, Muted, Title, colors } from '../ui/common';
import type { MoreStackParamList } from './navTypes';

type Tab = 'BOARD' | 'MINE';

const MODE_LABEL: Record<CompanionMode, string> = { WALK: '🚶 도보', BIKE: '🚲 자전거' };

function regionName(regionId: string): string {
  return WORLD_TRAILS.find((r) => r.regionId === regionId)?.trailName ?? regionId;
}

export function CompanionsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);

  const [tab, setTab] = useState<Tab>('BOARD');
  const [region, setRegion] = useState<string | null>(null); // null = 전체
  const [items, setItems] = useState<CompanionListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const [nickname, setNickname] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void loadBookingProfileDraft().then((d) => {
      if (d?.displayName) setNickname(d.displayName);
    });
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list =
        tab === 'MINE'
          ? await loadMyCompanions(w.memberId)
          : await loadCompanions({ status: 'OPEN', ...(region ? { region } : {}) });
      setItems(list);
      setServerDown(false);
    } catch {
      setItems([]);
      setServerDown(true);
    } finally {
      setLoading(false);
    }
  }, [tab, region, w.memberId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const doInterest = (item: CompanionListing) => {
    if (busyId) return;
    if (item.authorMemberId === w.memberId) {
      Alert.alert('내 글입니다', '내가 올린 모집 글에는 관심을 보낼 수 없습니다.');
      return;
    }
    if (!nickname.trim()) {
      Alert.alert('닉네임을 입력하세요', '보내는 이 닉네임을 위에 입력해 주세요 (실명이 아니어도 됩니다).');
      return;
    }
    setBusyId(item.postId);
    void sendInterest(item, nickname)
      .then(() => {
        Alert.alert('관심을 보냈습니다', `${item.displayName}님에게 메시지가 전달되었습니다. 대화에서 함께 조율하세요.`);
        navigation.navigate('채팅', { peerMemberId: item.authorMemberId, peerName: item.displayName });
      })
      .catch((e) => Alert.alert('전송 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusyId(null));
  };

  const runOwn = (postId: string, action: () => Promise<void>, failTitle: string) => {
    if (busyId) return;
    setBusyId(postId);
    void action()
      .then(() => reload())
      .catch((e) => Alert.alert(failTitle, String(e instanceof Error ? e.message : e)))
      .finally(() => setBusyId(null));
  };

  const confirmDelete = (item: CompanionListing) => {
    Alert.alert('글 삭제', '이 동행 모집 글을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => runOwn(item.postId, () => deleteCompanion(item.postId), '삭제 실패') },
    ]);
  };

  const renderBoardItem = ({ item }: { item: CompanionListing }) => {
    const rec = item.partySizeTarget >= COMPANION_TEAM_RECOMMENDED_MIN && item.partySizeTarget <= COMPANION_TEAM_RECOMMENDED_MAX;
    const busy = busyId === item.postId;
    return (
      <View style={styles.row}>
        <View style={styles.rowHead}>
          <Text style={styles.name}>{item.displayName}</Text>
          <Text style={styles.mode}>{MODE_LABEL[item.mode]}</Text>
        </View>
        <Text style={styles.journey}>
          {regionName(item.regionId)}
          {item.courseId ? ` · ${item.courseId}` : ''}
        </Text>
        <Text style={styles.dates}>🗓 {item.fromDate} ~ {item.toDate}</Text>
        <Text style={rec ? styles.partyRec : styles.party}>
          👥 {item.partySizeCurrent} / {item.partySizeTarget}명{rec ? ' · 권장 팀 규모' : ''}
        </Text>
        {item.note && <Text style={styles.note}>{item.note}</Text>}
        <View style={styles.btnRow}>
          <Button
            title={busy ? '보내는 중…' : '관심 보내기'}
            color={colors.primary}
            onPress={() => doInterest(item)}
            disabled={busy || !registered}
          />
        </View>
      </View>
    );
  };

  const renderMineItem = ({ item }: { item: CompanionListing }) => {
    const busy = busyId === item.postId;
    const closed = item.status === 'CLOSED';
    return (
      <View style={styles.row}>
        <View style={styles.rowHead}>
          <Text style={styles.name}>
            {regionName(item.regionId)} {MODE_LABEL[item.mode]}
          </Text>
          <Text style={closed ? styles.statusClosed : styles.statusOpen}>{closed ? '마감' : '모집 중'}</Text>
        </View>
        <Text style={styles.dates}>🗓 {item.fromDate} ~ {item.toDate} · 👥 {item.partySizeCurrent}/{item.partySizeTarget}명</Text>
        {item.note && <Text style={styles.note}>{item.note}</Text>}
        <View style={styles.btnRow}>
          <View style={styles.btnCol}>
            <Button
              title={closed ? '재개' : '마감'}
              color={closed ? colors.primary : colors.warn}
              onPress={() => runOwn(item.postId, () => (closed ? reopenCompanion(item.postId) : closeCompanion(item.postId)), '변경 실패')}
              disabled={busy}
            />
          </View>
          <View style={styles.btnCol}>
            <Button title="삭제" color={colors.danger} onPress={() => confirmDelete(item)} disabled={busy} />
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        <Pressable style={[styles.tab, tab === 'BOARD' && styles.tabOn]} onPress={() => setTab('BOARD')}>
          <Text style={tab === 'BOARD' ? styles.tabTextOn : styles.tabText}>게시판</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === 'MINE' && styles.tabOn]} onPress={() => setTab('MINE')}>
          <Text style={tab === 'MINE' ? styles.tabTextOn : styles.tabText}>내 글</Text>
        </Pressable>
      </View>

      {tab === 'BOARD' ? (
        <Card>
          <Title>함께 걸을 사람 찾기</Title>
          <Muted>
            여정을 나누고 함께 걸을 팀을 미리 만드는 공간입니다. 3~4인 팀이 투숙·신뢰에 유리합니다.
            관심 있는 글에 "관심 보내기"를 누르면 게시자에게 암호화 메시지가 전달되고 대화로 이어집니다.
          </Muted>
          <Muted>보내는 이 닉네임 (관심 보낼 때 쓰입니다):</Muted>
          <TextInput style={styles.input} value={nickname} onChangeText={setNickname} placeholder="예: 노아" />
          <Button title="＋ 동행 글 올리기" color={colors.primary} onPress={() => navigation.navigate('동행 글쓰기')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <Pressable style={[styles.chip, region === null && styles.chipOn]} onPress={() => setRegion(null)}>
              <Text style={region === null ? styles.chipTextOn : styles.chipText}>전체 지역</Text>
            </Pressable>
            {WORLD_TRAILS.map((r) => (
              <Pressable key={r.regionId} style={[styles.chip, region === r.regionId && styles.chipOn]} onPress={() => setRegion(r.regionId)}>
                <Text style={region === r.regionId ? styles.chipTextOn : styles.chipText}>{r.trailName}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Card>
      ) : (
        <Card>
          <Title>내 동행 글 관리</Title>
          <Muted>인원 갱신·마감·삭제할 수 있습니다. 마감하면 게시판 모집 목록에서 사라집니다.</Muted>
          <Button title="＋ 동행 글 올리기" color={colors.primary} onPress={() => navigation.navigate('동행 글쓰기')} />
          {!registered && <Muted>내 글은 가입 후에 볼 수 있습니다 (더보기 → 가입/설정).</Muted>}
        </Card>
      )}

      {serverDown && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>서버에 연결할 수 없습니다. 아래로 당겨 다시 시도하세요.</Text>
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.postId}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
        contentContainerStyle={styles.list}
        renderItem={tab === 'BOARD' ? renderBoardItem : renderMineItem}
        ListEmptyComponent={
          loading ? null : (
            <Muted>
              {tab === 'BOARD'
                ? '아직 모집 중인 동행 글이 없습니다. 첫 글을 올려 함께 걸을 사람을 찾아보세요.'
                : '올린 동행 글이 없습니다. "동행 글 올리기"로 여정을 나눠 보세요.'}
            </Muted>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.card, alignItems: 'center' },
  tabOn: { backgroundColor: colors.primary },
  tabText: { fontWeight: '700', color: '#1A1F1A' },
  tabTextOn: { fontWeight: '700', color: 'white' },
  list: { gap: 10, paddingBottom: 24 },
  row: { backgroundColor: colors.card, borderRadius: 10, padding: 12, gap: 4 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '700', flex: 1 },
  mode: { fontSize: 14, fontWeight: '600', color: colors.detour },
  journey: { fontSize: 14, fontWeight: '600' },
  dates: { fontSize: 13, color: '#1A1F1A' },
  party: { fontSize: 13, color: colors.muted },
  partyRec: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  note: { fontSize: 14, color: '#1A1F1A', marginTop: 2 },
  statusOpen: { fontSize: 13, fontWeight: '700', color: colors.primary },
  statusClosed: { fontSize: 13, fontWeight: '700', color: colors.muted },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  btnCol: { flex: 1 },
  input: { borderWidth: 1, borderColor: '#CBD5C9', borderRadius: 8, padding: 10, marginVertical: 6, fontSize: 16, backgroundColor: 'white' },
  filterRow: { gap: 8, paddingTop: 10, paddingRight: 8 },
  chip: { borderWidth: 1, borderColor: '#CBD5C9', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'white' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: '#1A1F1A', fontSize: 13 },
  chipTextOn: { color: 'white', fontSize: 13, fontWeight: '700' },
  notice: { backgroundColor: '#FFF4E5', borderRadius: 8, padding: 10, marginBottom: 8 },
  noticeText: { color: colors.warn, fontSize: 13 },
});
