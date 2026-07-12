/** QR 스캐너 — expo-camera CameraView 래퍼. 오프라인에서 동작 (카메라뿐). */
import React, { useRef } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

export function QrScanner({ onScanned, hint }: { onScanned: (data: string) => void; hint: string }) {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  if (!permission) return <Text>카메라 준비 중…</Text>;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>QR 스캔에는 카메라 권한이 필요합니다.</Text>
        <Button title="카메라 권한 허용" onPress={() => void requestPermission()} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          handled.current = true;
          onScanned(data);
        }}
      />
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  camera: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  hint: { textAlign: 'center', marginTop: 8, color: '#667085' },
});
