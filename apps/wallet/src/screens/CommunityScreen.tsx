/**
 * 커뮤니티 (M4) — 지시서 2.5(클레임 구제)·2.6(격려 코인)·3장 5절(소명)·6장.
 *
 * 세 세그먼트:
 *  - 클레임: 누락 걸음 구제 — 24시간 이내·월 2회, 커뮤니티 인정 투표(기준 5표).
 *    승인되면 서버가 승인서(SignedGrant)를 발행하고, 코인이 되는 것은 이 지갑의
 *    민팅(mintFromGrant)에서다 — 서버 발행·거래 승인이 아니다.
 *  - 완주 인증: 사진+데이터 요건 충족 시 즉시 격려 승인서 (완주 10 / 구간 3 SHV).
 *  - 투표: 열린 클레임에 "인정" — 커뮤니티가 운영하는 구제 절차.
 *
 * 위치 비저장 원칙: 어디에도 좌표가 없다 — 코스 ID·거리·시각뿐.
 * 커뮤니티는 온라인 전제 서버 기능이다 (마켓과 동일) — 걷기·지불 로직과 무관.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SHVIL_ISRAEL_NORTH_SAMPLE } from '@shvil/shared';
import { ApiError, type ClaimEntry, type FlaggedMemberEntry } from '../core/api';
import {
  directoryApi,
  getTrustedIssuerKeys,
  loadCachedCourses,
  loadFlaggedMembers,
  syncFlaggedList,
} from '../core/directory';
import { isProvisionalMemberId } from '../core/identity';
import { useWallet, wallet } from '../core/walletService';
import { Card, Muted, Title, colors, fmtShv } from '../ui/common';

type Segment = 'CLAIM' | 'CERT' | 'VOTE';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'CLAIM', label: '클레임' },
  { key: 'CERT', label: '완주 인증' },
  { key: 'VOTE', label: '투표' },
];

interface CourseOption {
  courseId: string;
  name: string;
  candidate: boolean;
}

/** 오류 문구 — 무통신이면 커뮤니티의 온라인 전제를 안내한다 (마켓과 동일 패턴). */
function communityErrText(e: unknown): string {
  if (e instanceof ApiError && e.status === 0) {
    return '커뮤니티 기능은 온라인에서만 동작합니다 — 서버에 연결되면 다시 시도하세요.';
  }
  return e instanceof Error ? e.message : String(e);
}

/** "12.5" → 12500 m. 잘못된 입력·0이면 null. */
function parseKmToMeters(text: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  const meters = parseInt(m[1]!, 10) * 1000 + parseInt((m[2] ?? '').padEnd(3, '0') || '0', 10);
  return meters > 0 ? meters : null;
}

export function CommunityScreen() {
  const w = useWallet();
  const [segment, setSegment] = useState<Segment>('CLAIM');
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const registered = !isProvisionalMemberId(w.memberId);

  // 코스 선택지: 캐시된 공식 코스(내장 폴백) + 후보 코스 제안 (온라인일 때).
  useEffect(() => {
    void (async () => {
      const cached = await loadCachedCourses().catch(() => null);
      const official = (cached && cached.length > 0 ? cached : [SHVIL_ISRAEL_NORTH_SAMPLE]).map((c) => ({
        courseId: c.courseId,
        name: c.name,
        candidate: false,
      }));
      let proposals: CourseOption[] = [];
      try {
        proposals = (await directoryApi.getCourseProposals())
          .filter((p) => p.status === 'CANDIDATE')
          .map((p) => ({ courseId: p.courseId, name: `${p.name} (후보 ${p.completions}명)`, candidate: true }));
      } catch {
        /* 오프라인 — 공식 코스만 */
      }
      const seen = new Set(official.map((c) => c.courseId));
      setCourses([...official, ...proposals.filter((p) => !seen.has(p.courseId))]);
    })();
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.segmentRow}>
        {SEGMENTS.map((s) => (
          <Pressable
            key={s.key}
            style={[styles.segmentBtn, segment === s.key && styles.segmentActive]}
            onPress={() => setSegment(s.key)}
          >
            <Text style={[styles.segmentText, segment === s.key && styles.segmentTextActive]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
      {!registered && (
        <Card>
          <Muted>클레임·인증·투표에는 가입이 필요합니다 (더보기 → 가입/설정). 목록은 볼 수 있습니다.</Muted>
        </Card>
      )}
      {segment === 'CLAIM' && <ClaimTab registered={registered} myMemberId={w.memberId} courses={courses} />}
      {segment === 'CERT' && <CertTab registered={registered} courses={courses} />}
      {segment === 'VOTE' && <VoteTab registered={registered} myMemberId={w.memberId} />}
    </View>
  );
}

// ── 공용: 코스 선택 칩 ─────────────────────────────────────────────

function CoursePicker({
  courses,
  selected,
  onSelect,
}: {
  courses: CourseOption[];
  selected: string | null;
  onSelect: (courseId: string) => void;
}) {
  if (courses.length === 0) return <Muted>코스 목록을 불러오는 중…</Muted>;
  return (
    <View style={styles.chipWrap}>
      {courses.map((c) => (
        <Pressable
          key={c.courseId}
          style={[styles.chip, selected === c.courseId && styles.chipActive]}
          onPress={() => onSelect(c.courseId)}
        >
          <Text style={[styles.chipText, selected === c.courseId && styles.chipTextActive]}>{c.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── 클레임: 누락 걸음 구제 (지시서 2.5) ────────────────────────────

function ClaimTab({
  registered,
  myMemberId,
  courses,
}: {
  registered: boolean;
  myMemberId: string;
  courses: CourseOption[];
}) {
  const [courseId, setCourseId] = useState<string | null>(null);
  const [hoursAgoText, setHoursAgoText] = useState('2'); // 걸은 시각 기본: 지금-2시간
  const [kmText, setKmText] = useState('');
  const [photoText, setPhotoText] = useState('');
  const [myClaims, setMyClaims] = useState<ClaimEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setBusy(true);
    directoryApi
      .getClaims()
      .then((rows) => {
        setMyClaims(rows.filter((c) => c.memberId === myMemberId));
        setError(null);
      })
      .catch((e) => setError(communityErrText(e)))
      .finally(() => setBusy(false));
  }, [myMemberId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const submit = () => {
    const distanceM = parseKmToMeters(kmText);
    const hoursAgo = /^\d+(\.\d+)?$/.test(hoursAgoText.trim()) ? parseFloat(hoursAgoText.trim()) : null;
    if (!courseId) return Alert.alert('입력 오류', '코스를 선택하세요.');
    if (hoursAgo === null || hoursAgo > 24) {
      return Alert.alert('입력 오류', '걸은 시각은 24시간 이내여야 합니다 — 하루 안에 일어난 실수에 한합니다.');
    }
    if (distanceM === null) return Alert.alert('입력 오류', '거리를 km 숫자로 입력하세요 (예: 12.5).');
    if (!photoText.trim()) {
      return Alert.alert('입력 오류', '사진 참조(해시 또는 URL)를 입력하세요 — 커뮤니티 검토의 근거입니다.');
    }
    setBusy(true);
    directoryApi
      .submitClaim({
        courseId,
        walkedAt: Date.now() - Math.round(hoursAgo * 3_600_000),
        distanceM,
        photos: [photoText.trim()],
      })
      .then((res) => {
        setKmText('');
        setPhotoText('');
        Alert.alert(
          '클레임 접수 완료',
          `클레임 #${res.claimId} — 커뮤니티 인정 투표를 기다립니다.\n기준 인원이 인정하면 여기서 "코인 받기"가 나타납니다.`,
        );
        refresh();
      })
      .catch((e) => {
        Alert.alert('접수 실패', communityErrText(e));
        setBusy(false);
      });
  };

  /** APPROVED 클레임의 승인서를 받아 이 지갑에서 민팅한다 (BONUS origin). */
  const receiveCoin = (claim: ClaimEntry) => {
    setBusy(true);
    void (async () => {
      const detail = await directoryApi.getClaim(claim.claimId);
      if (!detail.grant) throw new Error('승인서가 아직 발행되지 않았습니다 — 잠시 후 다시 시도하세요.');
      const trusted = await getTrustedIssuerKeys();
      const coin = await wallet.mintFromGrant(detail.grant, trusted, Date.now());
      Alert.alert('발행 완료', `${fmtShv(coin.amountDshv)}가 지갑에 발행되었습니다.\n(계보: 클레임 구제 — 인정자 수가 남습니다)`);
    })()
      .catch((e: unknown) => Alert.alert('코인 받기 실패', communityErrText(e)))
      .finally(() => setBusy(false));
  };

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Card>
        <Title>어제 걸음이 기록되지 않았나요?</Title>
        <Muted>
          실제로 걸었는데 앱을 켜지 않았거나 오류로 생성되지 않은 경우의 구제 절차입니다.
          걷기 발생 후 24시간 이내 접수만 유효하고, 1인당 월 2회까지입니다. 커뮤니티의 인정
          투표(기준 5표)를 받으면 해당 SHV가 산정되어 승인서가 발행됩니다 — 좌표는 어디에도
          제출되지 않습니다 (코스·거리·시각뿐).
        </Muted>
      </Card>

      <Card>
        <Title>클레임 제출</Title>
        <Muted>코스</Muted>
        <CoursePicker courses={courses} selected={courseId} onSelect={setCourseId} />
        <Muted>걸은 시각 — 몇 시간 전? (24시간 이내)</Muted>
        <TextInput
          style={styles.input}
          value={hoursAgoText}
          onChangeText={setHoursAgoText}
          placeholder="예: 2"
          keyboardType="decimal-pad"
        />
        <Muted>걸은 거리 (km)</Muted>
        <TextInput
          style={styles.input}
          value={kmText}
          onChangeText={setKmText}
          placeholder="예: 12.5"
          keyboardType="decimal-pad"
        />
        <Muted>사진 참조 (해시 또는 URL — 실제 업로드는 후속)</Muted>
        <TextInput
          style={styles.input}
          value={photoText}
          onChangeText={setPhotoText}
          placeholder="예: https://… 또는 sha256:…"
          autoCapitalize="none"
        />
        <Button title={busy ? '처리 중…' : '클레임 접수'} color={colors.primary} onPress={submit} disabled={busy || !registered} />
      </Card>

      <View style={styles.rowHead}>
        <Title>내 클레임</Title>
        <Button title="새로고침" color={colors.muted} onPress={refresh} disabled={busy} />
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {myClaims.length === 0 && !error && <Muted>제출한 클레임이 없습니다.</Muted>}
      {myClaims.map((c) => (
        <View key={c.claimId} style={styles.itemCard}>
          <View style={styles.rowHead}>
            <Text style={styles.itemTitle}>
              #{c.claimId} · {c.courseId}
            </Text>
            <Text style={styles.itemAmount}>{(c.distanceM / 1000).toFixed(1)} km</Text>
          </View>
          <Muted>
            {new Date(c.walkedAt).toLocaleString()} 걸음 · 투표 {c.votes}/{c.voteThreshold}
          </Muted>
          {c.status === 'APPROVED' ? (
            <Button title="코인 받기" color={colors.primary} onPress={() => receiveCoin(c)} disabled={busy} />
          ) : (
            <Text style={styles.stateText}>인정 투표 대기 중 ({c.votes}/{c.voteThreshold})</Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

// ── 완주 인증: 격려 코인 (지시서 2.6) ──────────────────────────────

function CertTab({ registered, courses }: { registered: boolean; courses: CourseOption[] }) {
  const [courseId, setCourseId] = useState<string | null>(null);
  const [kind, setKind] = useState<'FULL' | 'SECTION'>('FULL');
  const [kmText, setKmText] = useState('');
  const [daysText, setDaysText] = useState('');
  const [photoText, setPhotoText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = () => {
    const distanceM = parseKmToMeters(kmText);
    const days = /^\d+$/.test(daysText.trim()) ? parseInt(daysText.trim(), 10) : null;
    if (!courseId) return Alert.alert('입력 오류', '코스를 선택하세요.');
    if (distanceM === null || days === null || days <= 0) {
      return Alert.alert('입력 오류', '트레킹 데이터(거리 km·소요일)를 입력하세요 — 등록 요건입니다.');
    }
    if (!photoText.trim()) return Alert.alert('입력 오류', '완주 인증 사진 참조를 입력하세요 — 등록 요건입니다.');
    setBusy(true);
    void (async () => {
      const res = await directoryApi.submitCertificate({
        courseId,
        kind,
        photos: [photoText.trim()],
        data: { distanceM, days },
      });
      // 즉시 이 지갑에서 민팅 — 신뢰 발행 키(격려 키) 대조 포함 로컬 검증.
      const trusted = await getTrustedIssuerKeys();
      const coin = await wallet.mintFromGrant(res.grant, trusted, Date.now());
      // 후보 코스 지지: 완주 기록도 제출 (100명 승격 심사 — 실패해도 무방).
      await directoryApi.submitCompletion(courseId, distanceM, days).catch(() => null);
      setKmText('');
      setDaysText('');
      setPhotoText('');
      Alert.alert(
        '축하합니다! 🎉',
        `${kind === 'FULL' ? '완주' : '구간'} 인증 격려 코인 ${fmtShv(coin.amountDshv)}가 지갑에 발행되었습니다.\n나눈 기록은 커뮤니티의 검증 능력을 키웁니다.`,
      );
    })()
      .catch((e: unknown) => Alert.alert('인증 실패', communityErrText(e)))
      .finally(() => setBusy(false));
  };

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Card>
        <Title>완주 인증 — 격려 코인</Title>
        <Muted>
          정보를 나누는 사람이 커뮤니티를 만듭니다. 완주 인증 사진 + 트레킹 데이터가 요건을
          충족하면 격려 코인이 즉시 발행됩니다 — 코스 완주 10 SHV / 구간 3 SHV, 1인 1코스 1회.
          기간·총량 한정 프로모션이며 발행 현황은 투명성 페이지에 공시됩니다.
        </Muted>
      </Card>
      <Card>
        <Title>인증 제출</Title>
        <Muted>코스</Muted>
        <CoursePicker courses={courses} selected={courseId} onSelect={setCourseId} />
        <View style={styles.kindRow}>
          {(['FULL', 'SECTION'] as const).map((k) => (
            <Pressable key={k} style={[styles.chip, kind === k && styles.chipActive]} onPress={() => setKind(k)}>
              <Text style={[styles.chipText, kind === k && styles.chipTextActive]}>
                {k === 'FULL' ? '완주 (10 SHV)' : '구간 (3 SHV)'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Muted>총 거리 (km)</Muted>
        <TextInput style={styles.input} value={kmText} onChangeText={setKmText} placeholder="예: 1100" keyboardType="decimal-pad" />
        <Muted>소요일</Muted>
        <TextInput style={styles.input} value={daysText} onChangeText={setDaysText} placeholder="예: 45" keyboardType="number-pad" />
        <Muted>인증 사진 참조 (해시 또는 URL — 실제 업로드는 후속)</Muted>
        <TextInput
          style={styles.input}
          value={photoText}
          onChangeText={setPhotoText}
          placeholder="예: https://… 또는 sha256:…"
          autoCapitalize="none"
        />
        <Button
          title={busy ? '처리 중…' : '인증 제출 → 격려 코인 받기'}
          color={colors.primary}
          onPress={submit}
          disabled={busy || !registered}
        />
      </Card>
    </ScrollView>
  );
}

// ── 투표: 커뮤니티 인정 (지시서 2.5) + 소명 대기 목록 (3장 5절) ────

function VoteTab({ registered, myMemberId }: { registered: boolean; myMemberId: string }) {
  const [claims, setClaims] = useState<ClaimEntry[]>([]);
  const [flagged, setFlagged] = useState<FlaggedMemberEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setBusy(true);
    void (async () => {
      try {
        const rows = await directoryApi.getClaims('OPEN');
        setClaims(rows.filter((c) => c.memberId !== myMemberId)); // 본인 클레임 제외
        setError(null);
      } catch (e) {
        setError(communityErrText(e));
      }
      // 소명 대기 목록 수동 새로고침 — 실패하면 기존 캐시 유지.
      try {
        setFlagged(await syncFlaggedList());
      } catch {
        setFlagged(await loadFlaggedMembers());
      }
    })().finally(() => setBusy(false));
  }, [myMemberId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const vote = (claim: ClaimEntry) => {
    setBusy(true);
    directoryApi
      .voteClaim(claim.claimId)
      .then((res) => {
        Alert.alert(
          '인정 투표 완료',
          res.status === 'APPROVED'
            ? `기준 인원 도달 — 클레임 #${claim.claimId}이 승인되었습니다. 제출자가 코인을 받을 수 있습니다.`
            : `현재 ${res.votes}표 — 기준 인원에 도달하면 승인됩니다.`,
        );
        refresh();
      })
      .catch((e) => {
        Alert.alert('투표 실패', communityErrText(e));
        setBusy(false);
      });
  };

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Card>
        <Title>인정 투표</Title>
        <Muted>
          인정 투표는 실제 걸었다고 믿을 때만 — 커뮤니티가 운영하는 구제 절차입니다.
          기준 인원이 인정하면 서버가 요율·상한을 적용해 산정한 승인서를 발행합니다.
        </Muted>
        <Button title={busy ? '불러오는 중…' : '새로고침'} color={colors.primary} onPress={refresh} disabled={busy} />
      </Card>

      <Card>
        <Title>소명 대기 목록</Title>
        <Muted>
          이상 생성으로 포착된 회원 번호입니다 — 이 회원이 생성한 코인의 수령은 소명 통과까지
          보류됩니다. 이미 유통 중인 정상 코인과 타인의 거래는 영향받지 않습니다.
          {flagged.length === 0 ? ' 현재 소명 대기 회원이 없습니다.' : ''}
        </Muted>
        {flagged.map((f) => (
          <Muted key={f.memberId}>
            {f.memberId} · {f.reason} · {new Date(f.flaggedAt).toLocaleDateString()}
          </Muted>
        ))}
      </Card>

      {error && <Text style={styles.error}>{error}</Text>}
      {claims.length === 0 && !error && <Muted>투표할 열린 클레임이 없습니다.</Muted>}
      {claims.map((c) => (
        <View key={c.claimId} style={styles.itemCard}>
          <View style={styles.rowHead}>
            <Text style={styles.itemTitle}>
              #{c.claimId} · {c.courseId}
            </Text>
            <Text style={styles.itemAmount}>{(c.distanceM / 1000).toFixed(1)} km</Text>
          </View>
          <Muted>
            {c.memberId} · {new Date(c.walkedAt).toLocaleString()} 걸음 · 사진 {c.photos.length}장
          </Muted>
          <Muted>투표 {c.votes}/{c.voteThreshold}</Muted>
          <Button title="인정" color={colors.primary} onPress={() => vote(c)} disabled={busy || !registered} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
  },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontWeight: '700', color: colors.muted },
  segmentTextActive: { color: '#FFFFFF' },
  list: { gap: 8, paddingBottom: 24 },
  itemCard: { backgroundColor: colors.card, borderRadius: 10, padding: 12, gap: 6 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemTitle: { fontSize: 15, fontWeight: '700' },
  itemAmount: { fontSize: 16, fontWeight: '800', color: colors.primary },
  stateText: { fontWeight: '600', marginVertical: 4 },
  error: { color: colors.danger, marginBottom: 8 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 },
  kindRow: { flexDirection: 'row', gap: 6, marginVertical: 6 },
  chip: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.muted, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: '#FFFFFF' },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
    fontSize: 16,
    backgroundColor: '#FFFFFF',
  },
});
