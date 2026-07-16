/**
 * 내 별점 관리 (피평가자) — M7-B (별점_프라이버시_결정 안 B, 헌법 제5조).
 *
 * 내가 받은 별점 중 평가자가 공개에 동의한(makePublic=true) 것을 프로필에 공개
 * 하거나 철회한다. 공개하면 웹·앱 누구나 프로필의 평균·개수로 열람할 수 있다 —
 * 닉네임·후기만, 회원 번호는 공개되지 않는다.
 *
 * 공개율("N개 받음 / M개 공개")을 표시한다 — 선택적 숨김을 스스로에게도 가시화한다.
 * 받은 총 개수(N)는 이 기기가 아는 실제 수신 수이며, 게시할 때 서버에 자발 신고되어
 * 공개 프로필의 공개율 분모가 된다 (평가자 정보 없는 단일 숫자 — 관계 유출 없음).
 *
 * 별점은 E2E 메시지다 — 서버는 원본 별점(공개 동의 포함)을 못 본다. 그래서 공개
 * 동의 확인은 이 지갑이 하고(makePublic=false면 게시 버튼을 감춘다), 서버는 피평가자
 * 서명으로 인증된 자발 게시를 신뢰한다 (server/src/ratings.ts 신뢰 모델).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FlatList, StyleSheet, Text, View } from 'react-native';
import { aggregateReceived, starGlyphs, type ReceivedRating } from '../core/ratingFormat';
import {
  loadReceivedRatings,
  loadMyPublicRatings,
  publicRatioPercent,
  publishRating,
  unpublishRating,
} from '../core/ratingService';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet } from '../core/walletService';
import { RatingMessageCard } from '../ui/RatingCards';
import { Card, Muted, Title, colors } from '../ui/common';

export function MyRatingsScreen() {
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);
  const [received, setReceived] = useState<ReceivedRating[]>([]);
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());
  const [publicCount, setPublicCount] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await loadReceivedRatings();
    setReceived(list);
    if (!registered) {
      setPublishedIds(new Set());
      setPublicCount(null);
      return;
    }
    try {
      const summary = await loadMyPublicRatings(w.memberId);
      setPublishedIds(new Set(summary.ratings.map((r) => r.ratingId)));
      setPublicCount(summary.publicCount);
    } catch {
      // 오프라인 — 게시 상태를 모른 채로 표시한다 (게시 시 409는 우아하게 처리).
      setPublicCount(null);
    }
  }, [registered, w.memberId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const receivedCount = received.length;
  const agg = aggregateReceived(received);

  const publish = (item: ReceivedRating) => {
    if (busyId) return;
    // 조건 2: 관계 대조에 실패한 카드는 게시하지 않는다 (버튼도 감춰지지만 이중 방어).
    if (!item.relationVerified) return;
    setBusyId(item.card.ratingId);
    // 자발 신고 받은 총 개수 = 이 기기가 아는 수신 별점 수 (공개율 분모).
    void publishRating(item.card, receivedCount)
      .then(() => reload())
      .catch((e) => {
        const msg = String(e instanceof Error ? e.message : e);
        if (msg.includes('already published')) return reload();
        Alert.alert('게시 실패', msg);
      })
      .finally(() => setBusyId(null));
  };

  const unpublish = (item: ReceivedRating) => {
    if (busyId) return;
    setBusyId(item.card.ratingId);
    void unpublishRating(item.card.ratingId)
      .then(() => reload())
      .catch((e) => Alert.alert('철회 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusyId(null));
  };

  const renderItem = ({ item }: { item: ReceivedRating }) => {
    const published = publishedIds.has(item.card.ratingId);
    const busy = busyId === item.card.ratingId;
    // 조건 2: 관계 대조 실패 = 낯선/가짜 별점 후보 → 게시 후보에서 제외하고 경고한다.
    if (!item.relationVerified) {
      return (
        <View style={styles.row}>
          <RatingMessageCard payload={item.card} />
          <Text style={styles.warn}>
            관계를 확인할 수 없는 별점입니다 (내 예약·지불 이력과 대조되지 않음). 낯선 가짜 평가일 수
            있어 프로필에 게시할 수 없습니다.
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.row}>
        <RatingMessageCard payload={item.card} />
        {published && <Text style={styles.publishedTag}>프로필에 공개 중</Text>}
        {item.card.makePublic ? (
          published ? (
            <Button title={busy ? '처리 중…' : '공개 철회'} color={colors.danger} onPress={() => unpublish(item)} disabled={busy} />
          ) : (
            <Button title={busy ? '처리 중…' : '프로필에 공개'} color={colors.primary} onPress={() => publish(item)} disabled={busy || !registered} />
          )
        ) : (
          <Muted>평가자가 공개에 동의하지 않아 게시할 수 없습니다.</Muted>
        )}
      </View>
    );
  };

  const ratio = publicCount !== null ? publicRatioPercent(publicCount, receivedCount) : null;

  return (
    <View style={styles.screen}>
      <Card>
        <Title>내 별점 — 받은 평가 관리</Title>
        <Muted>
          평가자가 공개에 동의한 별점을 프로필에 올리면 웹·앱에서 누구나 볼 수 있습니다 — 닉네임과
          후기만, 회원 번호는 공개되지 않습니다.
        </Muted>
        {receivedCount > 0 && (
          <Text style={styles.summary}>
            <Text style={styles.stars}>{starGlyphs(agg.averageTenths / 10)}</Text> 평균 {(agg.averageTenths / 10).toFixed(1)} ·
            받은 {receivedCount}개
            {publicCount !== null ? ` · 공개 ${publicCount}개 (공개율 ${ratio}%)` : ''}
          </Text>
        )}
        <Muted>
          공개율은 선택적 숨김을 스스로에게도 보이게 합니다. 받은 총 개수는 이 기기가 아는 실제
          수신 수이며, 공개할 때 서버에 숫자로만 신고됩니다 (누가 평가했는지는 서버로 가지 않습니다).
        </Muted>
        <Text style={styles.disclaimer}>
          참고 지표 — 검증된 값이 아닙니다. 공개 별점은 프로필 주인이 게시하는 값이라 서버가 진위를
          보증하지 못합니다 (프라이버시상 평가자 서명을 서버가 검증하지 않습니다). 신뢰의 보조 신호로만
          봐 주세요.
        </Text>
        {!registered && <Muted>공개 게시에는 가입이 필요합니다 (더보기 → 가입/설정).</Muted>}
      </Card>
      <FlatList
        data={received}
        keyExtractor={(item) => item.card.ratingId}
        contentContainerStyle={styles.list}
        renderItem={renderItem}
        ListEmptyComponent={
          <Muted>아직 받은 별점이 없습니다. 관계가 있었던 상대가 별점을 보내면 여기에 표시됩니다.</Muted>
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
  summary: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  stars: { color: '#B26A00' },
  disclaimer: { fontSize: 12, color: colors.muted, marginTop: 6, fontStyle: 'italic' },
  warn: { fontSize: 13, color: colors.warn, fontWeight: '600' },
});
