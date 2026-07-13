/**
 * 수령 — 청구 QR 생성 → 지불 역스캔 → 확인 QR 제시.
 * M1의 지불 왕복(비행기 모드 포함) 실기기 테스트를 위한 최소 구현.
 * 엔젤 모드 전체(서비스 등록·수령 내역·마켓 리스팅)는 M2에서.
 */
import React, { useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { encodeQr, RECOMMENDED_PRICES_DSHV, type ChargeMessage, type ConfirmMessage } from '@shvil/shared';
import { wallet } from '../core/walletService';
import { maybeClaimFirstHosting } from '../core/angelService';
import { syncCoinFingerprints } from '../core/directory';
import { QrScanner } from '../ui/QrScanner';
import { Card, Muted, Title, colors, fmtShv } from '../ui/common';

type Step =
  | { name: 'input' }
  | { name: 'showCharge'; charge: ChargeMessage }
  | { name: 'scanPayment'; charge: ChargeMessage }
  | { name: 'showConfirm'; confirm: ConfirmMessage; amountDshv: number };

const PRESETS: { label: string; dshv: number; service: string }[] = [
  { label: '잠자리 10', dshv: RECOMMENDED_PRICES_DSHV.BED, service: 'BED' },
  { label: '식사 5', dshv: RECOMMENDED_PRICES_DSHV.MEAL, service: 'MEAL' },
  { label: '샤워 3', dshv: RECOMMENDED_PRICES_DSHV.SHOWER, service: 'SHOWER' },
  { label: '풀 패키지 18', dshv: RECOMMENDED_PRICES_DSHV.FULL_PACKAGE, service: 'FULL_PACKAGE' },
];

export function ReceiveScreen() {
  const [step, setStep] = useState<Step>({ name: 'input' });
  const [amountText, setAmountText] = useState('');

  const reset = () => {
    setAmountText('');
    setStep({ name: 'input' });
  };

  const createCharge = (dshv: number, service: string | null) => {
    if (!Number.isInteger(dshv) || dshv <= 0) {
      Alert.alert('금액 오류', '0.1 SHV 단위의 양수 금액을 입력하세요.');
      return;
    }
    const charge = wallet.buildIncomingCharge(dshv, service, Date.now());
    setStep({ name: 'showCharge', charge });
  };

  const onPaymentScanned = (charge: ChargeMessage) => (data: string) => {
    void wallet
      .acceptIncomingPayment(data, Date.now())
      .then((confirm) => {
        setStep({ name: 'showConfirm', confirm, amountDshv: charge.amountDshv });
        // 기회적 동기화(H-1): 수령 직후 온라인이면 지문 즉시 제출 — 이중 사용
        // 사후 포착의 지연을 줄인다. 오프라인(광야)이면 다음 기회에.
        syncCoinFingerprints().catch(() => {});
        // 첫 접대 보너스(30 SHV, 지시서 2.4): 엔젤 모드이고 미수령이면 방금 받은
        // 수령 코인을 증빙으로 자동 청구. 오프라인 실패는 조용히 넘어간다 —
        // 내 포인트 화면의 수동 재시도 버튼으로 나중에 청구할 수 있다.
        if (wallet.getState().mode === 'ANGEL') {
          maybeClaimFirstHosting()
            .then((coin) => {
              if (coin) {
                Alert.alert('첫 접대 보너스', `${fmtShv(coin.amountDshv)}가 지갑에 발행되었습니다. 첫 접대를 축하합니다!`);
              }
            })
            .catch(() => {
              /* 오프라인 — 내 포인트 화면에서 수동 재시도 */
            });
        }
      })
      .catch((e) =>
        Alert.alert('수령 거부', String(e instanceof Error ? e.message : e), [{ text: '확인', onPress: reset }]),
      );
  };

  switch (step.name) {
    case 'input':
      return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <Card>
            <Title>청구 만들기 (수령 테스트)</Title>
            <Muted>권장 가격표 (SHV):</Muted>
            <View style={styles.presets}>
              {PRESETS.map((p) => (
                <View key={p.service} style={styles.presetBtn}>
                  <Button title={p.label} onPress={() => createCharge(p.dshv, p.service)} />
                </View>
              ))}
            </View>
            <Muted>또는 직접 입력 (SHV, 0.1 단위):</Muted>
            <TextInput
              style={styles.input}
              value={amountText}
              onChangeText={setAmountText}
              placeholder="예: 12.5"
              keyboardType="decimal-pad"
            />
            <Button
              title="청구 QR 생성"
              color={colors.primary}
              onPress={() => createCharge(Math.round(parseFloat(amountText || '0') * 10), null)}
            />
          </Card>
          <Muted>서비스 등록·위치 공개·보너스는 더보기 → 내 포인트(엔젤)에서 관리하세요.</Muted>
        </ScrollView>
      );

    case 'showCharge':
      return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <Card>
            <Title>청구 QR — 리스트에게 보여주세요</Title>
            <Text style={styles.big}>{fmtShv(step.charge.amountDshv)}</Text>
            <View style={styles.qrBox}>
              <QRCode value={encodeQr(step.charge)} size={280} ecl="L" />
            </View>
          </Card>
          <Button
            title="지불 QR 스캔 (역스캔)"
            color={colors.primary}
            onPress={() => setStep({ name: 'scanPayment', charge: step.charge })}
          />
          <View style={styles.gap} />
          <Button title="취소" color={colors.muted} onPress={reset} />
        </ScrollView>
      );

    case 'scanPayment':
      return (
        <View style={styles.screen}>
          <Card>
            <Title>리스트의 지불 QR을 스캔하세요</Title>
            <Muted>계보를 로컬에서 즉시 검증합니다 — 승인이 아니라 위조 검사입니다.</Muted>
          </Card>
          <QrScanner onScanned={onPaymentScanned(step.charge)} hint="지불 QR을 화면에 맞춰 주세요" />
        </View>
      );

    case 'showConfirm':
      return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <Card>
            <Title>수령 완료 — 확인 QR을 리스트에게 보여주세요</Title>
            <Text style={styles.big}>{fmtShv(step.amountDshv)} 수령</Text>
            <View style={styles.qrBox}>
              <QRCode value={encodeQr(step.confirm)} size={280} ecl="L" />
            </View>
            <Muted>코인이 지갑에 저장되었습니다. 계보의 생성 회원 번호는 그대로 유지됩니다.</Muted>
          </Card>
          <Button title="완료" color={colors.primary} onPress={reset} />
        </ScrollView>
      );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  content: { gap: 4 },
  big: { fontSize: 28, fontWeight: '800', marginBottom: 6 },
  qrBox: { alignItems: 'center', paddingVertical: 16 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  presetBtn: { flexGrow: 1, minWidth: '45%' },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
    fontSize: 18,
  },
  gap: { height: 8 },
});
