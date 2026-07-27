/**
 * 지불 — QR 왕복 (지시서 2.3, 4장).
 * 청구 스캔 → 금액 확인 → 지불 QR 제시 → 확인 QR 스캔 → 완료.
 * 전 과정 로컬 서명 — 서버 개입 0회. 비행기 모드에서도 동작한다.
 *
 * ★2026-07-27: **QR 용량 때문에 지불이 막히는 일이 없어졌다.**
 * 예전에는 여기서 `qrText.length <= 2900`을 보고 넘으면 "더 큰 단위 코인으로 다시
 * 시도하세요"라는 실행 불가능한 안내를 띄웠다(취소 버튼조차 없어 사람이 갇혔다).
 * 게다가 2,900은 실제 규격 상한(2,953)보다 낮아, 규격 안에 드는 코인까지 죽였다.
 * 지금은 한 장을 넘으면 여러 장으로 나눠 돌려 가며 보여 준다(qrFrames.ts).
 */
import React, { useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { QR_BYTE_MODE_MAX_CHARS, decodeQr, encodeQr, qrFramesFor, verifyCharge, type ChargeMessage, type PaymentMessage } from '@shvil/shared';
import { wallet, useWallet } from '../core/walletService';
import { AnimatedQr } from '../ui/AnimatedQr';
import { QrScanner } from '../ui/QrScanner';
import { Card, Muted, Title, colors, fmtShv } from '../ui/common';

type Step =
  | { name: 'scanCharge' }
  | { name: 'confirmCharge'; charge: ChargeMessage }
  | { name: 'showPayment'; payment: PaymentMessage; charge: ChargeMessage }
  | { name: 'scanConfirm'; charge: ChargeMessage };

export function PayScreen() {
  const w = useWallet();
  // ★화면이 다시 그려져도 진행 중인 지불로 돌아온다. 거래 탭의 세그먼트를 한 번 누르면
  //   이 화면이 통째로 언마운트되는데, 그때 단계가 초기화되면 사람은 "지불이 사라졌다"고
  //   느끼고 처음부터 다시 낸다 — 엔젤 쪽은 이미 받았을 수 있는데도.
  const [step, setStep] = useState<Step>(() => {
    const pending = wallet.outgoingPayment;
    return pending ? { name: 'showPayment', payment: pending.payment, charge: pending.charge } : { name: 'scanCharge' };
  });
  /** 한 장에 들어가는데도 사람이 굳이 나눠 보고 싶을 때 (실기기에서 안 읽힐 때). */
  const [split, setSplit] = useState(false);
  const spendable =
    w.walkedBalanceDshv + w.receivedBalanceDshv + w.bonusBalanceDshv + w.pending.pendingDshvEstimate;

  const reset = () => {
    setSplit(false);
    setStep({ name: 'scanCharge' });
  };

  const abandon = () => {
    wallet.cancelOutgoingPayment();
    reset();
  };

  /** 지불 제시를 그만둔다 — 확인 서명 전이므로 코인은 지갑에 그대로 남는다. */
  const cancelPayment = () => {
    Alert.alert('지불을 그만둘까요?', '엔젤이 아직 확인하지 않았으므로 코인은 그대로 남습니다.', [
      { text: '계속 보여주기', style: 'cancel' },
      { text: '그만두기', style: 'destructive', onPress: abandon },
    ]);
  };

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
      // 한 장에 들어가면 한 장. 넘으면 자동으로 나눈다. 한 장인데도 잘 안 읽히면
      // (모듈이 촘촘한 경우) 사람이 직접 나눌 수 있게 둔다 — 실기기에서만 알 수 있는 일이다.
      const oneFits = qrText.length <= QR_BYTE_MODE_MAX_CHARS;
      const frames = qrFramesFor(qrText, { forceSplit: split });
      return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <Card>
            <Title>지불 QR — 엔젤에게 보여주세요</Title>
            <AnimatedQr frames={frames} />
            <Muted>
              코인 {step.payment.coins.length}장 · {fmtShv(step.charge.amountDshv)}
              {frames.length > 1 ? ` · QR ${frames.length}장으로 나눔` : ''}
            </Muted>
            {oneFits && !split && (
              <Button title="잘 안 읽히면 — 여러 장으로 나누기" color={colors.muted} onPress={() => setSplit(true)} />
            )}
            {oneFits && split && (
              <Button title="다시 한 장으로 보기" color={colors.muted} onPress={() => setSplit(false)} />
            )}
          </Card>
          <Button
            title="엔젤의 확인 QR 스캔"
            color={colors.primary}
            onPress={() => setStep({ name: 'scanConfirm', charge: step.charge })}
          />
          <View style={styles.gap} />
          {/* ★취소가 없어서 사람이 이 화면에 갇혔었다. 아직 확인 서명을 못 받았으므로
              여기서 그만두어도 코인은 지갑에 그대로 있다. */}
          <Button title="그만두기" color={colors.muted} onPress={cancelPayment} />
          <Muted>
            그만두어도 코인은 사라지지 않습니다 — 엔젤의 확인 서명을 아직 받지 않았기 때문입니다.
          </Muted>
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
