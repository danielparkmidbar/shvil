/**
 * 채팅 — 엔젤↔리스트 1:1 대화 (E2E 암호화, 지시서 4장).
 * 도착 예정 시각 공유 버튼: 현재 시각 + N시간을 정형 문구로 전송.
 * 발신자 서명이 무효한 수신 메시지에는 "[발신자 확인 불가]" 표식이 붙는다.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { chatService, useChat } from '../core/chatService';
import { buildEtaMessage, SENDER_UNVERIFIED_PREFIX } from '../core/chatFormat';
import { parseChatBooking } from '../core/bookingFormat';
import { BookingReplyCard, BookingRequestCard } from '../ui/BookingCards';
import { Muted, colors } from '../ui/common';
import type { MoreStackParamList } from './navTypes';

type Props = NativeStackScreenProps<MoreStackParamList, '채팅'>;

const ETA_HOURS = [1, 2, 4];

export function ChatScreen({ route }: Props) {
  const { peerMemberId, peerName } = route.params;
  const chat = useChat();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void chatService.openConversation(peerMemberId);
    chatService.startPolling();
    return () => chatService.closeConversation();
  }, [peerMemberId]);

  const send = (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    void chatService
      .sendMessage(peerMemberId, body)
      .then(() => setDraft(''))
      .catch((e) => Alert.alert('전송 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setSending(false));
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.peer}>{peerName}</Text>
        <Muted>종단간 암호화 · 10초마다 새 메시지를 확인합니다</Muted>
      </View>

      <FlatList
        data={chat.activeMessages}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const unverified = item.direction === 'IN' && item.text.startsWith(SENDER_UNVERIFIED_PREFIX);
          // M6: 구조화 예약 메시지는 카드로 (신청/승인/거부 구분 — APPROVED 카드에는
          // 전달받은 정확 위치·주소가 보인다). 파싱 실패 시 일반 텍스트 (하위 호환).
          const booking = parseChatBooking(item.text);
          return (
            <View
              style={[
                styles.bubble,
                item.direction === 'OUT' ? styles.out : styles.in,
                booking !== null && styles.bookingBubble,
              ]}
            >
              {unverified && <Text style={styles.unverified}>발신자 확인 불가</Text>}
              {booking !== null ? (
                booking.kind === 'BOOKING_REQUEST' ? (
                  <BookingRequestCard payload={booking} />
                ) : (
                  <BookingReplyCard payload={booking} />
                )
              ) : (
                <Text style={item.direction === 'OUT' ? styles.outText : styles.inText}>
                  {unverified ? item.text.slice(SENDER_UNVERIFIED_PREFIX.length) : item.text}
                </Text>
              )}
              <Text style={styles.time}>{new Date(item.sentAt).toLocaleTimeString()}</Text>
            </View>
          );
        }}
        ListEmptyComponent={<Muted>첫 메시지를 보내 보세요. 수락과 거절은 엔젤의 자유입니다.</Muted>}
      />

      <View style={styles.etaRow}>
        <Muted>도착 예정 시각 공유:</Muted>
        {ETA_HOURS.map((h) => (
          <View key={h} style={styles.etaBtn}>
            <Button title={`+${h}시간`} color={colors.detour} onPress={() => send(buildEtaMessage(h, Date.now()))} />
          </View>
        ))}
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="메시지 입력…"
          multiline
        />
        <Button title={sending ? '…' : '전송'} color={colors.primary} onPress={() => send(draft)} disabled={sending} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8E2' },
  peer: { fontSize: 17, fontWeight: '800' },
  list: { padding: 12, gap: 8 },
  bubble: { maxWidth: '80%', borderRadius: 12, padding: 10 },
  out: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  in: { alignSelf: 'flex-start', backgroundColor: colors.card },
  /** 예약 카드는 방향과 무관하게 밝은 바탕 — 카드 내용(색 텍스트)이 읽히도록. */
  bookingBubble: { backgroundColor: colors.card, maxWidth: '92%', borderWidth: 1, borderColor: '#DCE4DC' },
  outText: { color: 'white', fontSize: 15 },
  inText: { color: '#1A1F1A', fontSize: 15 },
  unverified: { color: colors.danger, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  time: { fontSize: 10, color: '#9AA79A', marginTop: 4, alignSelf: 'flex-end' },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 4, flexWrap: 'wrap' },
  etaBtn: { marginLeft: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    maxHeight: 100,
  },
});
