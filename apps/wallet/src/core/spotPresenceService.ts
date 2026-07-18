/**
 * 스팟 현장 결속 서비스 (R-스팟-현장결속) — 그 자리에서의 몸-걸음 인증 오케스트레이션.
 *
 * 보물(M9)은 걷기 추적 중에 존에 들어가면 시작되지만, 스팟은 **가게 앞에 서서 QR을
 * 스캔한 직후** 시작된다 — 걷기 추적이 꺼져 있을 수 있다. 그래서 이 서비스는 세션
 * 동안만 자기 센서 구독(위치·만보기)을 열고, 끝나면 즉시 닫는다.
 *
 * 위치 비저장(헌법 제9조·제10조): 좌표는 LegWalker의 휘발성 필드에서 상대 변위 계산에만
 * 쓰이고 저장되지 않는다. 노출·전송되는 것은 파생 지표와 수행 요약(지시 + 측정 걸음)뿐.
 *
 * 제1원칙: 선택 계층이다 — 이 화면에 들어와 스캔해야만 시작되며, 실패는 전부 무해하다.
 */
import { useSyncExternalStore } from 'react';
import type { GeoPoint, MovementLeg, SpotPresenceLegReport } from '@shvil/shared';
import { SpotPresenceSession, type SpotPresenceStatus } from '../walk/spotPresenceSession';

export interface SpotPresenceState {
  /** 진행 중(또는 방금 끝난) 세션 상태. 없으면 null. */
  session: SpotPresenceStatus | null;
  /** 위치 권한·센서를 얻지 못했다 (안내 문구는 화면이 조립). */
  sensorUnavailable: boolean;
}

const EMPTY: SpotPresenceState = { session: null, sensorUnavailable: false };

/** 센서 구독 해제 함수 묶음. */
interface Subs {
  location: { remove: () => void } | null;
  pedometer: { remove: () => void } | null;
}

class SpotPresenceService {
  #listeners = new Set<() => void>();
  #state: SpotPresenceState = EMPTY;
  #session: SpotPresenceSession | null = null;
  #subs: Subs = { location: null, pedometer: null };
  #lastStepTotal: number | null = null;
  /** 스팟 공개 위치 — 근접 판정 기준 (사업장 좌표, 사용자 좌표 아님). */
  #spotLocation: GeoPoint | null = null;
  #startChecked = false;

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): SpotPresenceState => this.#state;

  #set(partial: Partial<SpotPresenceState>): void {
    this.#state = { ...this.#state, ...partial };
    for (const fn of this.#listeners) fn();
  }

  /**
   * 세션 시작 — 서버가 낸 1회용 지시를 그 자리에서 수행하기 시작한다.
   * 첫 유효 픽스로 스팟 근접을 확인하고, 멀면 TOO_FAR로 막는다(원격 개시 차단).
   */
  async start(spotId: string, spotLocation: GeoPoint, challengeId: string, legs: MovementLeg[]): Promise<void> {
    await this.stop();
    this.#session = new SpotPresenceSession(spotId, challengeId, legs);
    this.#spotLocation = spotLocation;
    this.#startChecked = false;
    this.#lastStepTotal = null;
    this.#set({ session: this.#session.getStatus(), sensorUnavailable: false });

    try {
      const Location = await import('expo-location');
      const { Pedometer } = await import('expo-sensors');
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        this.#set({ sensorUnavailable: true });
        return;
      }
      this.#subs.location = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2_000, distanceInterval: 2 },
        (loc) => {
          this.#onFix({
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            timestamp: loc.timestamp,
            accuracy: loc.coords.accuracy ?? undefined,
            mocked: loc.mocked ?? undefined,
          });
        },
      );
      if (await Pedometer.isAvailableAsync()) {
        this.#subs.pedometer = Pedometer.watchStepCount((r) => {
          if (this.#lastStepTotal !== null) this.#onSteps(r.steps - this.#lastStepTotal);
          this.#lastStepTotal = r.steps;
        });
      } else {
        // 만보기가 없으면 걸음을 셀 수 없다 — 이 기기에서는 현장 인증을 할 수 없다.
        this.#set({ sensorUnavailable: true });
      }
    } catch {
      this.#set({ sensorUnavailable: true });
    }
  }

  #onFix(fix: { lat: number; lon: number; timestamp: number; accuracy?: number; mocked?: boolean }): void {
    if (!this.#session) return;
    // 첫 유효 픽스로 근접을 한 번 확인한다 — 서버는 이 판단을 할 수 없다(제9조).
    if (!this.#startChecked && !fix.mocked && this.#spotLocation) {
      this.#startChecked = true;
      if (!SpotPresenceSession.isWithinSpot({ lat: fix.lat, lon: fix.lon }, this.#spotLocation)) {
        this.#session.markTooFar();
        this.#set({ session: this.#session.getStatus() });
        void this.stop(true);
        return;
      }
    }
    this.#session.addFix(fix);
    this.#set({ session: this.#session.getStatus() });
  }

  #onSteps(delta: number): void {
    if (!this.#session) return;
    this.#session.addSteps(delta);
    const status = this.#session.getStatus();
    this.#set({ session: status });
    // 끝났으면 센서를 즉시 닫는다 (세션 밖에서 위치를 듣지 않는다).
    if (status.state !== 'ACTIVE') void this.stop(true);
  }

  /**
   * 수행 보고 — SUCCESS일 때만. 화면이 이것을 서버 청구에 실어 보낸다.
   * 좌표·변위가 없다 (지시 + 측정 걸음뿐).
   */
  report(): { challengeId: string; legs: SpotPresenceLegReport[] } | null {
    if (!this.#session || this.#session.state !== 'SUCCESS') return null;
    return { challengeId: this.#session.challengeId, legs: this.#session.report() };
  }

  /**
   * 센서 구독 해제. keepStatus=true면 결과 표시를 위해 세션 상태는 남긴다
   * (성공 보고를 화면이 꺼내갈 수 있어야 하므로 세션 객체도 유지).
   */
  async stop(keepStatus = false): Promise<void> {
    this.#subs.location?.remove();
    this.#subs.pedometer?.remove();
    this.#subs = { location: null, pedometer: null };
    this.#lastStepTotal = null;
    if (!keepStatus) {
      this.#session = null;
      this.#spotLocation = null;
      this.#startChecked = false;
      this.#set({ session: null, sensorUnavailable: false });
    }
  }

  /** 세션 완전 종료 — 결과 확인 후 화면이 부른다. */
  dismiss(): void {
    void this.stop(false);
  }
}

export const spotPresenceService = new SpotPresenceService();

export function useSpotPresence(): SpotPresenceState {
  return useSyncExternalStore(spotPresenceService.subscribe, spotPresenceService.getState);
}
