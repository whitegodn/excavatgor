import { DEG } from '../../core/sim/math';

/**
 * 유압 실린더로 움직이는 관절 하나.
 * 실린더 길이 L은 삼각형의 한 변이다: L² = a² + b² - 2ab·cos(φ), φ = phiK·각도 + phiC.
 * 실린더가 늘어나면 φ가 커진다.
 */
export interface JointSpec {
  /** 관절 각도 하한(rad) */
  min: number;
  /** 관절 각도 상한(rad) */
  max: number;
  a: number;
  b: number;
  phiK: number;
  phiC: number;
  /** 끝에서 끝까지 움직이는 데 걸리는 시간(초, 최대 유량 기준) */
  strokeTime: number;
}

export interface ExcavatorSpec {
  name: string;
  /** 붐 핀 위치: 선회 중심에서 앞으로(m), 지면에서 위로(m), 오른쪽으로(m) */
  pivotR: number;
  pivotH: number;
  latOffset: number;
  boomLen: number;
  armLen: number;
  /** 버킷 핀에서 날 끝까지 */
  bucketLen: number;
  bucketWidth: number;
  /** 산적 용량(m³, 풀린 흙 기준) */
  bucketCapacity: number;
  /** 붐 각도: 수평 기준 위쪽이 + */
  boom: JointSpec;
  /** 암 각도: 붐 방향 기준. 값이 작을수록(더 음수) 운전석 쪽으로 당겨진다 */
  arm: JointSpec;
  /** 버킷 각도: 암 방향 기준. 값이 작을수록 오므려진다 */
  bucket: JointSpec;
  /** 선회 최고 속도(rad/s), 가속·제동·역레버 제동(rad/s²) */
  swingMax: number;
  swingAccel: number;
  swingBrake: number;
  swingCounterBrake: number;
  travelMax: number;
  travelAccel: number;
  /** 제자리 회전 때 궤도 미끄러짐으로 줄어드는 회전 비율 */
  spinTurnSlip: number;
  trackGauge: number;
  trackLength: number;
  /** 레버 입력에 대한 밸브 응답 지연(초) */
  valveTau: number;
  /** 펌프가 동시에 감당하는 유량(기능 1개 최대 요구 = 가중치 1 기준) */
  pumpUnits: number;
  flowWeights: { boom: number; arm: number; bucket: number; swing: number; travel: number };
  /** 이 깊이만큼 묻히면 굴착 동작이 멈춘다(m) */
  stallDepth: number;
  /** 붐을 내려 누르는 힘만으로 들어가는 깊이 한계(m). 이보다 깊이는 암·버킷으로 파야 한다 */
  boomStallDepth: number;
  /** 이 굴착 속도(m³/s)까지는 저항 없이 판다 */
  cutRateFree: number;
  cutRateSpan: number;
  /** 버킷에서 흙이 쏟아지는 최대 속도(m³/s) */
  pourRate: number;
  /** 버킷 위치의 가로 가속도가 이 값을 넘으면 산적분이 흘러내린다(m/s²) */
  spillAccel: number;
  initial: { boom: number; arm: number; bucket: number };
}

/**
 * 14톤급 크롤러 굴착기를 가정한 가상 제원.
 * 실제 기준 장비가 정해지면(구현계획 §10) 카탈로그 값으로 바꾼다.
 */
export const EXCAVATOR_14T: ExcavatorSpec = {
  name: '14톤급 크롤러 굴착기 (가상 제원)',
  pivotR: 0.45,
  pivotH: 1.95,
  latOffset: 0.2,
  boomLen: 5.2,
  armLen: 2.6,
  bucketLen: 1.35,
  bucketWidth: 1.0,
  bucketCapacity: 0.6,
  boom: { min: -35 * DEG, max: 60 * DEG, a: 2.3, b: 0.85, phiK: 1, phiC: 60 * DEG, strokeTime: 4.0 },
  arm: { min: -155 * DEG, max: -30 * DEG, a: 2.0, b: 0.65, phiK: -1, phiC: 5 * DEG, strokeTime: 3.6 },
  bucket: {
    min: -130 * DEG,
    max: 30 * DEG,
    a: 1.2,
    b: 0.45,
    phiK: -0.875,
    phiC: 46.25 * DEG,
    strokeTime: 2.8,
  },
  swingMax: 60 * DEG,
  swingAccel: 35 * DEG,
  swingBrake: 50 * DEG,
  swingCounterBrake: 90 * DEG,
  travelMax: 0.9,
  travelAccel: 1.0,
  spinTurnSlip: 0.55,
  trackGauge: 2.2,
  trackLength: 3.6,
  valveTau: 0.12,
  pumpUnits: 2.0,
  flowWeights: { boom: 1.0, arm: 1.0, bucket: 0.7, swing: 0.7, travel: 0.9 },
  stallDepth: 0.6,
  boomStallDepth: 0.3,
  cutRateFree: 0.12,
  cutRateSpan: 0.35,
  pourRate: 0.8,
  spillAccel: 5.0,
  initial: { boom: 20 * DEG, arm: -100 * DEG, bucket: -60 * DEG },
};
