/**
 * 감사 카드 보내기 (리스트 모드) — M7-A (재조정 §4-5, 헌법 제5조).
 *
 * 투숙·접대 후 엔젤에게 마음을 전한다 — 코인이 오가지 않아도. 템플릿(쪽지 느낌) +
 * 자필 메시지 + 여정 한 줄 + "게스트북에 공개해도 됨" 동의 체크 → THANKS_CARD를
 * E2E 봉인해 발송한다. 서버는 암호문만 중계한다 (헌법 제9조). 공개 동의(makePublic)는
 * 엔젤이 방명록에 올릴지 결정할 때만 쓰인다 — 서버는 원본 카드를 못 본다.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { THANKS_MESSAGE_MAX, type ThanksCardTemplate } from '@shvil/shared';
import { loadBookingProfileDraft } from '../core/bookingService';
import { sendThanksCard } from '../core/thanksCardService';
import { THANKS_TEMPLATE_EMOJI, THANKS_TEMPLATE_LABEL } from '../core/thanksCardFormat';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet } from '../core/walletService';
import { Card, Muted, Title, colors } from '../ui/common';
import type { MoreStackParamList } from './navTypes';

type Props = NativeStackScreenProps<MoreStackParamList, '감사 카드'>;

const TEMPLATES: ThanksCardTemplate[] = ['DEFAULT', 'TENT', 'MEAL', 'ROAD'];

export function ThanksCardScreen({ route, navigation }: Props) {
  const { peerMemberId, peerName } = route.params;
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);

  const [template, setTemplate] = useState<ThanksCardTemplate>('DEFAULT');
  const [message, setMessage] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [journeyLine, setJourneyLine] = useState('');
  const [makePublic, setMakePublic] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadBookingProfileDraft().then((draft) => {
      if (!draft) return;
      setDisplayName(draft.displayName);
      setJourneyLine(draft.journeyLine);
    });
  }, []);

  const send = () => {
    if (busy) return;
    if (!message.trim()) {
      Alert.alert('입력 오류', '감사의 말을 한마디 적어 주세요.');
      return;
    }
    if (!displayName.trim()) {
      Alert.alert('입력 오류', '보내는 이 닉네임을 입력하세요 (실명이 아니어도 됩니다).');
      return;
    }
    setBusy(true);
    void sendThanksCard({ peerMemberId, template, message, fromDisplayName: displayName, journeyLine, makePublic })
      .then(() => {
        Alert.alert('감사 카드 전송됨', `${peerName}에게 감사 카드가 전달되었습니다.`);
        navigation.replace('채팅', { peerMemberId, peerName });
      })
      .catch((e) => Alert.alert('전송 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  const remaining = THANKS_MESSAGE_MAX - [...message].length;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Title>{peerName}에게 감사 카드</Title>
        <Muted>
          코인이 오가지 않아도 마음을 전합니다 (헌법 제5조). 감사 카드는 엔젤에게만 보이는
          암호화 메시지로 전달됩니다 — 서버는 내용을 볼 수 없습니다.
        </Muted>
        {!registered && <Text style={styles.warn}>보내려면 먼저 가입하세요 (더보기 → 가입/설정).</Text>}
      </Card>

      <Card>
        <Title>쪽지 고르기</Title>
        <View style={styles.templateRow}>
          {TEMPLATES.map((tpl) => (
            <Pressable
              key={tpl}
              style={[styles.templateChip, template === tpl && styles.templateChipOn]}
              onPress={() => setTemplate(tpl)}
            >
              <Text style={styles.templateEmoji}>{THANKS_TEMPLATE_EMOJI[tpl]}</Text>
              <Text style={[styles.templateLabel, template === tpl && styles.templateLabelOn]}>
                {THANKS_TEMPLATE_LABEL[tpl]}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Title>감사의 말</Title>
        <TextInput
          style={styles.messageInput}
          value={message}
          onChangeText={(t) => setMessage([...t].slice(0, THANKS_MESSAGE_MAX).join(''))}
          placeholder="예: 마당 텐트 자리와 따뜻한 차 정말 고마웠습니다. 덕분에 북쪽 구간을 잘 걸었어요."
          multiline
        />
        <Muted>{remaining}자 남음</Muted>
        <Muted>보내는 이 닉네임 (실명 아님):</Muted>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="예: 리오르" />
        <Muted>여정 한 줄 (선택):</Muted>
        <TextInput
          style={styles.input}
          value={journeyLine}
          onChangeText={setJourneyLine}
          placeholder="예: 쉬빌 북부 구간을 걸었습니다"
        />
      </Card>

      <Card>
        <View style={styles.row}>
          <Text style={styles.consentLabel}>엔젤이 이 카드를 게스트북(방명록)에 공개해도 됩니다</Text>
          <Switch value={makePublic} onValueChange={setMakePublic} />
        </View>
        <Muted>
          빈집 방명록의 디지털판입니다. 공개에 동의하면 엔젤이 프로필 방명록에 이 카드를 올릴 수
          있습니다 — 닉네임과 메시지만 보이고, 회원 번호는 공개되지 않습니다. 동의하지 않으면
          엔젤만 볼 수 있습니다.
        </Muted>
      </Card>

      <Button
        title={busy ? '전송 중…' : '감사 카드 보내기'}
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
  templateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  templateChip: {
    flexGrow: 1,
    flexBasis: '45%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 10,
    padding: 10,
    gap: 4,
    backgroundColor: 'white',
  },
  templateChipOn: { borderColor: colors.primary, backgroundColor: 'rgba(46,125,50,0.10)' },
  templateEmoji: { fontSize: 22 },
  templateLabel: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  templateLabelOn: { color: colors.primary, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
    fontSize: 16,
    backgroundColor: 'white',
  },
  messageInput: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
    fontSize: 16,
    minHeight: 96,
    backgroundColor: 'white',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
  consentLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
});
