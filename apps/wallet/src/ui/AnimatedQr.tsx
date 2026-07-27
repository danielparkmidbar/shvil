/**
 * 여러 장으로 나뉜 QR을 돌려 가며 보여 준다.
 *
 * 한 장이면 그냥 한 장을 그린다(돌지 않는다). 여러 장이면 일정 주기로 넘기고,
 * **몇 장 중 몇 번째인지**를 크게 적는다 — 상대가 언제까지 비추고 있어야 하는지
 * 알 수 있어야 한다.
 *
 * ★주기(ms)는 실기기에서 재야 하는 값이다. expo-camera v57 문서는 `onBarcodeScanned`의
 *  호출 빈도를 명시하지 않는다. 여기 기본값 400ms는 시뮬레이션이 아니라 **추정**이며,
 *  화면에서 사람이 직접 늦추고 빠르게 할 수 있게 두었다.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Muted } from './common';

export const QR_FRAME_INTERVAL_MS = 400;

export function AnimatedQr({ frames, slowLabel = true }: { frames: string[]; slowLabel?: boolean }) {
  const [i, setI] = useState(0);
  const [intervalMs, setIntervalMs] = useState(QR_FRAME_INTERVAL_MS);
  const { width } = useWindowDimensions();
  // 화면 너비를 최대한 쓴다 — 모듈이 클수록 읽힌다. (예전에는 280dp 고정이었다.)
  const size = Math.max(220, Math.min(340, width - 64));

  useEffect(() => {
    if (frames.length <= 1) return;
    const t = setInterval(() => setI((n) => (n + 1) % frames.length), intervalMs);
    return () => clearInterval(t);
  }, [frames.length, intervalMs]);

  useEffect(() => {
    setI(0);
  }, [frames]);

  if (frames.length === 0) return null;
  const current = frames[i % frames.length]!;

  return (
    <View style={styles.box}>
      <QRCode value={current} size={size} ecl="L" />
      {frames.length > 1 && (
        <>
          <Text style={styles.counter}>
            {frames.length}장 중 {(i % frames.length) + 1}번째
          </Text>
          <Muted>
            화면이 저절로 넘어갑니다. 상대가 다 모을 때까지 그대로 비춰 주세요 — 순서는 상관없습니다.
          </Muted>
          {slowLabel && (
            <Pressable onPress={() => setIntervalMs((ms) => (ms >= 800 ? 250 : ms + 200))}>
              <Text style={styles.speed}>넘기는 속도: {intervalMs}ms — 눌러서 바꾸기</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', paddingVertical: 16, gap: 6 },
  counter: { fontWeight: '800', fontSize: 16, marginTop: 8 },
  speed: { color: '#2F6B3A', fontWeight: '700', marginTop: 4 },
});
