/** 쉬빌 지갑 — 리스트 모드 (M1). 엔젤 모드·메신저는 M2. */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { wallet } from './src/core/walletService';
import { HomeScreen } from './src/screens/HomeScreen';
import { WalkScreen } from './src/screens/WalkScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { PayScreen } from './src/screens/PayScreen';
import { ReceiveScreen } from './src/screens/ReceiveScreen';

const Tab = createBottomTabNavigator();

const TAB_ICON: Record<string, string> = {
  홈: '🏠',
  걷기: '🚶',
  지갑: '👛',
  지불: '📲',
  수령: '🤝',
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    wallet
      .init()
      .then(() => setReady(true))
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>지갑 초기화 실패: {error}</Text>
      </View>
    );
  }
  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text>쉬빌 지갑을 여는 중…</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerTitle: `쉬빌 — ${route.name}`,
          tabBarIcon: () => <Text>{TAB_ICON[route.name] ?? '·'}</Text>,
        })}
      >
        <Tab.Screen name="홈" component={HomeScreen} />
        <Tab.Screen name="걷기" component={WalkScreen} />
        <Tab.Screen name="지갑" component={WalletScreen} />
        <Tab.Screen name="지불" component={PayScreen} />
        <Tab.Screen name="수령" component={ReceiveScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  error: { color: '#C62828', textAlign: 'center' },
});
