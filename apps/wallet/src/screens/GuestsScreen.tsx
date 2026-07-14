/**
 * 손님 (엔젤 모드 탭) — 투숙 신청 수신함 (M6, 재조정 §2-3).
 *
 * 메시지함(기기 안 E2E 복호화 평문)에서 BOOKING_REQUEST를 추려 표시한다.
 * 신청자 닉네임·날짜·인원·한마디·첨부 프로필 → 승인 / 거부 / 다른 날짜 제안.
 *
 * 승인 시: 로컬 원본 엔젤 프로필(kv angelProfile.v1)의 정확 위치 + 입력한
 * 주소·연락 텍스트를 BOOKING_REPLY(APPROVED)에 첨부해 E2E 발송한다 —
 * 정확한 위치와 연락처는 이 손님에게만 암호화되어 전달된다 (R-4).
 * 서버는 아무것도 승인하지 않는다 (헌법 제9조) — 회신도 그저 메시지다.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { chatService, useChat } from '../core/chatService';
import { buildGuestInbox, fmtBookingDates, replyStatusLabel, type GuestInboxItem } from '../core/bookingFormat';
import { approveBooking, declineBooking, suggestBookingDates } from '../core/bookingService';
import { loadAllChatMessages } from '../core/db';
import { BookingReplyCard } from '../ui/BookingCards';
import { Card, Muted, Title, colors } from '../ui/common';

type PanelKind = 'APPROVE' | 'DECLINE' | 'SUGGEST';

export function GuestsScreen() {
  const chat = useChat(); // 새 메시지 폴링 반영 트리거
  const [inbox, setInbox] = useState<GuestInboxItem[]>([]);
  const [openPanel, setOpenPanel] = useState<{ requestId: string; kind: PanelKind } | null>(null);
  const [addressText, setAddressText] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setInbox(buildGuestInbox(await loadAllChatMessages()));
  }, []);

  useEffect(() => {
    void reload();
    chatService.startPolling();
  }, [reload, chat.summaries]);

  const nameOf = (item: GuestInboxItem): string =>
    item.request.profile.displayName ||
    chat.peers.find((p) => p.memberId === item.peerMemberId)?.name ||
    item.peerMemberId;

  const openAction = (item: GuestInboxItem, kind: PanelKind) => {
    setOpenPanel({ requestId: item.requestId, kind });
    setNote('');
    if (kind === 'SUGGEST') {
      setFromDate(item.request.dates.fromDate);
      setToDate(item.request.dates.toDate);
    }
  };

  const submit = (item: GuestInboxItem) => {
    if (!openPanel || busy) return;
    setBusy(true);
    const run = async () => {
      if (openPanel.kind === 'APPROVE') {
        await approveBooking({
          peerMemberId: item.peerMemberId,
          requestId: item.requestId,
          addressText,
          contact,
          note,
        });
      } else if (openPanel.kind === 'DECLINE') {
        await declineBooking(item.peerMemberId, item.requestId, note);
      } else {
        await suggestBookingDates(item.peerMemberId, item.requestId, { fromDate: fromDate.trim(), toDate: toDate.trim() }, note);
      }
    };
    void run()
      .then(() => {
        setOpenPanel(null);
        return reload();
      })
      .catch((e) => Alert.alert('회신 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  const renderItem = ({ item }: { item: GuestInboxItem }) => {
    const panel = openPanel?.requestId === item.requestId ? openPanel.kind : null;
    const req = item.request;
    return (
      <View style={styles.row}>
        <View style={styles.rowHead}>
          <Text style={styles.name}>{nameOf(item)}</Text>
          <Text style={[styles.status, item.reply === null && styles.statusPending]}>
            {replyStatusLabel(item.reply)}
          </Text>
        </View>
        <Text style={styles.line}>🗓 {fmtBookingDates(req.dates)} · {req.partySize}명</Text>
        {req.note ? <Text style={styles.line}>💬 {req.note}</Text> : null}
        <View style={styles.profileBox}>
          {req.profile.memberSince ? <Muted>가입 {req.profile.memberSince}</Muted> : null}
          {req.profile.journeyLine ? <Muted>{req.profile.journeyLine}</Muted> : null}
          <Muted>회원 번호 {item.peerMemberId} · 신청자가 동의해 첨부한 프로필</Muted>
        </View>

        {item.reply !== null && <BookingReplyCard payload={item.reply} />}

        {item.reply === null && panel === null && (
          <View style={styles.btnRow}>
            <View style={styles.btn}>
              <Button title="승인" color={colors.primary} onPress={() => openAction(item, 'APPROVE')} />
            </View>
            <View style={styles.btn}>
              <Button title="거부" color={colors.danger} onPress={() => openAction(item, 'DECLINE')} />
            </View>
            <View style={styles.btn}>
              <Button title="다른 날짜" color={colors.detour} onPress={() => openAction(item, 'SUGGEST')} />
            </View>
          </View>
        )}

        {panel === 'APPROVE' && (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>승인하고 정확한 정보 전달</Text>
            <Muted>
              내 엔젤 포인트의 정확한 위치(이 기기에만 저장된 원본)와 아래 주소·연락처가 이
              손님에게만 암호화되어 전달됩니다. 서버는 이 내용을 볼 수 없습니다.
            </Muted>
            <TextInput style={styles.input} value={addressText} onChangeText={setAddressText} placeholder="주소 안내 (예: 마을 어귀 파란 대문 집)" />
            <TextInput style={styles.input} value={contact} onChangeText={setContact} placeholder="연락처 (선택)" />
            <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="한마디 (선택)" />
            <View style={styles.btnRow}>
              <View style={styles.btn}>
                <Button title={busy ? '전송 중…' : '승인 전송'} color={colors.primary} onPress={() => submit(item)} disabled={busy} />
              </View>
              <View style={styles.btn}>
                <Button title="취소" color={colors.muted} onPress={() => setOpenPanel(null)} />
              </View>
            </View>
          </View>
        )}

        {panel === 'DECLINE' && (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>거부</Text>
            <Muted>수락과 거절은 언제나 엔젤의 자유입니다. 사유는 선택입니다.</Muted>
            <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="한마디 (선택)" />
            <View style={styles.btnRow}>
              <View style={styles.btn}>
                <Button title={busy ? '전송 중…' : '거부 전송'} color={colors.danger} onPress={() => submit(item)} disabled={busy} />
              </View>
              <View style={styles.btn}>
                <Button title="취소" color={colors.muted} onPress={() => setOpenPanel(null)} />
              </View>
            </View>
          </View>
        )}

        {panel === 'SUGGEST' && (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>다른 날짜 제안</Text>
            <TextInput style={styles.input} value={fromDate} onChangeText={setFromDate} placeholder="시작 (YYYY-MM-DD)" autoCapitalize="none" />
            <TextInput style={styles.input} value={toDate} onChangeText={setToDate} placeholder="끝 (YYYY-MM-DD)" autoCapitalize="none" />
            <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="한마디 (선택)" />
            <View style={styles.btnRow}>
              <View style={styles.btn}>
                <Button title={busy ? '전송 중…' : '제안 전송'} color={colors.detour} onPress={() => submit(item)} disabled={busy} />
              </View>
              <View style={styles.btn}>
                <Button title="취소" color={colors.muted} onPress={() => setOpenPanel(null)} />
              </View>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <Card>
        <Title>손님 — 투숙 신청 수신함</Title>
        <Muted>
          신청과 회신은 두 사람 사이의 E2E 메시지입니다 — 서버는 아무것도 승인하지 않고
          암호문만 중계합니다. 정확한 위치·주소는 승인할 때만 그 손님에게 전달됩니다.
        </Muted>
      </Card>
      <FlatList
        data={inbox}
        keyExtractor={(item) => item.requestId}
        contentContainerStyle={styles.list}
        renderItem={renderItem}
        ListEmptyComponent={
          <Muted>아직 투숙 신청이 없습니다. 지도에 공개되어 있으면 걷는 사람들이 신청을 보낼 수 있습니다.</Muted>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  list: { gap: 8, paddingBottom: 24 },
  row: { backgroundColor: colors.card, borderRadius: 10, padding: 12, gap: 4 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '700' },
  status: { fontSize: 12, fontWeight: '700', color: colors.muted },
  statusPending: { color: colors.warn },
  line: { fontSize: 14 },
  profileBox: { backgroundColor: 'rgba(46,125,50,0.08)', borderRadius: 8, padding: 8, gap: 1 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  btn: { flex: 1 },
  panel: { marginTop: 8, gap: 4 },
  panelTitle: { fontSize: 14, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    backgroundColor: 'white',
  },
});
