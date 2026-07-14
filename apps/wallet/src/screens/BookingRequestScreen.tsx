/**
 * 투숙 신청 (리스트 모드) — M6 (재조정 §4-2, R-7: 신청은 지갑에서만).
 *
 * 날짜 2개 · 인원 · 한마디 + 첨부 프로필 미리보기(닉네임·가입 시기·여정 한 줄)
 * + 동의 체크 → BOOKING_REQUEST를 E2E 봉인해 발송한다. 서버는 암호문만 중계
 * 하고, 승인/거부는 엔젤의 회신 메시지로 온다 (서버 승인 없음 — 헌법 제9조).
 * 프로필은 신청자가 동의해 첨부하는 것 — 서버에 저장되지 않는다 (R-2).
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BOOKING_PARTY_SIZE_MAX, BOOKING_PARTY_SIZE_MIN } from '@shvil/shared';
import {
  getMemberSinceMonth,
  loadBookingProfileDraft,
  sendBookingRequest,
} from '../core/bookingService';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet } from '../core/walletService';
import { Card, Muted, Title, colors } from '../ui/common';
import type { MoreStackParamList } from './navTypes';

type Props = NativeStackScreenProps<MoreStackParamList, '투숙 신청'>;

function todayIso(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export function BookingRequestScreen({ route, navigation }: Props) {
  const { peerMemberId, peerName, available } = route.params;
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);

  const [fromDate, setFromDate] = useState(todayIso(1));
  const [toDate, setToDate] = useState(todayIso(2));
  const [partySizeText, setPartySizeText] = useState('1');
  const [note, setNote] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [journeyLine, setJourneyLine] = useState('');
  const [memberSince, setMemberSince] = useState<string | undefined>(undefined);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadBookingProfileDraft().then((draft) => {
      if (!draft) return;
      setDisplayName(draft.displayName);
      setJourneyLine(draft.journeyLine);
    });
    void getMemberSinceMonth().then(setMemberSince).catch(() => {});
  }, []);

  const send = () => {
    if (busy) return;
    if (!displayName.trim()) {
      Alert.alert('입력 오류', '프로필 닉네임을 입력하세요 (실명이 아니어도 됩니다).');
      return;
    }
    if (!consented) {
      Alert.alert('동의 필요', '프로필을 엔젤에게 전달하는 데 동의해야 신청을 보낼 수 있습니다.');
      return;
    }
    const partySize = parseInt(partySizeText, 10);
    setBusy(true);
    void sendBookingRequest({
      peerMemberId,
      dates: { fromDate: fromDate.trim(), toDate: toDate.trim() },
      partySize,
      note,
      profile: { displayName, journeyLine },
    })
      .then(() => {
        Alert.alert('신청 전송됨', `${peerName}에게 투숙 신청이 암호화되어 전달되었습니다.\n회신은 메시지로 도착합니다.`);
        navigation.replace('채팅', { peerMemberId, peerName });
      })
      .catch((e) => Alert.alert('신청 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Title>{peerName}에게 투숙 신청</Title>
        {available === false && (
          <Text style={styles.warn}>
            이 엔젤은 "지금은 어려움"으로 표시되어 있습니다. 신청은 보낼 수 있지만 거절될 수
            있습니다 — 수락 여부는 언제나 엔젤의 결정입니다.
          </Text>
        )}
        {!registered && <Text style={styles.warn}>신청을 보내려면 먼저 가입하세요 (더보기 → 가입/설정).</Text>}
        <Muted>
          신청은 엔젤에게만 보이는 암호화 메시지로 전달됩니다. 서버는 내용을 볼 수도, 승인할
          수도 없습니다.
        </Muted>
      </Card>

      <Card>
        <Title>날짜 · 인원</Title>
        <Muted>도착일:</Muted>
        <TextInput style={styles.input} value={fromDate} onChangeText={setFromDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        <Muted>떠나는 날:</Muted>
        <TextInput style={styles.input} value={toDate} onChangeText={setToDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        <Muted>인원 ({BOOKING_PARTY_SIZE_MIN}~{BOOKING_PARTY_SIZE_MAX}명):</Muted>
        <TextInput style={styles.input} value={partySizeText} onChangeText={setPartySizeText} keyboardType="number-pad" />
        <Muted>한마디 (선택):</Muted>
        <TextInput
          style={styles.input}
          value={note}
          onChangeText={setNote}
          placeholder="예: 북쪽에서 이틀째 걷고 있어요. 마당 텐트도 좋습니다."
          multiline
        />
      </Card>

      <Card>
        <Title>첨부 프로필 미리보기</Title>
        <Muted>닉네임 (실명·사진 없음 — R-2):</Muted>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="예: 리오르" />
        <Muted>여정 한 줄 (선택):</Muted>
        <TextInput style={styles.input} value={journeyLine} onChangeText={setJourneyLine} placeholder="예: 쉬빌 북부 구간 걷는 중" />
        <View style={styles.previewBox}>
          <Text style={styles.previewName}>{displayName.trim() || '(닉네임)'}</Text>
          {memberSince ? <Muted>가입 {memberSince}</Muted> : <Muted>가입 시기 미표시 (가입 후 자동 첨부)</Muted>}
          {journeyLine.trim() ? <Muted>{journeyLine.trim()}</Muted> : null}
        </View>
        <View style={styles.row}>
          <Text style={styles.consentLabel}>이 프로필을 엔젤에게 전달하는 데 동의합니다</Text>
          <Switch value={consented} onValueChange={setConsented} />
        </View>
        <Muted>프로필은 이 신청에만 첨부되어 엔젤에게 직접 전달됩니다 — 서버에 저장되지 않습니다.</Muted>
      </Card>

      <Button
        title={busy ? '전송 중…' : '투숙 신청 보내기'}
        color={colors.primary}
        onPress={send}
        disabled={busy || !registered}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 4, paddingBottom: 32 },
  warn: { color: colors.warn, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
    fontSize: 16,
    backgroundColor: 'white',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 8, gap: 8 },
  consentLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  previewBox: { backgroundColor: 'rgba(46,125,50,0.08)', borderRadius: 8, padding: 10, gap: 2, marginVertical: 6 },
  previewName: { fontSize: 15, fontWeight: '700' },
});
