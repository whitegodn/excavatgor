/** 시뮬레이션은 화면 프레임과 무관하게 고정 주기로 돈다. */
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

/**
 * 한 틱 동안 장비에 들어가는 명령. 기능 단위(-1..1)로 표현한다.
 * 레버 → 기능 변환(레버 패턴)은 입력 계층에서 끝낸다.
 * 이 값의 나열이 곧 리플레이 기록이다.
 */
export interface Command {
  /** +1 = 우선회 */
  swing: number;
  /** +1 = 암 당기기(운전석 쪽) */
  arm: number;
  /** +1 = 붐 올리기 */
  boom: number;
  /** +1 = 버킷 오므리기(굴착) */
  bucket: number;
  /** +1 = 전진 */
  travelL: number;
  travelR: number;
  engineOn: boolean;
  /** 안전레버 잠금. true면 모든 유압 조작이 차단된다. */
  locked: boolean;
  /** 엔진 RPM 다이얼 1..10 */
  rpm: number;
  /** 안전벨트를 맸는가. 장비 움직임에는 영향이 없고, 절차·안전 채점에 쓴다. */
  belt: boolean;
  /** 경음기를 누르고 있는가 */
  horn: boolean;
  /** 주행 고속 단 (없으면 저속) */
  fast?: boolean;
}

export function idleCommand(): Command {
  return {
    swing: 0,
    arm: 0,
    boom: 0,
    bucket: 0,
    travelL: 0,
    travelR: 0,
    engineOn: false,
    locked: true,
    rpm: 8,
    belt: false,
    horn: false,
  };
}
