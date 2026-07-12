/**
 * 가입/설정 — 전화 OTP + 이메일 실존 확인 (지시서 2.1: 의무 신원 정보는 둘뿐).
 *
 * 가입은 선택이다: 가입 없이도 걷기·정산·QR 지불 등 앱 전체가 동작한다
 * (오프라인 우선 — 서버는 편의 기능일 뿐). 가입하면 정식 회원 번호("SHV-123456")가
 * 발급되어 이후 생성되는 모든 코인에 새겨지고, 엔젤 등록·메신저를 쓸 수 있다.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useWallet, wallet } from '../core/walletService';
import { directoryApi, getServerUrl, setServerUrl } from '../core/directory';
import { isProvisionalMemberId } from '../core/identity';
import { Card, Muted, Title, colors } from '../ui/common';

type Step = 'phone' | 'code' | 'done';

export function OnboardingScreen() {
  const w = useWallet();
  const registered = !isProvisionalMemberId(w.memberId);

  const [step, setStep] = useState<Step>(registered ? 'done' : 'phone');
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [serverUrl, setServerUrlText] = useState('');

  useEffect(() => {
    void getServerUrl().then(setServerUrlText);
  }, []);

  const requestOtp = () => {
    if (!phone.trim()) {
      Alert.alert('입력 오류', '전화번호를 입력하세요.');
      return;
    }
    setBusy(true);
    directoryApi
      .requestOtp(phone.trim())
      .then((res) => {
        // 개발 모드: 서버가 devCode를 응답에 포함 — 자동 채움 허용.
        if (res.devCode) setCode(res.devCode);
        setStep('code');
      })
      .catch((e) => Alert.alert('인증번호 요청 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  const register = () => {
    if (!code.trim() || !email.trim()) {
      Alert.alert('입력 오류', '인증번호와 이메일을 입력하세요.');
      return;
    }
    setBusy(true);
    directoryApi
      .register({
        phone: phone.trim(),
        code: code.trim(),
        email: email.trim(),
        displayName: displayName.trim() || phone.trim(),
        devicePublicKey: wallet.identity.signer.publicKeyHex,
        messagingPublicKey: wallet.identity.messagingKeyPair.publicKeyHex,
      })
      .then(async ({ memberId }) => {
        await wallet.updateMemberId(memberId);
        setStep('done');
        Alert.alert('가입 완료', `정식 회원 번호 ${memberId}가 발급되었습니다.\n이후 생성되는 모든 코인에 이 번호가 새겨집니다.`);
      })
      .catch((e) => Alert.alert('가입 실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  const saveServer = () => {
    void setServerUrl(serverUrl).then(() =>
      Alert.alert('저장됨', '디렉토리 서버 주소가 변경되었습니다.'),
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Title>회원 상태</Title>
        <Text style={styles.member}>{w.memberId}</Text>
        {registered ? (
          <Muted>정식 회원 번호입니다. 생성되는 모든 코인에 이 번호가 새겨집니다.</Muted>
        ) : (
          <Muted>
            임시 번호입니다 (미가입). 가입 없이도 걷기·지불은 전부 동작하지만, 가입하면 정식 회원
            번호가 발급되고 엔젤 등록·메신저를 쓸 수 있습니다.
          </Muted>
        )}
      </Card>

      {!registered && step === 'phone' && (
        <Card>
          <Title>가입 1/2 — 전화번호 인증</Title>
          <Muted>의무 정보는 전화번호와 이메일뿐입니다. 그 외 정보의 제공·공개는 언제나 본인이 결정합니다.</Muted>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+972-50-000-0000"
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <Button title={busy ? '요청 중…' : '인증번호 요청'} color={colors.primary} onPress={requestOtp} disabled={busy} />
        </Card>
      )}

      {!registered && step === 'code' && (
        <Card>
          <Title>가입 2/2 — 인증번호·이메일</Title>
          <Muted>인증번호 (개발 모드에서는 자동 입력됩니다):</Muted>
          <TextInput style={styles.input} value={code} onChangeText={setCode} placeholder="000000" keyboardType="number-pad" />
          <Muted>이메일 (실존 확인용):</Muted>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="me@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Muted>표시 이름 (선택 — 공개 범위는 본인이 결정):</Muted>
          <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="예: 다니엘" />
          <Button title={busy ? '가입 중…' : '가입 완료'} color={colors.primary} onPress={register} disabled={busy} />
          <View style={styles.gap} />
          <Button title="전화번호 다시 입력" color={colors.muted} onPress={() => setStep('phone')} />
        </Card>
      )}

      <Card>
        <Title>디렉토리 서버</Title>
        <Muted>
          서버는 디렉토리·메신저 릴레이·코스 배포만 담당합니다. 거래 승인 기능은 없으며, 서버가
          꺼져 있어도 걷기·지불은 완전히 동작합니다.
        </Muted>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrlText}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://localhost:8787"
        />
        <Button title="서버 주소 저장" color={colors.muted} onPress={saveServer} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 4 },
  member: { fontSize: 22, fontWeight: '800', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
    fontSize: 16,
  },
  gap: { height: 8 },
});
