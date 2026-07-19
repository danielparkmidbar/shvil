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
  { screen: 'INT 엔젤 명단', icon: '📜', title: 'INT 기존 트레일 엔젤', desc: 'INT 커뮤니티 공개 명단 (비회원 참고) · 구간순 · 전화 연결 · 오프라인 열람' },
  { screen: '메시지', icon: '💬', title: '메시지', desc: '엔젤과 채팅 · 종단간 암호화 · 도착 예정 시각 공유 · 감사 카드' },
  { screen: '게스트북', icon: '📖', title: '게스트북 (엔젤)', desc: '받은 감사 카드를 방명록에 공개·철회 (빈집 방명록의 디지털판)' },
  { screen: '내 신뢰 지표', icon: '✅', title: '내 신뢰 지표 (검증된 실적)', desc: '완주·검증 걷기 실적·활동 기간 뱃지 · 프로필 공개 on/off (별점 대신 사실)' },
  { screen: '내 별점', icon: '⭐', title: '내 별점 (참고 지표)', desc: '받은 별점을 프로필에 공개·철회 · 공개율 표시 (참고 지표 — 신뢰의 주 지표는 검증된 실적)' },
  { screen: '동행 찾기', icon: '🥾', title: '동행 찾기', desc: '여정을 나누고 함께 걸을 팀 모집 · 관심은 E2E 메시지로 (3~4인 권장)' },
  { screen: '스팟 보물', icon: '🎁', title: '스팟 보물 받기', desc: '트레일 근처 사업장이 숨긴 코인 · QR 스캔·선착순 1인 1회 · 코인 없으면 스탬프' },
  { screen: '스팟 운영', icon: '🏪', title: '스팟 보물 운영 (사업자)', desc: '내 코인을 예치(소각)해 손님에게 재배포 · 발행 아님, 총량 보존' },
  { screen: '내 포인트', icon: '🏠', title: '내 포인트 (엔젤)', desc: '엔젤 모드 전환 · 위치·서비스 등록 · 등록 보너스' },
  { screen: '마켓', icon: '🪙', title: '코인 마켓', desc: '무정가 리스팅 · 가격 제시 · 에스크로 USDC 정산 (온라인 전용)' },
  { screen: '커뮤니티', icon: '🤝', title: '커뮤니티', desc: '클레임 구제 · 완주 인증 격려 코인 · 인정 투표 (온라인 전용)' },
  { screen: '복구 문구', icon: '🔑', title: '복구 문구 · 백업', desc: '12단어 복구 문구 확인 · 폰 분실 시 확정 코인 복구' },
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
