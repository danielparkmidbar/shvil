/**
 * 메시지 — 대화 상대 목록 (지시서 4장: 엔젤과 채팅, 종단간 암호화).
 * 서버는 암호문 봉투만 중계하며, 평문은 이 기기 안에만 있다.
 */
import React, { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { chatService, useChat } from '../core/chatService';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet } from '../core/walletService';
import { Card, Muted, Title, colors } from '../ui/common';
import type { MoreStackParamList } from './navTypes';

export function MessagesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const chat = useChat();
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);

  useEffect(() => {
    void chatService.refresh();
    chatService.startPolling();
  }, []);

  const nameOf = (memberId: string): string =>
    chat.peers.find((p) => p.memberId === memberId)?.name ?? memberId;

  return (
    <View style={styles.screen}>
      <Card>
        <Title>대화</Title>
        <Muted>종단간 암호화 — 서버는 암호문만 중계하고, 평문은 이 기기 안에만 저장됩니다.</Muted>
        {!registered && <Muted>메시지 송수신에는 가입이 필요합니다 (더보기 → 가입/설정).</Muted>}
      </Card>
      <FlatList
        data={chat.summaries}
        keyExtractor={(item) => item.peerMemberId}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Muted>대화가 없습니다. 엔젤 지도에서 "메시지 보내기"로 대화를 시작하세요.</Muted>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() =>
              navigation.navigate('채팅', { peerMemberId: item.peerMemberId, peerName: nameOf(item.peerMemberId) })
            }
          >
            <View style={styles.rowHead}>
              <Text style={styles.name}>{nameOf(item.peerMemberId)}</Text>
              <Text style={styles.time}>{new Date(item.sentAt).toLocaleString()}</Text>
            </View>
            <Muted>
              {(item.direction === 'OUT' ? '나: ' : '') + (item.text.length > 60 ? `${item.text.slice(0, 60)}…` : item.text)}
            </Muted>
          </Pressable>
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
  time: { fontSize: 12, color: colors.muted },
});
