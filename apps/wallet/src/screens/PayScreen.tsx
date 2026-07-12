/**
 * 지불 — QR 왕복 (지시서 2.3, 4장).
 * 청구 스캔 → 금액 확인 → 지불 QR 제시 → 확인 QR 스캔 → 완료.
 * 전 과정 로컬 서명 — 서버 개입 0회. 비행기 모드에서도 동작한다.
 */
import React, { useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { decodeQr, encodeQr, verifyCharge, type ChargeMessage, type PaymentMessage } from '@shvil/shared';
import { wallet, useWallet } from '../core/walletService';
import { QrScanner } from '../ui/QrScanner';
import { Card, Muted, Title, colors, fmtShv } from '../ui/common';

type Step =
  | { name: 'scanCharge' }
  | { name: 'confirmCharge'; charge: ChargeMessage }
  | { name: 'showPayment'; payment: PaymentMessage; charge: ChargeMessage }
  | { name: 'scanConfirm'; charge: ChargeMessage };

export function PayScreen() {
  const w = useWallet();
  const [step, setStep] = useState<Step>({ name: 'scanCharge' });
  const spendable =
    w.walkedBalanceDshv + w.receivedBalanceDshv + w.bonusBalanceDshv + w.pending.pendingDshvEstimate;

  const reset = () => setStep({ name: 'scanCharge' });

  const onChargeScanned = (data: string) => {
    try {
      const msg = decodeQr(data);
      if (msg.type !== 'shvil/charge') throw new Error('청구 QR이 아닙니다');
      if (!verifyCharge(msg)) throw new Error('청구 서명이 유효하지 않습니다');
      setStep({ name: 'confirmCharge', charge: msg });
    } catch (e) {
      Alert.alert('스캔 오류', String(e instanceof Error ? e.message : e), [{ text: '확인', onPress: reset }]);
    }
  };

  const pay = (charge: ChargeMessage) => {
    // TODO(M1 후속): 지문/페이스 인증 (expo-local-authentication) 후 서명.
    void wallet
      .payCharge(charge, Date.now())
      .then((payment) => setStep({ name: 'showPayment', payment, charge }))
      .catch((e) => Alert.alert('지불 실패', String(e instanceof Error ? e.message : e), [{ text: '확인', onPress: reset }]));
  };

  const onConfirmScanned = (charge: ChargeMessage) => (data: string) => {
    void wallet
      .applyConfirm(data, Date.now())
      .then(() => {
        Alert.alert('지불 완료', `${fmtShv(charge.amountDshv)}가 엔젤에게 전달되었습니다.`);
        reset();
      })
      .catch((e) => Alert.alert('확인 실패', String(e instanceof Error ? e.message : e)));
  };

  switch (step.name) {
    case 'scanCharge':
      return (
        <View style={styles.screen}>
          <Card>
            <Title>엔젤의 청구 QR을 스캔하세요</Title>
            <Muted>사용 가능: {fmtShv(spendable)} (잠정 누적 포함 — 지불 순간 정산됩니다)</Muted>
            <Muted>오프라인에서도 동작합니다 — 서버 개입 없음</Muted>
          </Card>
          <QrScanner onScanned={onChargeScanned} hint="청구 QR을 화면에 맞춰 주세요" />
        </View>
      );

    case 'confirmCharge':
      return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <Card>
            <Title>지불 확인</Title>
            <Text style={styles.big}>{fmtShv(step.charge.amountDshv)}</Text>
            <Muted>받는 엔젤: {step.charge.angelMemberId}</Muted>
            {step.charge.serviceType && <Muted>서비스: {step.charge.serviceType}</Muted>}
            <Muted>지불 순간 잠정 누적이 정산되고, 이 엔젤로의 우회 잠정분이 확정됩니다.</Muted>
          </Card>
          <Button title={`${fmtShv(step.charge.amountDshv)} 지불`} color={colors.primary} onPress={() => pay(step.charge)} />
          <View style={styles.gap} />
          <Button title="취소" color={colors.muted} onPress={reset} />
        </ScrollView>
      );

    case 'showPayment': {
      const qrText = encodeQr(step.payment);
      return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <Card>
            <Title>지불 QR — 엔젤에게 보여주세요</Title>
            <View style={styles.qrBox}>
              {qrText.length <= 2900 ? (
                <QRCode value={qrText} size={280} ecl="L" />
              ) : (
                <Muted>
                  지불 데이터가 QR 한 장의 용량을 넘습니다 (코인 {step.payment.coins.length}개).
                  분할 프레임 QR은 M1 후속 항목입니다 — 더 큰 단위 코인으로 다시 시도하세요.
                </Muted>
              )}
            </View>
          </Card>
          <Button
            title="엔젤의 확인 QR 스캔"
            color={colors.primary}
            onPress={() => setStep({ name: 'scanConfirm', charge: step.charge })}
          />
        </ScrollView>
      );
    }

    case 'scanConfirm':
      return (
        <View style={styles.screen}>
          <Card>
            <Title>엔젤의 확인 QR을 스캔하세요</Title>
            <Muted>확인 서명이 맞으면 거래가 완결됩니다.</Muted>
          </Card>
          <QrScanner onScanned={onConfirmScanned(step.charge)} hint="확인 QR을 화면에 맞춰 주세요" />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  content: { gap: 4 },
  big: { fontSize: 32, fontWeight: '800', marginBottom: 6 },
  qrBox: { alignItems: 'center', paddingVertical: 16 },
  gap: { height: 8 },
});
