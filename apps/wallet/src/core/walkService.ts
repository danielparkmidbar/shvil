/**
 * 걷기 파이프라인 — 만보기 모델 (지시서 2.2).
 *
 * GPS·걸음 센서 → 회랑 엔진(휘발성 버퍼) → 60초 창 마감 → WalkSample → 잠정 원장.
 * 좌표는 회랑 엔진의 휘발성 버퍼에서만 살고, 창이 닫힐 때 폐기된다.
 *
 * TODO(M1 후속): 완전한 백그라운드 상시 동작은 expo-task-manager +
 * Location.startLocationUpdatesAsync + 개발 빌드(dev build)가 필요하다.
 * Expo Go에서는 포그라운드 추적으로 실기기 도보 테스트를 수행한다.
 * 배터리 절약 모드(수집 주기 완화)도 후속.
 */
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { CorridorEngine } from '../walk/corridorEngine';
import { SAMPLE_ANGELS, SHVIL_ISRAEL_NORTH_SAMPLE } from '../walk/data/shvilIsraelSample';
import { loadCachedAngels, loadCachedCourses } from './directory';
import { treasureService } from './treasureService';
import { wallet } from './walletService';

const WINDOW_MS = 60_000;
const STATUS_MS = 5_000;

class WalkService {
  #engine: CorridorEngine | null = null;
  #locationSub: Location.LocationSubscription | null = null;
  #pedometerSub: { remove(): void } | null = null;
  #windowTimer: ReturnType<typeof setInterval> | null = null;
  #statusTimer: ReturnType<typeof setInterval> | null = null;
  #lastStepTotal: number | null = null;

  get running(): boolean {
    return this.#windowTimer !== null;
  }

  /** 걷기 추적 시작. 반환: 실패 사유 (성공 시 null). */
  async start(): Promise<string | null> {
    if (this.running) return null;

    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return '위치 권한이 필요합니다 (정밀 위치).';
    // 백그라운드 권한은 선택 — 거부해도 포그라운드 추적은 동작한다.
    await Location.requestBackgroundPermissionsAsync().catch(() => null);

    const pedometerAvailable = await Pedometer.isAvailableAsync().catch(() => false);
    if (pedometerAvailable) {
      await Pedometer.requestPermissionsAsync().catch(() => null);
    }

    // 코스·엔젤 포인트: 디렉토리 캐시 우선, 없으면 내장 데이터 (오프라인 동작 필수).
    // 캐시는 공개 지도 데이터다 — 사용자 이동 궤적 좌표가 아니다.
    const cachedCourses = await loadCachedCourses().catch(() => null);
    const cachedAngels = await loadCachedAngels().catch(() => null);
    const angelPoints =
      cachedAngels && cachedAngels.length > 0
        ? cachedAngels
            .filter((a) => a.visible)
            .map((a) => ({ memberId: a.memberId, name: a.name, location: a.location }))
        : SAMPLE_ANGELS;
    this.#engine = new CorridorEngine(
      cachedCourses && cachedCourses.length > 0 ? cachedCourses : [SHVIL_ISRAEL_NORTH_SAMPLE],
      angelPoints,
    );

    // 보물 마이닝 (M9) — 선택 계층: 실패해도 걷기 추적에 영향 없음.
    // 보물이 없으면 아래 onFix/onSteps 훅은 아무 일도 하지 않는다 (0층 불변).
    await treasureService.startWatching().catch(() => {});

    this.#locationSub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 5_000,
        distanceInterval: 5,
      },
      (loc) => {
        const fix = {
          lat: loc.coords.latitude,
          lon: loc.coords.longitude,
          timestamp: loc.timestamp,
          accuracy: loc.coords.accuracy ?? undefined,
          mocked: loc.mocked ?? undefined,
        };
        this.#engine?.addFix(fix);
        // 존 진입 감지·챌린지 측정 — 픽스는 휘발성 경로에서 비교에만 쓰인다.
        treasureService.onFix(fix);
      },
    );

    if (pedometerAvailable) {
      this.#lastStepTotal = null;
      this.#pedometerSub = Pedometer.watchStepCount((result) => {
        if (this.#lastStepTotal !== null) {
          const delta = result.steps - this.#lastStepTotal;
          this.#engine?.addSteps(delta);
          treasureService.onSteps(delta);
        }
        this.#lastStepTotal = result.steps;
      });
    }

    this.#windowTimer = setInterval(() => {
      const sample = this.#engine?.closeWindow();
      if (sample) wallet.recordSample(sample);
    }, WINDOW_MS);

    this.#statusTimer = setInterval(() => {
      if (this.#engine) wallet.setLiveStatus(this.#engine.getLiveStatus(), true);
    }, STATUS_MS);

    return null;
  }

  stop(): void {
    if (this.#windowTimer) clearInterval(this.#windowTimer);
    if (this.#statusTimer) clearInterval(this.#statusTimer);
    this.#windowTimer = null;
    this.#statusTimer = null;
    this.#locationSub?.remove();
    this.#locationSub = null;
    this.#pedometerSub?.remove();
    this.#pedometerSub = null;
    // 마지막 창 마감 — 남은 좌표 폐기
    const sample = this.#engine?.closeWindow();
    if (sample) wallet.recordSample(sample);
    if (this.#engine) wallet.setLiveStatus(this.#engine.getLiveStatus(), false);
    this.#engine = null;
    treasureService.stopWatching();
  }
}

export const walkService = new WalkService();
