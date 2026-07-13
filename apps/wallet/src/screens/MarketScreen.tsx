/**
 * 코인 마켓 (M3) — 지시서 0-8, 5장 4절.
 *
 * 여행하지 않는 엔젤은 코인을 판다: 무정가 리스팅 → 구매자 가격 제시 →
 * 엔젤 승인 → 에스크로 (구매자 USDC 예치 → 판매자 코인 이전 서명 →
 * 구매자 확인 서명 → USDC 방출, 수수료 차감).
 *
 * 서버의 역할은 에스크로 상태 관리뿐 — SHV 이전 자체는 두 지갑의 서명으로
 * 완결된다. 마켓은 서버 기능이므로 온라인 전제다 (대면 지불과 다른 점).
 * 상태 갱신은 화면 focus 시 + 수동 새로고침뿐 — 자동 폴링 없음.
 */
import React, { useCallback, useState } from 'react';
import { Alert, Button, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ApiError,
  type EscrowState,
  type ListingOffer,
  type MarketListing,
  type MyOffer,
} from '../core/api';
import { fmtUsdcMicro, parseShvToDshv, parseUsdcToMicro } from '../core/amounts';
import { directoryApi } from '../core/directory';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet, wallet, type SaleRecord } from '../core/walletService';
import { Card, Muted, Title, colors, fmtShv } from '../ui/common';

type Segment = 'LISTINGS' | 'SELL' | 'BUY';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'LISTINGS', label: '리스팅 목록' },
  { key: 'SELL', label: '내 판매' },
  { key: 'BUY', label: '내 구매' },
];

/** 오류 문구 — 무통신이면 마켓의 온라인 전제를 안내한다. */
function marketErrText(e: unknown): string {
  if (e instanceof ApiError && e.status === 0) {
    return '마켓은 온라인에서만 동작합니다 — 서버에 연결되면 다시 시도하세요.';
  }
  return e instanceof Error ? e.message : String(e);
}

export function MarketScreen() {
  const w = useWallet();
  const [segment, setSegment] = useState<Segment>('LISTINGS');
  const registered = !isProvisionalMemberId(w.memberId);
  const balanceDshv = w.walkedBalanceDshv + w.receivedBalanceDshv + w.bonusBalanceDshv;

  return (
    <View style={styles.screen}>
      <View style={styles.segmentRow}>
        {SEGMENTS.map((s) => (
          <Pressable
            key={s.key}
            style={[styles.segmentBtn, segment === s.key && styles.segmentActive]}
            onPress={() => setSegment(s.key)}
          >
            <Text style={[styles.segmentText, segment === s.key && styles.segmentTextActive]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
      {!registered && (
        <Card>
          <Muted>마켓 거래에는 가입이 필요합니다 (더보기 → 가입/설정). 리스팅 목록은 볼 수 있습니다.</Muted>
        </Card>
      )}
      {segment === 'LISTINGS' && <ListingsTab registered={registered} myMemberId={w.memberId} />}
      {segment === 'SELL' && (
        <SellTab registered={registered} isAngel={w.mode === 'ANGEL'} balanceDshv={balanceDshv} />
      )}
      {segment === 'BUY' && <BuyTab registered={registered} />}
    </View>
  );
}

// ── 리스팅 목록: 무정가 — 구매자가 가격을 제시한다 ─────────────────

function ListingsTab({ registered, myMemberId }: { registered: boolean; myMemberId: string }) {
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offerTarget, setOfferTarget] = useState<number | null>(null);
  const [usdcText, setUsdcText] = useState('');

  const refresh = useCallback(() => {
    setBusy(true);
    directoryApi
      .getListings()
      .then((rows) => {
        setListings(rows);
        setError(null);
      })
      .catch((e) => setError(marketErrText(e)))
      .finally(() => setBusy(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const submitOffer = (listing: MarketListing) => {
    const micro = parseUsdcToMicro(usdcText);
    if (micro === null) {
      Alert.alert('입력 오류', '총액을 USDC 숫자로 입력하세요 (소수 6자리까지, 예: 9.5).');
      return;
    }
    setBusy(true);
    directoryApi
      .createOffer(listing.listingId, micro)
      .then(() => {
        setOfferTarget(null);
        setUsdcText('');
        Alert.alert(
          '가격 제시 완료',
          `${fmtShv(listing.amountDshv)}에 ${fmtUsdcMicro(micro)}를 제시했습니다.\n엔젤이 승인하면 "내 구매"에 에스크로가 나타납니다.`,
        );
      })
      .catch((e) => Alert.alert('가격 제시 실패', marketErrText(e)))
      .finally(() => setBusy(false));
  };

  return (
    <View style={styles.tab}>
      <Card>
        <Title>무정가 리스팅</Title>
        <Muted>
          엔젤은 가격을 정하지 않습니다 — 구매자인 당신이 총액(USDC)을 제시하고, 엔젤이 승인하면
          에스크로가 시작됩니다. 마켓 체결 수수료는 운영 재원이며, 대면 지불은 영구 무료입니다.
        </Muted>
        <Button title={busy ? '불러오는 중…' : '새로고침'} color={colors.primary} onPress={refresh} disabled={busy} />
      </Card>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={listings}
        keyExtractor={(item) => String(item.listingId)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={error ? null : <Muted>열린 리스팅이 없습니다.</Muted>}
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            <View style={styles.rowHead}>
              <Text style={styles.itemTitle}>{item.sellerName ?? item.sellerMemberId}</Text>
              <Text style={styles.itemAmount}>{fmtShv(item.amountDshv)}</Text>
            </View>
            <Muted>
              {new Date(item.createdAt).toLocaleDateString()} · 무정가 — 가격은 구매자가 제시합니다
            </Muted>
            {item.sellerMemberId === myMemberId ? (
              <Muted>내 리스팅 — "내 판매"에서 관리하세요.</Muted>
            ) : offerTarget === item.listingId ? (
              <View>
                <TextInput
                  style={styles.input}
                  value={usdcText}
                  onChangeText={setUsdcText}
                  placeholder="총액 USDC (예: 9.5)"
                  keyboardType="decimal-pad"
                />
                <Button
                  title="이 가격으로 제시"
                  color={colors.primary}
                  onPress={() => submitOffer(item)}
                  disabled={busy || !registered}
                />
              </View>
            ) : (
              <Button
                title="가격 제시"
                color={colors.primary}
                onPress={() => {
                  setOfferTarget(item.listingId);
                  setUsdcText('');
                }}
                disabled={!registered}
              />
            )}
          </View>
        )}
      />
    </View>
  );
}

// ── 내 판매 (엔젤 모드 전용): 리스팅 → 승인 → 에스크로 진행 ────────

interface SaleView {
  record: SaleRecord;
  offers: ListingOffer[];
  escrow: EscrowState | null;
}

function SellTab({
  registered,
  isAngel,
  balanceDshv,
}: {
  registered: boolean;
  isAngel: boolean;
  balanceDshv: number;
}) {
  const [amountText, setAmountText] = useState('');
  const [sales, setSales] = useState<SaleView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setBusy(true);
    void (async () => {
      const records = await wallet.loadSales();
      const views: SaleView[] = [];
      let firstError: string | null = null;
      for (const raw of records) {
        let record = raw;
        let offers: ListingOffer[] = [];
        let escrow: EscrowState | null = null;
        try {
          if (record.escrowId !== null) {
            escrow = await directoryApi.getEscrow(record.escrowId);
            if (escrow.status === 'COMPLETED' && !record.settled) {
              // 판매 마무리 — 에스크로 완료 확인 시 잠긴 코인을 SPENT로 정리.
              await wallet.finalizeEscrowSale(record.escrowId);
              record = { ...record, settled: true };
            }
          } else if (!record.settled) {
            offers = await directoryApi.getListingOffers(record.listingId);
          }
        } catch (e) {
          firstError = firstError ?? marketErrText(e);
        }
        views.push({ record, offers, escrow });
      }
      setSales(views);
      setError(firstError);
    })().finally(() => setBusy(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const sell = () => {
    const dshv = parseShvToDshv(amountText);
    if (dshv === null) {
      Alert.alert('입력 오류', '판매 수량을 SHV로 입력하세요 (0.1 단위, 예: 12.5).');
      return;
    }
    if (dshv > balanceDshv) {
      Alert.alert('잔액 부족', `보유 확정 잔액(${fmtShv(balanceDshv)}) 이내로 입력하세요.`);
      return;
    }
    setBusy(true);
    wallet
      .listCoinsForSale(dshv, Date.now())
      .then(() => {
        setAmountText('');
        Alert.alert('리스팅 완료', '가격은 정하지 않습니다 (무정가) — 구매자의 가격 제시를 기다리세요.');
        refresh();
      })
      .catch((e) => Alert.alert('리스팅 실패', marketErrText(e)))
      .finally(() => setBusy(false));
  };

  const approve = (record: SaleRecord, offer: ListingOffer) => {
    setBusy(true);
    directoryApi
      .approveOffer(offer.offerId)
      .then(async (res) => {
        await wallet.attachEscrowToSale(record.listingId, res.escrowId);
        Alert.alert(
          '승인 완료 — 에스크로 시작',
          `구매자 입금이 확인되면 코인 이전 서명을 제출하세요.\n수수료 ${fmtUsdcMicro(res.feeUsdcMicro)} (마켓 체결 시에만 — 대면 지불은 무료)`,
        );
        refresh();
      })
      .catch((e) => Alert.alert('승인 실패', marketErrText(e)))
      .finally(() => setBusy(false));
  };

  const simulateDeposit = (escrowId: number) => {
    setBusy(true);
    directoryApi
      .devDepositEscrow(escrowId)
      .then(() => refresh())
      .catch((e) => {
        Alert.alert('입금 시뮬레이션 실패', marketErrText(e));
        setBusy(false);
      });
  };

  const submitCoins = (escrowId: number) => {
    setBusy(true);
    wallet
      .submitEscrowCoins(escrowId, Date.now())
      .then((coins) => {
        Alert.alert(
          '코인 이전 서명 제출 완료',
          `${coins.length}개 코인을 구매자 앞 이전 서명으로 제출했습니다.\n구매자 확인 서명까지 해당 코인은 잠금(ESCROWED) 상태입니다.`,
        );
        refresh();
      })
      .catch((e) => {
        Alert.alert('제출 실패', marketErrText(e));
        setBusy(false);
      });
  };

  if (!isAngel) {
    return (
      <View style={styles.tab}>
        <Card>
          <Title>내 판매 — 엔젤 모드 전용</Title>
          <Muted>
            여행하지 않는 엔젤은 코인을 팝니다. 더보기 → 내 포인트에서 엔젤 모드로 전환하세요 —
            오늘의 엔젤이 내일의 쉬빌리스트입니다.
          </Muted>
        </Card>
      </View>
    );
  }

  return (
    <ScrollView style={styles.tab} contentContainerStyle={styles.list}>
      <Card>
        <Title>판매하기 (무정가 리스팅)</Title>
        <Muted>수량만 올립니다 — 가격은 구매자가 제시합니다. 보유 확정 잔액: {fmtShv(balanceDshv)}</Muted>
        <TextInput
          style={styles.input}
          value={amountText}
          onChangeText={setAmountText}
          placeholder="판매 수량 SHV (예: 12.5)"
          keyboardType="decimal-pad"
        />
        <Button
          title={busy ? '처리 중…' : '리스팅 등록'}
          color={colors.primary}
          onPress={sell}
          disabled={busy || !registered}
        />
        {!registered && <Muted>리스팅에는 가입 + 엔젤 등록이 필요합니다.</Muted>}
      </Card>

      <View style={styles.rowHead}>
        <Title>진행 중인 판매</Title>
        <Button title="새로고침" color={colors.muted} onPress={refresh} disabled={busy} />
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {sales.length === 0 && <Muted>판매 기록이 없습니다.</Muted>}
      {sales.map((view) => (
        <SaleCard
          key={view.record.listingId}
          view={view}
          busy={busy}
          onApprove={approve}
          onSimulateDeposit={simulateDeposit}
          onSubmitCoins={submitCoins}
        />
      ))}
    </ScrollView>
  );
}

function SaleCard({
  view,
  busy,
  onApprove,
  onSimulateDeposit,
  onSubmitCoins,
}: {
  view: SaleView;
  busy: boolean;
  onApprove: (record: SaleRecord, offer: ListingOffer) => void;
  onSimulateDeposit: (escrowId: number) => void;
  onSubmitCoins: (escrowId: number) => void;
}) {
  const { record, offers, escrow } = view;
  return (
    <View style={styles.itemCard}>
      <View style={styles.rowHead}>
        <Text style={styles.itemTitle}>리스팅 #{record.listingId}</Text>
        <Text style={styles.itemAmount}>{fmtShv(record.amountDshv)}</Text>
      </View>
      <Muted>{new Date(record.createdAt).toLocaleDateString()} 등록 · 무정가</Muted>

      {record.settled && escrow ? (
        <Text style={styles.done}>
          정산 완료 — 방출 {fmtUsdcMicro(escrow.totalUsdcMicro - escrow.feeUsdcMicro)} · 수수료{' '}
          {fmtUsdcMicro(escrow.feeUsdcMicro)}
        </Text>
      ) : escrow ? (
        <View>
          <Muted>
            에스크로 #{escrow.escrowId} · 제시액 {fmtUsdcMicro(escrow.totalUsdcMicro)} · 수수료{' '}
            {fmtUsdcMicro(escrow.feeUsdcMicro)}
          </Muted>
          {escrow.status === 'AWAITING_DEPOSIT' && (
            <View>
              <Text style={styles.stateText}>구매자 입금 대기 중 (USDC 예치)</Text>
              <Button
                title="입금 시뮬레이션 (개발)"
                color={colors.warn}
                onPress={() => onSimulateDeposit(escrow.escrowId)}
                disabled={busy}
              />
            </View>
          )}
          {escrow.status === 'DEPOSITED' && (
            <View>
              <Text style={styles.stateText}>입금 확인됨 — 코인을 이전 서명해 제출하세요</Text>
              <Button
                title="코인 이전 서명 제출"
                color={colors.primary}
                onPress={() => onSubmitCoins(escrow.escrowId)}
                disabled={busy}
              />
            </View>
          )}
          {escrow.status === 'COINS_SUBMITTED' && (
            <Text style={styles.stateText}>구매자 확인 대기 중 — 확인 서명이 오면 USDC가 방출됩니다</Text>
          )}
        </View>
      ) : (
        <View>
          {offers.filter((o) => o.status === 'PENDING').length === 0 ? (
            <Muted>아직 가격 제시가 없습니다 — 구매자를 기다리는 중.</Muted>
          ) : (
            offers
              .filter((o) => o.status === 'PENDING')
              .map((offer) => (
                <View key={offer.offerId} style={styles.offerRow}>
                  <View style={styles.offerText}>
                    <Text style={styles.itemTitle}>{fmtUsdcMicro(offer.totalUsdcMicro)}</Text>
                    <Muted>{offer.buyerMemberId}</Muted>
                  </View>
                  <Button
                    title="승인"
                    color={colors.primary}
                    onPress={() => onApprove(record, offer)}
                    disabled={busy}
                  />
                </View>
              ))
          )}
        </View>
      )}
    </View>
  );
}

// ── 내 구매: 가격 제시 현황 + 에스크로 진행 ────────────────────────

function BuyTab({ registered }: { registered: boolean }) {
  const [offers, setOffers] = useState<MyOffer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!registered) return;
    setBusy(true);
    directoryApi
      .getMyOffers()
      .then((rows) => {
        setOffers(rows);
        setError(null);
      })
      .catch((e) => setError(marketErrText(e)))
      .finally(() => setBusy(false));
  }, [registered]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const simulateDeposit = (escrowId: number) => {
    setBusy(true);
    directoryApi
      .devDepositEscrow(escrowId)
      .then(() => refresh())
      .catch((e) => {
        Alert.alert('입금 시뮬레이션 실패', marketErrText(e));
        setBusy(false);
      });
  };

  const ack = (offer: MyOffer) => {
    setBusy(true);
    wallet
      .ackEscrowPurchase(offer.escrowId!, Date.now())
      .then((res) => {
        Alert.alert(
          '수령 완료',
          `${fmtShv(res.amountDshv)} 수령 완료 — 구매 코인으로 표시됩니다.\n(계보상 걸음 코인과 영구 구분 · 판매자에게 ${fmtUsdcMicro(res.releasedUsdcMicro)} 방출)`,
        );
        refresh();
      })
      .catch((e) => {
        Alert.alert('수령 확인 실패', marketErrText(e));
        setBusy(false);
      });
  };

  return (
    <View style={styles.tab}>
      <Card>
        <Title>내 가격 제시</Title>
        <Muted>
          엔젤이 승인하면 에스크로가 시작됩니다: USDC 예치 → 판매자 코인 이전 서명 → 수령 확인 →
          USDC 방출. 코인 이전은 두 지갑의 서명으로 완결됩니다.
        </Muted>
        <Button title={busy ? '불러오는 중…' : '새로고침'} color={colors.primary} onPress={refresh} disabled={busy} />
      </Card>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={offers}
        keyExtractor={(item) => String(item.offerId)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          error ? null : <Muted>가격 제시 내역이 없습니다 — 리스팅 목록에서 제시해 보세요.</Muted>
        }
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            <View style={styles.rowHead}>
              <Text style={styles.itemTitle}>리스팅 #{item.listingId}</Text>
              <Text style={styles.itemAmount}>{fmtUsdcMicro(item.totalUsdcMicro)}</Text>
            </View>
            {item.escrowId === null ? (
              <Muted>{item.status === 'PENDING' ? '판매자(엔젤) 승인 대기 중' : `상태: ${item.status}`}</Muted>
            ) : (
              <View>
                <Muted>에스크로 #{item.escrowId}</Muted>
                {item.escrowStatus === 'AWAITING_DEPOSIT' && (
                  <View>
                    <Text style={styles.stateText}>USDC 입금 대기 — 입금 후 판매자가 코인을 이전합니다</Text>
                    <Button
                      title="입금 시뮬레이션 (개발)"
                      color={colors.warn}
                      onPress={() => simulateDeposit(item.escrowId!)}
                      disabled={busy}
                    />
                  </View>
                )}
                {item.escrowStatus === 'DEPOSITED' && (
                  <Text style={styles.stateText}>입금 완료 — 판매자의 코인 이전 서명 제출 대기 중</Text>
                )}
                {item.escrowStatus === 'COINS_SUBMITTED' && (
                  <View>
                    <Text style={styles.stateText}>코인이 도착했습니다 — 확인 서명으로 거래를 완결하세요</Text>
                    <Button
                      title="코인 수령 확인"
                      color={colors.primary}
                      onPress={() => ack(item)}
                      disabled={busy}
                    />
                  </View>
                )}
                {item.escrowStatus === 'COMPLETED' && (
                  <Text style={styles.done}>구매 완료 — 코인은 지갑에 "받은·구매"로 표시됩니다</Text>
                )}
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  tab: { flex: 1 },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
  },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontWeight: '700', color: colors.muted },
  segmentTextActive: { color: '#FFFFFF' },
  list: { gap: 8, paddingBottom: 24 },
  itemCard: { backgroundColor: colors.card, borderRadius: 10, padding: 12, gap: 6 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemTitle: { fontSize: 15, fontWeight: '700' },
  itemAmount: { fontSize: 16, fontWeight: '800', color: colors.primary },
  stateText: { fontWeight: '600', marginVertical: 4 },
  done: { color: colors.primary, fontWeight: '700', marginTop: 4 },
  error: { color: colors.danger, marginBottom: 8 },
  offerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  offerText: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
    fontSize: 16,
    backgroundColor: '#FFFFFF',
  },
});
