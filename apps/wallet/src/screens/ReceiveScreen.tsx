/**
 * 수령 — 청구 QR 생성 → 지불 역스캔 → **검토** → 엔젤의 결정 → 확인 QR 제시.
 *
 * ★2026-07-27: 스캔과 수령 사이에 검토 단계를 넣었다. 예전에는 스캔하는 순간
 * `acceptPayment`가 확인 서명까지 만들어 버려서 **스캔 = 수령 확정**이었다.
 * 헌법 제9조는 "수용 여부는 언제나 엔젤의 결정"이라고 못박고 있다.
 *
 * 동시에 제8조(작동이 성장보다 먼저)를 지킨다: 아무것도 걸리지 않은 평범한 지불은
 * "빠른 길"이 켜져 있으면 그대로 통과하고, 무엇이 오갔는지는 완료 화면에서 보여 준다.
 * 무언가 걸린 경우에만 멈춰 세운다 — 기본은 빠르게, 문제가 있을 때만 멈춤.
 */
import React, { useState } from 'react';
import { Alert, Button, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { encodeQr, RECOMMENDED_PRICES_DSHV, type ChargeMessage, type ConfirmMessage } from '@shvil/shared';
import { useWallet, wallet } from '../core/walletService';
import type { ReceiveFinding, ReceiveReview } from '../core/receiveReview';
import { maybeClaimFirstHosting } from '../core/angelService';
import { syncCoinFingerprints } from '../core/directory';
import { QrScanner } from '../ui/QrScanner';
import { Card, Muted, Title, colors, fmtShv } from '../ui/common';

type Step =
  | { name: 'input' }
  | { name: 'showCharge'; charge: ChargeMessage }
  | { name: 'scanPayment'; charge: ChargeMessage }
  | { name: 'review'; charge: ChargeMessage; review: ReceiveReview }
  | { name: 'showConfirm'; confirm: ConfirmMessage; review: ReceiveReview };

const PRESETS: { label: string; dshv: number; service: string }[] = [
  { label: '잠자리 10', dshv: RECOMMENDED_PRICES_DSHV.BED, service: 'BED' },
  { label: '식사 5', dshv: RECOMMENDED_PRICES_DSHV.MEAL, service: 'MEAL' },
  { label: '샤워 3', dshv: RECOMMENDED_PRICES_DSHV.SHOWER, service: 'SHOWER' },
  { label: '풀 패키지 18', dshv: RECOMMENDED_PRICES_DSHV.FULL_PACKAGE, service: 'FULL_PACKAGE' },
];

/** 코어 판정의 어휘 — 세상 누구의 기기에서든 같은 답이므로 "위조"라는 말을 여기서만 쓴다. */
const CORE_VERDICT_TEXT: Record<string, { text: string; color: string }> = {
  AUTHENTIC: { text: '위조 근거 없음', color: colors.primary },
  SUSPECT: { text: '판정 보류 — 확인할 것이 있음', color: colors.warn },
  FORGED: { text: '위조', color: colors.danger },
  INCONCLUSIVE: { text: '검사할 재료 부족', color: colors.muted },
};

/**
 * ★내 팩 판정의 어휘 — **절대 "위조"라고 쓰지 않는다.**
 * 팩의 FATAL은 "나는 이런 코인은 받지 않겠다"이지 위조 판정이 아니다(rulePack.ts).
 * 같은 열거값(FORGED)에 같은 단어를 붙이면 시스템이 사람에게 거짓을 말하게 된다(제3조).
 */
const MY_VERDICT_TEXT: Record<string, { text: string; color: string }> = {
  AUTHENTIC: { text: '내 기준에도 걸리는 것 없음', color: colors.primary },
  SUSPECT: { text: '내 기준으로 확인할 것이 있음', color: colors.warn },
  FORGED: { text: '내 기준으로는 받지 않기로 한 코인 (위조 판정이 아닙니다)', color: colors.danger },
  INCONCLUSIVE: { text: '판단 재료 부족', color: colors.muted },
};

const SEVERITY_STYLE: Record<ReceiveFinding['severity'], { label: string; color: string }> = {
  BLOCK: { label: '수령 불가', color: colors.danger },
  STOP: { label: '결정 필요', color: colors.warn },
  NOTE: { label: '참고', color: colors.muted },
};

function FindingRow({ f }: { f: ReceiveFinding }) {
  const s = SEVERITY_STYLE[f.severity];
  return (
    <View style={styles.finding}>
      <Text style={[styles.findingTag, { color: s.color }]}>
        [{s.label}] {f.origin === 'PACK' ? `내 규칙 팩${f.packId ? ` · ${f.packId}` : ''}` : '코어 검사'}
      </Text>
      <Text style={styles.findingTitle}>{f.title}</Text>
      <Muted>{f.detail}</Muted>
    </View>
  );
}

export function ReceiveScreen() {
  const w = useWallet();
  const [step, setStep] = useState<Step>({ name: 'input' });
  const [amountText, setAmountText] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    wallet.declineReviewedPayment();
    setAmountText('');
    setBusy(false);
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

  /** 수령 확정 이후의 부수 작업 — 전부 실패해도 수령 자체는 이미 끝났다. */
  const afterAccept = (confirm: ConfirmMessage, review: ReceiveReview) => {
    setStep({ name: 'showConfirm', confirm, review });
    // 기회적 동기화(H-1): 수령 직후 온라인이면 지문 즉시 제출 — 이중 사용 사후
    // 포착의 지연을 줄인다. 오프라인(광야)이면 다음 기회에.
    syncCoinFingerprints().catch(() => {});
    // 첫 접대 보너스(30 SHV, 지시서 2.4).
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
  };

  const accept = (review: ReceiveReview) => {
    setBusy(true);
    void wallet
      .acceptReviewedPayment(Date.now())
      .then((confirm) => afterAccept(confirm, review))
      .catch((e) =>
        Alert.alert('수령 실패', String(e instanceof Error ? e.message : e), [{ text: '확인', onPress: reset }]),
      )
      .finally(() => setBusy(false));
  };

  const onPaymentScanned = (charge: ChargeMessage) => (data: string) => {
    setBusy(true);
    void wallet
      .reviewIncomingPayment(data, Date.now())
      .then((review) => {
        // ★빠른 길 (제8조): 아무것도 걸리지 않았고 사용자가 빠른 길을 켜 두었다면
        //   그대로 완결한다. 무엇을 받았는지는 완료 화면이 전부 보여 준다.
        if (review.clean && wallet.getState().receiveFastPath) {
          wallet
            .acceptReviewedPayment(Date.now())
            .then((confirm) => afterAccept(confirm, review))
            .catch((e) =>
              Alert.alert('수령 실패', String(e instanceof Error ? e.message : e), [{ text: '확인', onPress: reset }]),
            );
          return;
        }
        setStep({ name: 'review', charge, review });
      })
      .catch((e) =>
        Alert.alert('스캔 오류', String(e instanceof Error ? e.message : e), [{ text: '확인', onPress: reset }]),
      )
      .finally(() => setBusy(false));
  };

  switch (step.name) {
    case 'input':
      return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <Card>
            <Title>청구 만들기 (수령)</Title>
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

          {/* ★수용 여부는 언제나 엔젤의 결정이다 (제9조) — 검사 강도를 스스로 정한다. */}
          <Card>
            <Title>수령 확인</Title>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>깨끗하면 확인 없이 받기</Text>
              <Switch value={w.receiveFastPath} onValueChange={(v) => void wallet.setReceiveFastPath(v)} />
            </View>
            <Muted>
              {w.receiveFastPath
                ? '아무것도 걸리지 않은 지불은 바로 완결됩니다. 걸린 것이 있으면 언제나 멈춰 세웁니다.'
                : '모든 지불을 받기 전에 검토 화면에서 확인합니다.'}
            </Muted>
            <Muted>규칙 팩은 더보기 → 위폐 감지 규칙 팩에서 얹고 뺄 수 있습니다.</Muted>
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
            <Muted>
              계보를 로컬에서 즉시 검사합니다 — 승인이 아니라 위조 검사이며, 받을지는 스캔 뒤에 정합니다.
            </Muted>
          </Card>
          <QrScanner onScanned={onPaymentScanned(step.charge)} hint="지불 QR을 화면에 맞춰 주세요" />
        </View>
      );

    case 'review': {
      const r = step.review;
      const core = CORE_VERDICT_TEXT[r.coreVerdict] ?? CORE_VERDICT_TEXT.INCONCLUSIVE!;
      const ext = MY_VERDICT_TEXT[r.extendedVerdict] ?? MY_VERDICT_TEXT.INCONCLUSIVE!;
      return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <Card>
            <Title>{r.blocked ? '이 지불은 받을 수 없습니다' : '받으시겠습니까?'}</Title>
            <Text style={styles.big}>{fmtShv(r.amountDshv)}</Text>
            <Muted>지불자 {r.payerMemberId} · 코인 {r.coins.length}장</Muted>
          </Card>

          <Card>
            <Title>판정</Title>
            {/* ★코어와 내 팩을 반드시 갈라서 보여 준다.
                코어는 세상 누구의 기기에서든 같은 답이고, 팩은 내 기준일 뿐이다. */}
            <Text style={[styles.verdict, { color: core.color }]}>코어 검사(누구에게나 같은 답): {core.text}</Text>
            <Muted>{r.coreSummary}</Muted>
            <View style={styles.hr} />
            <Text style={[styles.verdict, { color: ext.color }]}>
              내 기준(규칙 팩 {r.appliedPacks.length}개 반영): {ext.text}
            </Text>
            {r.appliedPacks.length === 0 ? (
              <Muted>얹은 규칙 팩이 없습니다 — 코어 판정과 같습니다.</Muted>
            ) : (
              <Muted>{r.appliedPacks.map((p) => `${p.name}(${p.ruleCount})`).join(' · ')}</Muted>
            )}
          </Card>

          <Card>
            <Title>코인</Title>
            {r.coins.map((c) => (
              <View key={c.serial} style={styles.coinRow}>
                <Text style={styles.coinSerial}>
                  {c.serial} · {fmtShv(c.amountDshv)}
                </Text>
                <Muted>
                  생성 회원 {c.producerMemberId} · {c.kind === 'WALK' ? '걸어서 생성' : '승인서 발행'}
                  {c.split ? ' · 분할' : ''} · 손바꿈 {c.handovers}회
                </Muted>
                {c.distanceM !== null && (
                  <Muted>
                    {(c.distanceM / 1000).toFixed(1)} km의 걸음
                    {c.settledAt ? ` · ${new Date(c.settledAt).toISOString().slice(0, 10)} 정산` : ''}
                  </Muted>
                )}
              </View>
            ))}
          </Card>

          {r.findings.length > 0 && (
            <Card>
              <Title>확인할 것 {r.findings.length}건</Title>
              {r.findings.map((f, i) => (
                <FindingRow key={`${f.title}-${i}`} f={f} />
              ))}
            </Card>
          )}

          {r.notes.length > 0 && (
            <Card>
              <Title>검사하지 못한 범위</Title>
              {r.notes.map((n, i) => (
                <Muted key={i}>· {n}</Muted>
              ))}
            </Card>
          )}

          {!r.blocked && (
            <>
              <Button
                title={busy ? '처리 중…' : `${fmtShv(r.amountDshv)} 받습니다`}
                color={colors.primary}
                disabled={busy}
                onPress={() => accept(r)}
              />
              <View style={styles.gap} />
            </>
          )}
          <Button
            title="안 받겠습니다"
            color={colors.danger}
            onPress={() => {
              wallet.declineReviewedPayment();
              Alert.alert(
                '수령을 거부했습니다',
                '아무것도 서명하지 않았습니다 — 상대의 코인은 상대 지갑에 그대로 남습니다. 같은 청구로 다시 받을 수 있습니다.',
              );
              setStep({ name: 'showCharge', charge: step.charge });
            }}
          />
          <Muted>
            거부는 상대의 코인을 없애지 않습니다. 확인 서명을 만들지 않았으므로 그의 지갑에서 코인은 그대로 사용
            가능합니다.
          </Muted>
        </ScrollView>
      );
    }

    case 'showConfirm': {
      const r = step.review;
      return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <Card>
            <Title>수령 완료 — 확인 QR을 리스트에게 보여주세요</Title>
            <Text style={styles.big}>{fmtShv(r.amountDshv)} 수령</Text>
            <View style={styles.qrBox}>
              <QRCode value={encodeQr(step.confirm)} size={280} ecl="L" />
            </View>
            <Muted>코인이 지갑에 저장되었습니다. 계보의 생성 회원 번호는 그대로 유지됩니다.</Muted>
          </Card>
          {/* ★빠른 길로 통과한 경우에도 무엇을 받았는지는 반드시 보여 준다 (제3조). */}
          <Card>
            <Title>받은 것</Title>
            <Muted>지불자 {r.payerMemberId}</Muted>
            {r.coins.map((c) => (
              <Muted key={c.serial}>
                · {c.serial} {fmtShv(c.amountDshv)} — 생성 회원 {c.producerMemberId} · 손바꿈 {c.handovers}회
              </Muted>
            ))}
            <Muted>코어 판정: {(CORE_VERDICT_TEXT[r.coreVerdict] ?? CORE_VERDICT_TEXT.INCONCLUSIVE!).text}</Muted>
          </Card>
          {/* ★빠른 길로 지나간 경우 이 카드가 유일하게 "안 본 것"을 말해 준다.
              예전에는 notes가 검토 화면에만 있어서, 빠른 길로 통과한 지불에서는
              검사기가 스스로 밝힌 한계가 사람 눈에 한 번도 닿지 않았다(제3조). */}
          {r.notes.length > 0 && (
            <Card>
              <Title>검사하지 못한 범위</Title>
              {r.notes.map((n, i) => (
                <Muted key={i}>· {n}</Muted>
              ))}
            </Card>
          )}
          <Button title="완료" color={colors.primary} onPress={reset} />
          <Pressable onPress={reset}>
            <Muted>확인 QR을 상대가 스캔한 뒤에 완료를 누르세요.</Muted>
          </Pressable>
        </ScrollView>
      );
    }
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
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  switchLabel: { fontWeight: '700', fontSize: 15 },
  verdict: { fontWeight: '800', marginBottom: 4 },
  hr: { height: 1, backgroundColor: '#D8DED8', marginVertical: 10 },
  coinRow: { marginBottom: 10 },
  coinSerial: { fontWeight: '700' },
  finding: { marginBottom: 12 },
  findingTag: { fontSize: 12, fontWeight: '800' },
  findingTitle: { fontWeight: '700', marginTop: 2 },
});
