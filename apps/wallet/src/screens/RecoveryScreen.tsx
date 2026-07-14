/**
 * 복구 문구 · 백업 (지시서 2.1·2.3, 보안 감사 L-2).
 *
 * - 복구 문구 확인: 12단어를 보여주고 "적어두기"를 강력 권고한다(강제 아님 —
 *   결정 대기 4번). 니모닉은 확정 코인 복구의 유일한 경로다.
 * - 복구: 다른 폰의 복구 문구를 입력해 서버 백업에서 확정 코인을 되살린다.
 *   잠정 누적은 복구되지 않는다(지시서 원칙).
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { validateMnemonic } from '@shvil/shared';
import { acknowledgeMnemonic, getMnemonic, isMnemonicAcknowledged } from '../core/identity';
import { wallet } from '../core/walletService';
import { Card, Muted, Title, colors, fmtShv } from '../ui/common';

export function RecoveryScreen() {
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [acked, setAcked] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [restoreInput, setRestoreInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getMnemonic().then(setMnemonic);
    void isMnemonicAcknowledged().then(setAcked);
  }, []);

  const doBackup = () => {
    setBusy(true);
    wallet
      .backupWallet(Date.now())
      .then((ok) =>
        Alert.alert(
          ok ? '백업 완료' : '백업할 코인 없음',
          ok
            ? '확정 코인이 종단간 암호화되어 서버에 보관되었습니다. 서버는 내용을 볼 수 없습니다.'
            : '아직 확정된 코인이 없거나 미가입 상태입니다.',
        ),
      )
      .catch((e) => Alert.alert('백업 실패 (온라인 필요)', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  const doRestore = () => {
    const words = restoreInput.trim().toLowerCase();
    if (!validateMnemonic(words)) {
      Alert.alert('복구 문구 오류', '유효한 12단어 복구 문구를 입력하세요.');
      return;
    }
    Alert.alert(
      '지갑 복구',
      '이 문구로 지갑을 복구하면 현재 기기의 키가 복구 문구 기반으로 교체됩니다. 계속할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '복구',
          onPress: () => {
            setBusy(true);
            wallet
              .restoreWallet(words, Date.now())
              .then((n) =>
                Alert.alert('복구 완료', `확정 코인 ${n}개를 복구했습니다. (잠정 누적은 복구 대상이 아닙니다.)`),
              )
              .catch((e) => Alert.alert('복구 실패', String(e instanceof Error ? e.message : e)))
              .finally(() => {
                setBusy(false);
                setRestoreInput('');
              });
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {mnemonic ? (
        <Card>
          <Title>복구 문구 (12단어)</Title>
          {!acked && (
            <Text style={styles.warn}>
              ⚠ 이 문구를 종이에 적어 안전한 곳에 보관하세요. 폰을 잃어버리면 이 문구만이 확정 코인을 되살리는
              유일한 길입니다. 누구에게도 보여주지 마세요.
            </Text>
          )}
          {revealed ? (
            <View style={styles.mnemonicBox}>
              {mnemonic.split(' ').map((word, i) => (
                <Text key={i} style={styles.word}>
                  {i + 1}. {word}
                </Text>
              ))}
            </View>
          ) : (
            <Button title="복구 문구 보기" color={colors.primary} onPress={() => setRevealed(true)} />
          )}
          {revealed && !acked && (
            <View style={styles.gap}>
              <Button
                title="적어두었습니다"
                color={colors.primary}
                onPress={() => {
                  void acknowledgeMnemonic().then(() => setAcked(true));
                }}
              />
            </View>
          )}
        </Card>
      ) : (
        <Card>
          <Title>복구 문구 없음 (레거시 지갑)</Title>
          <Muted>
            이 지갑은 복구 문구 도입 전에 만들어졌습니다. 니모닉 백업을 쓰려면 새 지갑을 설치한 뒤 이 지갑의 코인을
            지불로 옮기세요. (향후 마이그레이션 도구 예정)
          </Muted>
        </Card>
      )}

      <Card>
        <Title>지금 백업하기</Title>
        <Muted>확정 코인을 종단간 암호화해 서버에 보관합니다. 잠정 누적은 백업되지 않습니다 (사용/정산 시 확정).</Muted>
        <View style={styles.gap}>
          <Button title="확정 코인 백업" color={colors.primary} onPress={doBackup} disabled={busy} />
        </View>
      </Card>

      <Card>
        <Title>다른 폰에서 복구</Title>
        <Muted>이전 폰의 12단어 복구 문구를 입력하면 서버 백업에서 확정 코인을 되살립니다.</Muted>
        <TextInput
          style={styles.input}
          value={restoreInput}
          onChangeText={setRestoreInput}
          placeholder="복구 문구 12단어 (공백으로 구분)"
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button title="복구 문구로 지갑 복구" color={colors.warn} onPress={doRestore} disabled={busy} />
      </Card>

      <Muted>확정 잔액: {fmtShv(wallet.getState().walkedBalanceDshv + wallet.getState().receivedBalanceDshv + wallet.getState().bonusBalanceDshv)}</Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12 },
  warn: { color: colors.danger, marginBottom: 10, lineHeight: 20 },
  mnemonicBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: '#EEF3EE',
    borderRadius: 10,
    padding: 12,
    marginVertical: 8,
  },
  word: { width: '45%', fontSize: 15, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 10,
    minHeight: 72,
    fontSize: 15,
  },
  gap: { marginTop: 10 },
});
