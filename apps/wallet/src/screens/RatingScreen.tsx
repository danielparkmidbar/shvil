/**
 * 별점 남기기 (상호) — M7-B (별점_프라이버시_결정 안 B, 헌법 제5조).
 *
 * 투숙·접대·지불로 실제 관계가 있었던 상대에게 별점을 남긴다 — 별 1~5 + 한 줄 후기
 * (선택) + 공개 동의. 관계 증명(예약 승인 또는 지불 코인 참조)은 이 화면으로 들어온
 * 진입점이 이미 확인해 route로 넘겨준다 (관계 없으면 진입점이 나타나지 않는다 —
 * 제1원칙). 별점은 RATING 카드로 E2E 봉인해 발송되고, 준 별점의 사본이 이 기기에
 * 보관된다 (분쟁 대비). 서버는 내용을 볼 수 없다 (헌법 제9조).
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RATING_REVIEW_MAX } from '@shvil/shared';
import { loadBookingProfileDraft } from '../core/bookingService';
import { sendRating } from '../core/ratingService';
import { RATING_DIRECTION_LABEL } from '../core/ratingFormat';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet } from '../core/walletService';
import { Card, Muted, Title, colors } from '../ui/common';
import type { MoreStackParamList } from './navTypes';

type Props = NativeStackScreenProps<MoreStackParamList, '별점 남기기'>;

const STARS = [1, 2, 3, 4, 5];

export function RatingScreen({ route, navigation }: Props) {
  const { peerMemberId, peerName, relationProof, direction } = route.params;
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);

  const [stars, setStars] = useState(5);
  const [review, setReview] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [makePublic, setMakePublic] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadBookingProfileDraft().then((draft) => {
      if (draft) setDisplayName(draft.displayName);
    });
  }, []);

  const send = () => {
    if (busy) return;
    if (!displayName.trim()) {
      Alert.alert('입력 오류', '보내는 이 닉네임을 입력하세요 (실명이 아니어도 됩니다).');
      return;
    }
    setBusy(true);
    void sendRating({ peerMemberId, stars, review, fromDisplayName: displayName, direction, relationProof, makePublic })
      .then(() => {
        Alert.alert('별점 전송됨', `${peerName}에게 별점이 전달되었습니다.`);
        navigation.replace('채팅', { peerMemberId, peerName });
      })
      .catch((e) => Alert.alert('전송 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  const remaining = RATING_REVIEW_MAX - [...review].length;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Title>{peerName}에게 별점</Title>
        <Muted>
          실제 관계가 있었던 상대에게만 남깁니다 ({RATING_DIRECTION_LABEL[direction]}). 별점은 상대에게만
          보이는 암호화 메시지로 전달됩니다 — 서버는 내용을 볼 수 없습니다. 내가 준 별점의 사본은 이
          기기에 보관되어, 상대가 숨겨도 나중에 증명할 수 있습니다.
        </Muted>
        {!registered && <Text style={styles.warn}>보내려면 먼저 가입하세요 (더보기 → 가입/설정).</Text>}
      </Card>

      <Card>
        <Title>별점</Title>
        <View style={styles.starRow}>
          {STARS.map((n) => (
            <Pressable key={n} onPress={() => setStars(n)} hitSlop={6}>
              <Text style={[styles.star, n <= stars && styles.starOn]}>{n <= stars ? '★' : '☆'}</Text>
            </Pressable>
          ))}
          <Text style={styles.starValue}>{stars} / 5</Text>
        </View>
      </Card>

      <Card>
        <Title>한 줄 후기 (선택)</Title>
        <TextInput
          style={styles.reviewInput}
          value={review}
          onChangeText={(t) => setReview([...t].slice(0, RATING_REVIEW_MAX).join(''))}
          placeholder="예: 따뜻하게 맞아주셔서 북쪽 구간을 잘 이어 걸었습니다."
          multiline
        />
        <Muted>{remaining}자 남음</Muted>
        <Muted>보내는 이 닉네임 (실명 아님):</Muted>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="예: 리오르" />
      </Card>

      <Card>
        <View style={styles.row}>
          <Text style={styles.consentLabel}>상대가 이 별점을 프로필에 공개해도 됩니다</Text>
          <Switch value={makePublic} onValueChange={setMakePublic} />
        </View>
        <Muted>
          공개에 동의하면 상대가 자기 프로필의 평균·개수에 이 별점을 올릴 수 있습니다 — 닉네임과
          후기만 보이고, 회원 번호는 공개되지 않습니다. 동의하지 않으면 상대만 볼 수 있습니다.
        </Muted>
      </Card>

      <Button
        title={busy ? '전송 중…' : '별점 보내기'}
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
  warn: { color: colors.warn, marginTop: 6 },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  star: { fontSize: 34, color: '#CBD5C9' },
  starOn: { color: '#B26A00' },
  starValue: { marginLeft: 10, fontSize: 15, fontWeight: '700', color: colors.muted },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
    fontSize: 16,
    backgroundColor: 'white',
  },
  reviewInput: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
    fontSize: 16,
    minHeight: 80,
    backgroundColor: 'white',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
  consentLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
});
