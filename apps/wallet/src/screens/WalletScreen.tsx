/** 지갑 — 생성/구매 코인 구분 잔액 + 코인별 계보 (지시서 4장). */
import React from 'react';
import { Button, FlatList, Share, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { coinSerial } from '@shvil/shared';
import { useWallet } from '../core/walletService';
import { Card, Muted, Title, colors, fmtShv, provenanceText } from '../ui/common';
import type { StoredCoin } from '../core/db';

const ORIGIN_LABEL: Record<string, string> = {
  WALK_SELF: '걸음 생성',
  RECEIVED: '받은 코인',
  BONUS: '보너스',
};

function CoinRow({ item }: { item: StoredCoin }) {
  return (
    <View style={styles.coinRow}>
      <View style={styles.coinHead}>
        <Text style={styles.coinAmount}>{fmtShv(item.coin.amountDshv)}</Text>
        <Text style={styles.coinOrigin}>{ORIGIN_LABEL[item.origin]}</Text>
      </View>
      {/* 일련번호 (M16): 계보 해시에서 유도 — 계보가 바뀌면 번호도 바뀐다. */}
      <Text style={styles.coinSerial}>{coinSerial(item.coin)}</Text>
      <Muted>{provenanceText(item.coin)}</Muted>
      <Muted>생성 회원 {item.coin.memberId} · 이전 {item.coin.transferChain.length}회</Muted>
    </View>
  );
}

export function WalletScreen() {
  const w = useWallet();
  // 더보기 탭 안의 마켓 화면으로 교차 이동 (엔젤 모드 "판매하기" 진입).
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  return (
    <View style={styles.screen}>
      <Card>
        <Title>SHV 잔액 — 계보상 영구 구분</Title>
        <View style={styles.balances}>
          <View style={styles.balanceCol}>
            <Text style={styles.balanceNum}>{fmtShv(w.walkedBalanceDshv)}</Text>
            <Muted>걸어서 생성</Muted>
          </View>
          <View style={styles.balanceCol}>
            <Text style={styles.balanceNum}>{fmtShv(w.receivedBalanceDshv)}</Text>
            <Muted>받은·구매</Muted>
          </View>
          <View style={styles.balanceCol}>
            <Text style={styles.balanceNum}>{fmtShv(w.bonusBalanceDshv)}</Text>
            <Muted>보너스</Muted>
          </View>
        </View>
        <Muted>구매 코인은 걸음 코인으로 둔갑할 수 없습니다 · 마켓 정산은 USDC로 (온라인 전용)</Muted>
        {w.mode === 'ANGEL' && (
          <View style={styles.sellBtn}>
            <Button
              title="판매하기 — 코인 마켓 (무정가 리스팅)"
              color={colors.primary}
              onPress={() => navigation.navigate('더보기', { screen: '마켓' })}
            />
          </View>
        )}
      </Card>

      <FlatList
        data={w.coins}
        keyExtractor={(item) => item.coin.id}
        renderItem={({ item }) => <CoinRow item={item} />}
        ListEmptyComponent={<Muted>아직 확정된 코인이 없습니다. 등록 코스를 걷고 정산해 보세요.</Muted>}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          w.coins.length > 0 ? (
            <View style={styles.exportBtn}>
              <Button
                title="검사용 내보내기 — 위폐 감지기 (shvilist.org/verify)"
                color={colors.primary}
                onPress={() => {
                  // 위폐 감지기(M16) 입력 형식: { coins: [...] } — 평문 코인 JSON.
                  // 암호화 백업이 아니다: 사이트에 백업 키를 넣게 유도하지 않기 위해서다.
                  void Share.share({
                    message: JSON.stringify({ coins: w.coins.map((c) => c.coin) }),
                  });
                }}
              />
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  list: { gap: 8, paddingBottom: 24 },
  balances: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 8 },
  balanceCol: { alignItems: 'center', flex: 1 },
  balanceNum: { fontSize: 18, fontWeight: '800' },
  sellBtn: { marginTop: 8 },
  exportBtn: { marginTop: 12 },
  coinRow: { backgroundColor: colors.card, borderRadius: 10, padding: 12 },
  coinSerial: { fontSize: 11, color: colors.muted, fontVariant: ['tabular-nums'], marginBottom: 2 },
  coinHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  coinAmount: { fontSize: 16, fontWeight: '800' },
  coinOrigin: { fontSize: 12, color: colors.primary, fontWeight: '700' },
});
