/**
 * QR 스캐너 — expo-camera CameraView 래퍼. 오프라인에서 동작 (카메라뿐).
 *
 * ★분할 프레임을 받는다. 예전에는 첫 스캔에서 래치가 잠겨(`handled`) 조각을 두 장째부터
 * 아예 못 받았다. 지금은 조각이면 모으고, 다 모이면 원래 문자열을 복원해 넘긴다.
 * 한 장짜리 QR의 동작은 그대로다 — 조각이 아니면 즉시 넘긴다.
 */
import React, { useRef, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { QrFrameCollector, isQrFrame } from '@shvil/shared';

export function QrScanner({ onScanned, hint }: { onScanned: (data: string) => void; hint: string }) {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);
  const collector = useRef(new QrFrameCollector());
  const [progress, setProgress] = useState<string | null>(null);

  if (!permission) return <Text>카메라 준비 중…</Text>;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>QR 스캔에는 카메라 권한이 필요합니다.</Text>
        <Button title="카메라 권한 허용" onPress={() => void requestPermission()} />
      </View>
    );
  }

  const onBarcode = (data: string) => {
    if (handled.current) return;
    // 한 장짜리 — 예전과 똑같이 즉시 넘긴다.
    if (!isQrFrame(data)) {
      handled.current = true;
      onScanned(data);
      return;
    }
    const r = collector.current.add(data);
    if (r.status === 'DONE') {
      handled.current = true;
      setProgress(null);
      onScanned(r.text);
      return;
    }
    if (r.status === 'CORRUPT') {
      setProgress(r.message);
      return;
    }
    if (r.status === 'COLLECTING' || r.status === 'RESTARTED') {
      setProgress(`${r.received} / ${r.total}장 모았습니다 — 화면을 계속 비춰 주세요`);
    }
  };

  return (
    <View style={styles.wrap}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => onBarcode(data)}
      />
      {progress !== null && <Text style={styles.progress}>{progress}</Text>}
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  camera: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  hint: { textAlign: 'center', marginTop: 8, color: '#667085' },
  progress: { textAlign: 'center', marginTop: 8, fontWeight: '800', color: '#2F6B3A' },
});
