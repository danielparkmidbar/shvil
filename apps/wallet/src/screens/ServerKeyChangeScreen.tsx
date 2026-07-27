/**
 * 서버 열쇠 변경 — 사람이 결정하는 화면 (배포 키 TOFU 핀 복구 경로).
 *
 * 지갑은 여기서 **판단하지 않는다.** 정상 갱신인지 공격인지 구별할 방법이 없기 때문이다.
 * 하는 일은 정직하게 보여 주는 것뿐이다 — 옛 지문, 새 지문, 언제 핀했는지, 몇 번 봤는지,
 * 그리고 "받지 않아도 걷기·지불은 그대로 된다"는 사실.
 *
 * ★자동 해제 없음. 이 화면의 "받겠습니다"를 누르는 것이 **핀을 바꾸는 유일한 경로**다.
 */
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { acceptPinChange, loadPinChangeNotice, rejectPinChange } from '../core/directory';
import type { PinChangeNotice } from '../core/pinRecovery';
import { Card, Muted, Title, colors } from '../ui/common';

export function ServerKeyChangeScreen() {
  const [notice, setNotice] = useState<PinChangeNotice | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    let alive = true;
    loadPinChangeNotice()
      .then((n) => {
        if (!alive) return;
        setNotice(n);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(reload);

  if (!loaded) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Muted>확인 중…</Muted>
      </ScrollView>
    );
  }

  if (!notice) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Card>
          <Title>서버 열쇠가 그대로입니다</Title>
          <Muted>
            이 지갑이 처음 연결한 서버의 열쇠로 계속 데이터를 받고 있습니다. 확인할 것이 없습니다.
          </Muted>
        </Card>
        <Muted>
          쉬빌 지갑은 서버의 서명 열쇠를 처음 연결할 때 기억해 둡니다. 그 열쇠가 바뀌면 새 데이터를 받지
          않고 여기에 알립니다 — 자동으로 믿지 않습니다.
        </Muted>
      </ScrollView>
    );
  }

  const onAccept = () => {
    Alert.alert(
      '새 열쇠를 받겠습니까?',
      `새 지문\n${notice.newFingerprint}\n\n★운영자에게 전화하거나 직접 만나서 이 지문을 확인하셨습니까? 인터넷으로 본 값은 근거가 되지 않습니다. 확인하지 않았으면 취소하세요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '받겠습니다',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            acceptPinChange()
              .then(() => {
                setNotice(null);
                Alert.alert('받았습니다', '다음 동기화부터 새 코스·발행자 목록을 다시 받습니다.');
              })
              .catch((e) => Alert.alert('실패', String(e instanceof Error ? e.message : e)))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  const onReject = () => {
    setBusy(true);
    rejectPinChange()
      .then(() => {
        setNotice(null);
        Alert.alert('받지 않았습니다', '지금까지의 열쇠를 그대로 씁니다. 걷기·지불은 그대로 됩니다.');
      })
      .catch((e) => Alert.alert('실패', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.alert}>
        <Text style={styles.alertTitle}>⚠ 서버 열쇠가 바뀌었습니다</Text>
        {notice.lines.map((line) => (
          <Text key={line} style={styles.alertText}>
            {line.replace(/\*\*/g, '')}
          </Text>
        ))}
      </View>

      <Card>
        <Title>지문 대조</Title>
        <Row label="지금 믿는 열쇠" value={notice.pinnedFingerprint} />
        <Row label="새로 온 열쇠" value={notice.newFingerprint} strong />
        <Muted>
          ★이 지문은 운영자에게 **전화하거나 직접 만나서** 확인하세요. 인터넷으로 받은 값은 근거가 되지
          않습니다 — 열쇠를 바꿔치기할 수 있는 상대라면 웹페이지도 바꿀 수 있습니다.
        </Muted>
        <Muted>
          {'\n'}운영자가 서버에서 확인하는 이름 (참고용): {notice.newKeyId || '(이름 없음)'}
        </Muted>
      </Card>

      <Card>
        <Title>언제 일어난 일인가</Title>
        <Row label="지금 열쇠를 기억한 날" value={notice.pinnedAtText ?? '알 수 없음 (옛 버전)'} />
        <Row label="새 열쇠를 처음 본 날" value={notice.firstSeenText} />
        <Row label="마지막으로 본 날" value={notice.lastSeenText} />
        <Row label="본 횟수" value={`${notice.seenCount}회`} />
        <Muted>
          ★횟수가 많다고 진짜인 것은 아닙니다. 가짜 서버도 계속 같은 열쇠를 보냅니다. 볼 때마다 지문이
          다르면 확실히 이상한 것이니 받지 마세요.
        </Muted>
      </Card>

      <Pressable style={[styles.btn, styles.reject]} disabled={busy} onPress={onReject}>
        <Text style={styles.btnText}>받지 않겠습니다 (지금 그대로)</Text>
      </Pressable>
      {notice.acceptable ? (
        <Pressable style={[styles.btn, styles.accept]} disabled={busy} onPress={onAccept}>
          <Text style={styles.btnText}>확인했습니다 — 새 열쇠를 받겠습니다</Text>
        </Pressable>
      ) : (
        // ★수락 단추 자체를 띄우지 않는다 — 규격 밖 응답(이름 위조)은 사람에게 물을 것이
        //   아니다. 알리기는 위 문구가 한다.
        <Muted>이 서버는 받을 수 없습니다 (열쇠와 이름이 맞지 않습니다).</Muted>
      )}
      <Muted>
        어느 쪽을 골라도 걷기·정산·지불·수령은 그대로 됩니다. 가진 코인도 그대로입니다. 달라지는 것은 새
        코스·새 발행자 목록·소명 목록을 다시 받는지 여부뿐입니다.
      </Muted>
    </ScrollView>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong ? styles.rowValueStrong : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12 },
  alert: {
    backgroundColor: '#FDECEA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 16,
    gap: 8,
  },
  alertTitle: { fontSize: 17, fontWeight: '700', color: colors.danger },
  alertText: { fontSize: 14, lineHeight: 21 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 6 },
  rowLabel: { color: colors.muted, fontSize: 13, flexShrink: 0 },
  rowValue: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  rowValueStrong: { color: colors.danger, letterSpacing: 1 },
  btn: { borderRadius: 12, padding: 16, alignItems: 'center' },
  reject: { backgroundColor: colors.primary },
  accept: { backgroundColor: colors.warn },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
