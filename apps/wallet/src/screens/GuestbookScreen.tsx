/**
 * 게스트북 관리 (엔젤 모드) — M7-A (재조정 §4-5, 헌법 제5조 감사의 화폐).
 *
 * 빈집 방명록의 디지털판이다. 내가 받은 감사 카드 중 작성자가 공개에 동의한
 * (makePublic=true) 카드를 방명록에 게시하거나 철회한다. 게시하면 웹·앱 누구나
 * 공개로 열람할 수 있다 — 닉네임과 메시지만, 회원 번호는 공개되지 않는다.
 *
 * 감사 카드는 E2E 메시지다 — 서버는 원본 카드(공개 동의 여부 포함)를 못 본다.
 * 그래서 공개 동의 확인은 이 지갑이 하고(makePublic=false면 게시 버튼을 감춘다),
 * 서버는 엔젤 서명으로 인증된 자발 게시를 신뢰한다 (server/src/guestbook.ts 신뢰 모델).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FlatList, StyleSheet, Text, View } from 'react-native';
import { loadAllChatMessages } from '../core/db';
import { buildReceivedThanksCards, type ReceivedThanksCard } from '../core/thanksCardFormat';
import { loadMyGuestbook, publishToGuestbook, unpublishFromGuestbook } from '../core/thanksCardService';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet } from '../core/walletService';
import { ThanksCardMessageCard } from '../ui/ThanksCards';
import { Card, Muted, Title, colors } from '../ui/common';

export function GuestbookScreen() {
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);
  const [received, setReceived] = useState<ReceivedThanksCard[]>([]);
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());
  const [publishedCount, setPublishedCount] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setReceived(buildReceivedThanksCards(await loadAllChatMessages()));
    if (!registered) {
      setPublishedIds(new Set());
      setPublishedCount(null);
      return;
    }
    try {
      const cards = await loadMyGuestbook(w.memberId);
      setPublishedIds(new Set(cards.map((c) => c.cardId)));
      setPublishedCount(cards.length);
    } catch {
      // 오프라인 — 게시 상태를 모른 채로 표시한다 (게시 시 409는 우아하게 처리).
      setPublishedCount(null);
    }
  }, [registered, w.memberId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const publish = (item: ReceivedThanksCard) => {
    if (busyId) return;
    setBusyId(item.card.cardId);
    void publishToGuestbook(item.card)
      .then(() => reload())
      .catch((e) => {
        const msg = String(e instanceof Error ? e.message : e);
        // 이미 게시된 카드(409)면 상태만 새로고침해 맞춘다.
        if (msg.includes('already published')) return reload();
        Alert.alert('게시 실패', msg);
      })
      .finally(() => setBusyId(null));
  };

  const unpublish = (item: ReceivedThanksCard) => {
    if (busyId) return;
    setBusyId(item.card.cardId);
    void unpublishFromGuestbook(item.card.cardId)
      .then(() => reload())
      .catch((e) => Alert.alert('철회 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusyId(null));
  };

  const renderItem = ({ item }: { item: ReceivedThanksCard }) => {
    const published = publishedIds.has(item.card.cardId);
    const busy = busyId === item.card.cardId;
    return (
      <View style={styles.row}>
        <ThanksCardMessageCard payload={item.card} />
        {published && <Text style={styles.publishedTag}>게스트북에 게시 중</Text>}
        {item.card.makePublic ? (
          published ? (
            <Button title={busy ? '처리 중…' : '게시 철회'} color={colors.danger} onPress={() => unpublish(item)} disabled={busy} />
          ) : (
            <Button title={busy ? '처리 중…' : '게스트북에 공개'} color={colors.primary} onPress={() => publish(item)} disabled={busy || !registered} />
          )
        ) : (
          <Muted>작성자가 공개에 동의하지 않아 게시할 수 없습니다.</Muted>
        )}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <Card>
        <Title>게스트북 — 받은 감사 카드</Title>
        <Muted>
          빈집 방명록의 디지털판입니다. 작성자가 공개에 동의한 카드를 방명록에 올리면 웹·앱에서
          누구나 볼 수 있습니다 — 닉네임과 메시지만, 회원 번호는 공개되지 않습니다.
        </Muted>
        {publishedCount !== null && <Muted>현재 게시 중 {publishedCount}건</Muted>}
        {!registered && <Muted>게스트북 게시에는 가입이 필요합니다 (더보기 → 가입/설정).</Muted>}
      </Card>
      <FlatList
        data={received}
        keyExtractor={(item) => item.card.cardId}
        contentContainerStyle={styles.list}
        renderItem={renderItem}
        ListEmptyComponent={
          <Muted>아직 받은 감사 카드가 없습니다. 손님이 감사 카드를 보내면 여기에 표시됩니다.</Muted>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  list: { gap: 10, paddingBottom: 24 },
  row: { backgroundColor: colors.card, borderRadius: 10, padding: 12, gap: 8 },
  publishedTag: { fontSize: 12, fontWeight: '700', color: colors.primary },
});
