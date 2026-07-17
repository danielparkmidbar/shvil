/**
 * 내 신뢰 지표 (C — 별점 대신 사실, 검증가능신뢰_설계.md, 헌법 제3조·제9조).
 *
 * 위조가 어려운 사실(커뮤니티 인정 완주·교차 목격 걷기 실적·활동 기간)을 뱃지로
 * 보여주고, 프로필 공개 여부를 본인이 켜고 끈다. 서버는 동의 없이 이 집계를 밖으로
 * 내보내지 않는다 — 공개해야만 동행 게시판·프로필에 뱃지가 실린다.
 *
 * 별점(M7-B)은 "참고 지표"로 격하됐다 — 신뢰의 주 지표는 여기 나오는 검증 가능한
 * 사실이다 (별점 화면 disclaimer와 짝을 이룬다). 이 지표들은 개인 실적일 뿐 "누가
 * 누구와" 관계를 남기지 않는다(헌법 제9조).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { TrustSummary } from '@shvil/shared';
import { loadMyTrust, setTrustVisible } from '../core/trustService';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet } from '../core/walletService';
import { TrustBadges } from '../ui/TrustBadges';
import { Card, Muted, Title, colors } from '../ui/common';

export function MyTrustScreen() {
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);
  const [trust, setTrust] = useState<TrustSummary | null>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  const reload = useCallback(async () => {
    if (!registered) {
      setLoaded(true);
      return;
    }
    try {
      const res = await loadMyTrust();
      setTrust(res.trust);
      setVisible(res.visible);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoaded(true);
    }
  }, [registered]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggle = (next: boolean) => {
    if (busy) return;
    setBusy(true);
    // 낙관적 갱신 — 실패 시 되돌린다.
    setVisible(next);
    void setTrustVisible(next)
      .then((v) => setVisible(v))
      .catch((e) => {
        setVisible(!next);
        Alert.alert('설정 실패', String(e instanceof Error ? e.message : e));
      })
      .finally(() => setBusy(false));
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Title>내 신뢰 지표 — 검증된 실적</Title>
        <Muted>
          별점 같은 주관 점수 대신, 위조가 어려운 사실로 신뢰를 보여줍니다 — 커뮤니티가 인정한 완주,
          다른 사람이 목격한 걷기 실적, 활동 기간. 정확한 코인 액수는 공개되지 않고 구간 뱃지로만
          표시됩니다.
        </Muted>

        {!registered ? (
          <Muted>공개에는 가입이 필요합니다 (더보기 → 가입/설정).</Muted>
        ) : offline ? (
          <Muted>서버에 연결할 수 없어 실적을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</Muted>
        ) : (
          <>
            {trust ? <TrustBadges trust={trust} /> : loaded ? <Muted>불러오는 중…</Muted> : null}
            {trust && trustIsEmpty(trust) && (
              <Muted>
                아직 뱃지로 보여줄 실적이 쌓이지 않았습니다. 코스를 걷고 완주를 인증하면 여기에 사실이
                쌓입니다.
              </Muted>
            )}

            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleTitle}>프로필에 공개</Text>
                <Muted>
                  켜면 동행 게시판·프로필에서 누구나 이 뱃지를 봅니다. 회원 번호·정확한 액수는 나가지
                  않습니다.
                </Muted>
              </View>
              <Switch value={visible} onValueChange={toggle} disabled={busy} />
            </View>
          </>
        )}
      </Card>

      <Card>
        <Title>왜 별점이 아니라 사실인가</Title>
        <Muted>
          별점은 프라이버시를 지키면서 위조를 막을 수 없습니다 — 프로필 주인이 가짜 별점을 올려도
          서버가 걸러내지 못합니다. 그래서 별점은 "참고 지표"로 두고, 신뢰의 주 지표는 여러 사람의
          투표·목격·서명된 가입 시점처럼 혼자서는 만들 수 없는 사실로 옮겼습니다 (헌법 제3조: 속도보다
          진리).
        </Muted>
      </Card>
    </ScrollView>
  );
}

/** 활동 기간을 빼면 보여줄 실적이 하나도 없는가 (안내 문구 조건). */
function trustIsEmpty(t: TrustSummary): boolean {
  return (
    t.walkTier === 'NONE' &&
    t.claimsApproved === 0 &&
    t.certificatesFull === 0 &&
    t.certificatesSection === 0 &&
    !t.leaderboardVerified &&
    (!t.angel || (!t.angel.firstHosting && t.angel.guestbookCards === 0))
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.muted,
  },
  toggleText: { flex: 1 },
  toggleTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
});
