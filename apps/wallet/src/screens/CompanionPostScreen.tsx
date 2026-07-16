/**
 * 동행 글쓰기 — M8 (서비스 재조정 §4-6, R-6).
 *
 * 자신의 여정(구간·대략 날짜·팀 규모)을 공개 모집한다 — "함께 걸을 사람"을 미리
 * 만드는 공간(다니엘 쌤). 3~4인 팀이 신뢰도가 높다는 경험을 부드럽게 안내한다
 * (권장일 뿐 강제 아님). 정확한 위치·연락처는 넣지 않는다 — 관심 있는 사람이
 * 지갑 1:1 E2E 메시지로 접촉하고, 실제 조율은 그 대화에서 이어간다.
 *
 * 제1원칙: 기본 걷기(0층)에는 영향이 없다 — 동행은 이 화면에 능동적으로 들어와야
 * 시작된다. 게시는 게시자 서명이 필요하므로 가입한 회원만 올릴 수 있다.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  COMPANION_NOTE_MAX,
  COMPANION_PARTY_MAX,
  COMPANION_PARTY_TARGET_MIN,
  COMPANION_TEAM_RECOMMENDED_MAX,
  COMPANION_TEAM_RECOMMENDED_MIN,
  WORLD_TRAILS,
  validateCompanionInput,
  type CompanionMode,
  type CompanionPostInput,
} from '@shvil/shared';
import { loadBookingProfileDraft } from '../core/bookingService';
import { postCompanion } from '../core/companionService';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet } from '../core/walletService';
import { Card, Muted, Title, colors } from '../ui/common';
import type { MoreStackParamList } from './navTypes';

type Props = NativeStackScreenProps<MoreStackParamList, '동행 글쓰기'>;

const MODE_LABEL: Record<CompanionMode, string> = { WALK: '🚶 도보', BIKE: '🚲 자전거' };
const MODES: readonly CompanionMode[] = ['WALK', 'BIKE'];

export function CompanionPostScreen({ navigation }: Props) {
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);

  const [regionId, setRegionId] = useState('israel-national');
  const [courseId, setCourseId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [partyTarget, setPartyTarget] = useState(4);
  const [partyCurrent, setPartyCurrent] = useState(1);
  const [mode, setMode] = useState<CompanionMode>('WALK');
  const [displayName, setDisplayName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadBookingProfileDraft().then((draft) => {
      if (draft?.displayName) setDisplayName(draft.displayName);
    });
  }, []);

  const buildInput = (): CompanionPostInput => ({
    regionId,
    ...(courseId.trim() !== '' ? { courseId: courseId.trim() } : {}),
    fromDate: fromDate.trim(),
    toDate: toDate.trim(),
    partySizeCurrent: partyCurrent,
    partySizeTarget: partyTarget,
    mode,
    displayName: displayName.trim(),
    ...(note.trim() !== '' ? { note: note.trim() } : {}),
  });

  const submit = () => {
    if (busy) return;
    const input = buildInput();
    const reasons = validateCompanionInput(input);
    if (reasons.length > 0) {
      Alert.alert('입력을 확인하세요', '날짜(YYYY-MM-DD)·팀 규모·닉네임을 확인해 주세요.');
      return;
    }
    setBusy(true);
    void postCompanion(input)
      .then(() => {
        Alert.alert('동행 글 등록됨', '동행 게시판에 올라갔습니다. 관심 있는 사람이 지갑 메시지로 연락합니다.');
        navigation.goBack();
      })
      .catch((e) => {
        const msg = String(e instanceof Error ? e.message : e);
        Alert.alert('등록 실패', msg.includes('limit') ? '동시에 열어둘 수 있는 모집 글 수를 넘었습니다. 기존 글을 마감하고 다시 시도하세요.' : msg);
      })
      .finally(() => setBusy(false));
  };

  const remaining = COMPANION_NOTE_MAX - [...note].length;
  const recommended = partyTarget >= COMPANION_TEAM_RECOMMENDED_MIN && partyTarget <= COMPANION_TEAM_RECOMMENDED_MAX;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Title>동행 모집 — 여정을 나눕니다</Title>
        <Muted>
          함께 걸을 사람을 미리 만드는 공간입니다. 여정(구간·대략 날짜·팀 규모)만 공개하세요 — 정확한
          위치·연락처는 넣지 않습니다. 관심 있는 사람이 지갑 1:1 메시지(종단간 암호화)로 연락하고, 실제
          조율은 그 대화에서 이어갑니다.
        </Muted>
        {!registered && <Text style={styles.warn}>글을 올리려면 먼저 가입하세요 (더보기 → 가입/설정).</Text>}
      </Card>

      <Card>
        <Title>지역 (트레일)</Title>
        <View style={styles.chipWrap}>
          {WORLD_TRAILS.map((r) => (
            <Pressable
              key={r.regionId}
              style={[styles.chip, regionId === r.regionId && styles.chipOn]}
              onPress={() => setRegionId(r.regionId)}
            >
              <Text style={regionId === r.regionId ? styles.chipTextOn : styles.chipText}>
                {r.trailName}
                {r.status === 'COMING_SOON' ? ' (준비 중)' : ''}
              </Text>
            </Pressable>
          ))}
        </View>
        <Muted>아직 열리지 않은 트레일도 미리 팀을 만들 수 있습니다.</Muted>
        <Muted>코스 ID (선택 — 특정 코스 구간이면):</Muted>
        <TextInput style={styles.input} value={courseId} onChangeText={setCourseId} placeholder="예: shvil-israel" autoCapitalize="none" />
      </Card>

      <Card>
        <Title>이동 수단</Title>
        <View style={styles.chipWrap}>
          {MODES.map((m) => (
            <Pressable key={m} style={[styles.chip, mode === m && styles.chipOn]} onPress={() => setMode(m)}>
              <Text style={mode === m ? styles.chipTextOn : styles.chipText}>{MODE_LABEL[m]}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Title>대략 날짜</Title>
        <Muted>시작 (YYYY-MM-DD):</Muted>
        <TextInput style={styles.input} value={fromDate} onChangeText={setFromDate} placeholder="2026-08-01" autoCapitalize="none" />
        <Muted>종료 (YYYY-MM-DD):</Muted>
        <TextInput style={styles.input} value={toDate} onChangeText={setToDate} placeholder="2026-08-05" autoCapitalize="none" />
        <Muted>정확한 일정이 아니라 대략의 범위면 됩니다.</Muted>
      </Card>

      <Card>
        <Title>팀 규모</Title>
        <View style={styles.row}>
          <Text style={styles.partyLabel}>목표 인원</Text>
          <View style={styles.stepper}>
            <View style={styles.stepBtn}>
              <Button title="−" color={colors.muted} disabled={partyTarget <= COMPANION_PARTY_TARGET_MIN} onPress={() => setPartyTarget((n) => Math.max(COMPANION_PARTY_TARGET_MIN, n - 1))} />
            </View>
            <Text style={styles.partyCount}>{partyTarget}명</Text>
            <View style={styles.stepBtn}>
              <Button title="＋" color={colors.primary} disabled={partyTarget >= COMPANION_PARTY_MAX} onPress={() => setPartyTarget((n) => Math.min(COMPANION_PARTY_MAX, n + 1))} />
            </View>
          </View>
        </View>
        <View style={styles.row}>
          <Text style={styles.partyLabel}>현재 인원 (나 포함)</Text>
          <View style={styles.stepper}>
            <View style={styles.stepBtn}>
              <Button title="−" color={colors.muted} disabled={partyCurrent <= 1} onPress={() => setPartyCurrent((n) => Math.max(1, n - 1))} />
            </View>
            <Text style={styles.partyCount}>{partyCurrent}명</Text>
            <View style={styles.stepBtn}>
              <Button title="＋" color={colors.primary} disabled={partyCurrent >= partyTarget} onPress={() => setPartyCurrent((n) => Math.min(partyTarget, n + 1))} />
            </View>
          </View>
        </View>
        <Text style={recommended ? styles.recOn : styles.recOff}>
          권장 {COMPANION_TEAM_RECOMMENDED_MIN}~{COMPANION_TEAM_RECOMMENDED_MAX}인 — 3~4팀이 투숙·신뢰에 유리합니다 (다니엘 쌤 경험).
          {recommended ? ' ✓' : ''}
        </Text>
      </Card>

      <Card>
        <Title>닉네임 · 한마디</Title>
        <Muted>게시자 닉네임 (실명 아님):</Muted>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="예: 리오르" />
        <Muted>한마디 (선택):</Muted>
        <TextInput
          style={styles.noteInput}
          value={note}
          onChangeText={(t) => setNote([...t].slice(0, COMPANION_NOTE_MAX).join(''))}
          placeholder="예: 북부 구간을 천천히 걷습니다. 사진 좋아하는 분 환영!"
          multiline
        />
        <Muted>{remaining}자 남음</Muted>
      </Card>

      <Button title={busy ? '등록 중…' : '동행 글 올리기'} color={colors.primary} onPress={submit} disabled={busy || !registered} />
      <Muted>게시 후 더보기 → 동행 찾기 → "내 글"에서 인원 갱신·마감·삭제할 수 있습니다.</Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 4, paddingBottom: 32 },
  warn: { color: colors.warn, marginTop: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 },
  chip: { borderWidth: 1, borderColor: '#CBD5C9', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'white' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: '#1A1F1A', fontSize: 13 },
  chipTextOn: { color: 'white', fontSize: 13, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#CBD5C9', borderRadius: 8, padding: 10, marginVertical: 6, fontSize: 16, backgroundColor: 'white' },
  noteInput: { borderWidth: 1, borderColor: '#CBD5C9', borderRadius: 8, padding: 10, marginVertical: 6, fontSize: 16, minHeight: 72, backgroundColor: 'white' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 6 },
  partyLabel: { fontSize: 14, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { minWidth: 44 },
  partyCount: { minWidth: 44, textAlign: 'center', fontWeight: '700' },
  recOn: { color: colors.primary, fontSize: 13, marginTop: 6, fontWeight: '600' },
  recOff: { color: colors.muted, fontSize: 13, marginTop: 6 },
});
