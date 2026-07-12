import { describe, expect, it } from 'vitest';
import { buildEtaMessage } from '../chatFormat';

describe('buildEtaMessage', () => {
  it('현재 시각 + N시간의 정형 문구를 만든다', () => {
    const now = new Date(2026, 6, 13, 14, 5, 0).getTime(); // 로컬 14:05
    expect(buildEtaMessage(2, now)).toBe('도착 예정 시각을 알려드립니다: 16:05 (약 2시간 후)');
  });

  it('자정을 넘겨도 두 자리 시각으로 표기한다', () => {
    const now = new Date(2026, 6, 13, 23, 30, 0).getTime();
    expect(buildEtaMessage(1, now)).toBe('도착 예정 시각을 알려드립니다: 00:30 (약 1시간 후)');
  });
});
