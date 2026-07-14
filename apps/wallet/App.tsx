/**
 * 쉬빌 지갑 — 하나의 앱, 두 모드 (M2: 엔젤 모드 + 메신저 + 디렉토리 연동).
 * 탭: 홈 · 걷기 · 지갑 · 거래(지불/수령) · 더보기(엔젤 지도·메시지·내 포인트·가입/설정).
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { wallet } from './src/core/walletService';
import { chatService } from './src/core/chatService';
import { renewMembershipIfDue, syncCoinFingerprints, syncCourses, syncFlaggedList } from './src/core/directory';
import { HomeScreen } from './src/screens/HomeScreen';
import { WalkScreen } from './src/screens/WalkScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { TransactScreen } from './src/screens/TransactScreen';
import { MoreScreen } from './src/screens/MoreScreen';
import { AngelMapScreen } from './src/screens/AngelMapScreen';
import { MessagesScreen } from './src/screens/MessagesScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { MyAngelPointScreen } from './src/screens/MyAngelPointScreen';
import { MarketScreen } from './src/screens/MarketScreen';
import { CommunityScreen } from './src/screens/CommunityScreen';
import { RecoveryScreen } from './src/screens/RecoveryScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import type { MoreStackParamList } from './src/screens/navTypes';

const Tab = createBottomTabNavigator();
const MoreStack = createNativeStackNavigator<MoreStackParamList>();

const TAB_ICON: Record<string, string> = {
  홈: '🏠',
  걷기: '🚶',
  지갑: '👛',
  거래: '🔄',
  더보기: '☰',
};

function MoreStackScreen() {
  return (
    <MoreStack.Navigator>
      <MoreStack.Screen name="더보기" component={MoreScreen} options={{ headerTitle: '쉬빌 — 더보기' }} />
      <MoreStack.Screen name="엔젤 지도" component={AngelMapScreen} />
      <MoreStack.Screen name="메시지" component={MessagesScreen} />
      <MoreStack.Screen
        name="채팅"
        component={ChatScreen}
        options={({ route }) => ({ headerTitle: route.params.peerName })}
      />
      <MoreStack.Screen name="내 포인트" component={MyAngelPointScreen} options={{ headerTitle: '내 포인트 (엔젤)' }} />
      <MoreStack.Screen name="마켓" component={MarketScreen} options={{ headerTitle: '코인 마켓' }} />
      <MoreStack.Screen name="커뮤니티" component={CommunityScreen} options={{ headerTitle: '커뮤니티' }} />
      <MoreStack.Screen name="복구 문구" component={RecoveryScreen} options={{ headerTitle: '복구 문구 · 백업' }} />
      <MoreStack.Screen name="가입/설정" component={OnboardingScreen} />
    </MoreStack.Navigator>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    wallet
      .init()
      .then(() => {
        setReady(true);
        // 서버 연동은 편의 기능 — 실패해도 앱 동작에 영향 없음 (오프라인 우선).
        syncCourses().catch(() => {});
        // 소명 대기 목록 배포 수신 (지시서 3장 5절) — 실패 시 기존 캐시 유지.
        syncFlaggedList().catch(() => {});
        // 회원 증서 갱신 (보안 감사 C-2) — 만료 임박·부재 시 재발급. 온라인 전용·실패 무시.
        renewMembershipIfDue().catch(() => {});
        // 기회적 동기화 (보안 감사 H-1) — 코인 지문 제출로 사후 이중 사용·초과 생성
        // 대조에 기여. 승인 아님·실패 무해 (다음 온라인 기회에 재제출).
        syncCoinFingerprints().catch(() => {});
        // 암호화 지갑 백업 (보안 감사 L-2) — 확정 코인을 종단간 암호화해 서버에 보관.
        // 폰 분실 시 니모닉으로 복구. 온라인 전용·실패 무해.
        wallet.backupWallet(Date.now()).catch(() => {});
        chatService.startPolling();
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
    return () => chatService.stopPolling();
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
        <Tab.Screen name="거래" component={TransactScreen} />
        <Tab.Screen name="더보기" component={MoreStackScreen} options={{ headerShown: false }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  error: { color: '#C62828', textAlign: 'center' },
});
