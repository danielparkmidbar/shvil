/**
 * 더보기 — 엔젤 지도·메시지·내 포인트(엔젤)·가입/설정 진입 (M2 탭 재구성).
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet } from '../core/walletService';
import { Muted, colors } from '../ui/common';
import type { MoreStackParamList } from './navTypes';

const MENU: { screen: keyof MoreStackParamList; icon: string; title: string; desc: string }[] = [
  { screen: '엔젤 지도', icon: '🗺', title: '엔젤 지도', desc: '주변 엔젤을 거리순으로 — 서비스 아이콘·메시지 보내기' },
  { screen: '메시지', icon: '💬', title: '메시지', desc: '엔젤과 채팅 · 종단간 암호화 · 도착 예정 시각 공유' },
  { screen: '내 포인트', icon: '🏠', title: '내 포인트 (엔젤)', desc: '엔젤 모드 전환 · 위치·서비스 등록 · 등록 보너스' },
  { screen: '가입/설정', icon: '⚙️', title: '가입 / 설정', desc: '정식 회원 번호 발급 (전화+이메일) · 서버 주소' },
];

export function MoreScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const w = useWallet();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {MENU.map((m) => (
        <Pressable key={m.title} style={styles.row} onPress={() => navigation.navigate(m.screen as never)}>
          <Text style={styles.icon}>{m.icon}</Text>
          <View style={styles.textCol}>
            <Text style={styles.title}>{m.title}</Text>
            <Muted>{m.desc}</Muted>
          </View>
        </Pressable>
      ))}
      <Muted>
        회원 번호 {w.memberId}
        {isProvisionalMemberId(w.memberId) ? ' (임시 — 가입하면 정식 번호가 발급됩니다)' : ''} · 모드{' '}
        {w.mode === 'ANGEL' ? '엔젤 🏠' : '리스트 🥾'}
      </Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  icon: { fontSize: 26 },
  textCol: { flex: 1 },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
});
