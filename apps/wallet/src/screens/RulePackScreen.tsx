/**
 * 위폐 감지 규칙 팩 (M16 배선) — 커뮤니티가 각자 자기 감지기를 얹는 곳.
 *
 * > 다니엘 쌤: "위폐 감지기도 각자 다운 받아 사용할 수 있다. 커뮤니티에게 툴을 주고
 * >  커뮤니티가 스스로 확인한다. … 내가 중앙에서 시스템을 유지하며 뭘 하는 것이 아니다."
 *
 * 이 화면이 지켜야 하는 두 가지:
 *  1. **팩이 무엇을 검사하는지 사람이 읽을 수 있어야 한다.** 팩은 코드가 아니라 데이터라
 *     안전하지만, 그 안전은 "눈으로 감사할 수 있다"를 전제한다. 그래서 조건식을 한국어
 *     문장으로 되돌려 보여 준다(rulePackFormat.ts).
 *  2. **팩은 코어를 건드리지 못한다는 사실을 화면이 말해야 한다.** 팩은 검사를 더할 수만
 *     있고 끄거나 완화할 수 없다 — 그것이 정책이 아니라 구조라는 점이 요점이다.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { EXAMPLE_RULE_PACKS, type RulePack } from '@shvil/shared';
import { explainPack, parseRulePackText, visibleMetrics, type ExplainedPack } from '../core/rulePackFormat';
import { addRulePack, loadRulePacks, removeRulePack, subscribeRulePacks } from '../core/rulePackStore';
import { Card, Muted, Title, colors } from '../ui/common';

function PackCard({ pack, onRemove }: { pack: ExplainedPack; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Title>{pack.name}</Title>
      <Muted>
        id {pack.id}
        {pack.author ? ` · 만든 이 ${pack.author}` : ''} · 규칙 {pack.ruleCount}개
      </Muted>
      {pack.description && <Muted>{pack.description}</Muted>}
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.toggle}>
        <Text style={styles.toggleText}>{open ? '▲ 규칙 접기' : '▼ 이 팩이 무엇을 검사하는지 보기'}</Text>
      </Pressable>
      {open &&
        pack.rules.map((r) => (
          <View key={r.id} style={styles.rule}>
            <Text style={[styles.ruleHead, { color: r.severity === 'FATAL' ? colors.danger : colors.warn }]}>
              [{r.severityText}] {r.id} · {r.scopeText}
            </Text>
            <Text style={styles.ruleWhen}>이럴 때 걸린다: {r.whenText}</Text>
            <Muted>{r.detail}</Muted>
          </View>
        ))}
      {onRemove && (
        <View style={styles.gap}>
          <Button title="이 팩 빼기" color={colors.danger} onPress={onRemove} />
        </View>
      )}
    </Card>
  );
}

export function RulePackScreen() {
  const [packs, setPacks] = useState<RulePack[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [showMetrics, setShowMetrics] = useState(false);

  const refresh = useCallback(() => {
    void loadRulePacks().then((r) => {
      setPacks(r.packs);
      setErrors(r.errors);
    });
  }, []);

  useEffect(() => {
    refresh();
    return subscribeRulePacks(refresh);
  }, [refresh]);

  const install = (pack: RulePack) => {
    void addRulePack(pack).then((next) => {
      setPacks(next);
      Alert.alert('규칙 팩을 얹었습니다', `"${pack.name}" 규칙 ${pack.rules.length}개가 수령 검사에 더해집니다.`);
    });
  };

  const installFromText = () => {
    const result = parseRulePackText(text);
    if (!result.ok || !result.pack) {
      Alert.alert('읽지 못했습니다', result.errors.join('\n') || '알 수 없는 형식입니다.');
      return;
    }
    setText('');
    install(result.pack);
  };

  const installed = new Set(packs.map((p) => p.id));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Title>규칙 팩이란</Title>
        <Muted>
          코인을 받을 때 돌아가는 검사에 **내 기준을 더하는** 데이터 묶음입니다. 코드가 아니라 정해진 항목만 가진
          JSON이라, 팩을 받는 것이 남의 코드를 실행하는 일이 되지 않습니다.
        </Muted>
        <Muted>
          팩은 검사를 **더할 수만** 있습니다 — 코어 검사를 끄거나 약하게 만들 수 없습니다. 그래서 나쁜 팩이 할 수
          있는 최악은 멀쩡한 코인을 억울하게 지목하는 것(성가심)이고, 위조를 진짜로 보이게 만드는 일은 못 합니다.
        </Muted>
        <Muted>
          "이 코인이 진짜인가"에 대한 공통 답은 언제나 **코어 판정**입니다. 팩 판정은 내 기준일 뿐이며 남에게
          강요되지 않습니다.
        </Muted>
        <Pressable onPress={() => setShowMetrics((v) => !v)} style={styles.toggle}>
          <Text style={styles.toggleText}>{showMetrics ? '▲ 접기' : '▼ 팩이 볼 수 있는 것 전부 보기'}</Text>
        </Pressable>
        {showMetrics && (
          <>
            <Muted>좌표·경로·코스 이름·시각 원본은 팩에 보이지 않습니다. 아래 숫자가 전부입니다.</Muted>
            {visibleMetrics().map((g) => (
              <View key={g.scope} style={styles.rule}>
                <Text style={styles.ruleHead}>{g.scope === 'proof' ? '코인 한 장' : '한 회원의 코인 묶음'}</Text>
                <Muted>{g.fields.map((f) => f.label).join(' · ')}</Muted>
              </View>
            ))}
          </>
        )}
      </Card>

      <Text style={styles.section}>얹은 팩 {packs.length}개</Text>
      {errors.map((e, i) => (
        <Text key={i} style={styles.error}>
          ⚠ {e}
        </Text>
      ))}
      {packs.length === 0 ? (
        <Card>
          <Muted>
            얹은 팩이 없습니다 — 수령 검사는 코어만 돕니다. 확인하지 않아도 손해가 없다면 그대로 두어도 됩니다.
          </Muted>
        </Card>
      ) : (
        packs.map((p) => (
          <PackCard
            key={p.id}
            pack={explainPack(p)}
            onRemove={() => void removeRulePack(p.id).then(setPacks)}
          />
        ))
      )}

      <Text style={styles.section}>본보기 팩</Text>
      <Muted>쉬빌이 승인한 목록이 아니라 "팩이란 이렇게 생겼다"를 보여 주는 예시입니다.</Muted>
      {EXAMPLE_RULE_PACKS.map((p) => (
        <View key={p.id}>
          <PackCard pack={explainPack(p)} />
          <Button
            title={installed.has(p.id) ? '이미 얹혀 있습니다 (다시 얹기)' : `"${p.name}" 얹기`}
            color={colors.primary}
            onPress={() => install(p)}
          />
          <View style={styles.gap} />
        </View>
      ))}

      <Text style={styles.section}>팩 직접 붙여넣기</Text>
      <Card>
        <Muted>
          누가 만든 팩이든 같은 해석기를 통과합니다. 모르는 연산자·지표가 하나라도 있으면 **로드에 실패합니다** —
          모르는 것을 조용히 통과시키지 않습니다.
        </Muted>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder='{"v":1,"id":"my-pack","name":"내 팩","rules":[…]}'
          multiline
        />
        <Button title="검사하고 얹기" color={colors.primary} onPress={installFromText} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 4 },
  section: { fontSize: 15, fontWeight: '800', marginTop: 14, marginBottom: 6 },
  toggle: { paddingVertical: 8 },
  toggleText: { color: colors.detour, fontWeight: '700' },
  rule: { marginTop: 8 },
  ruleHead: { fontWeight: '800', fontSize: 13 },
  ruleWhen: { fontWeight: '600', marginTop: 2 },
  gap: { marginTop: 8 },
  error: { color: colors.danger, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5C9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
    minHeight: 120,
    textAlignVertical: 'top',
    fontSize: 12,
  },
});
