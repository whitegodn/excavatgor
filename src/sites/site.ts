export interface Zone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Site {
  name: string;
  /** 변형 가능한 지형 한 변 길이(m) */
  terrainSize: number;
  /** 격자 간격(m) */
  cell: number;
  /** 굴착 구역 */
  digZone: Zone;
  /** 흙을 쌓을 지정 구역 */
  dumpZone: Zone;
  start: { x: number; z: number; heading: number };
  /** 처음 지형의 높이(m). 없으면 평지 */
  shape?: (x: number, z: number) => number;
  /** 덤프 구역이 덤프트럭 적재함인 경우: 적재함 벽 윗면 높이와 용량 */
  truck?: { bedTop: number; capacity: number };
  /** 굴착·덤프 구역을 쓰지 않는 현장(주행 코스) */
  hideZones?: boolean;
}

export type ZoneKind = 'dig' | 'dump' | 'none';

function inside(zn: Zone, x: number, z: number): boolean {
  return x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1;
}

export function zoneAt(site: Site, x: number, z: number): ZoneKind {
  if (inside(site.dumpZone, x, z)) return 'dump';
  if (inside(site.digZone, x, z)) return 'dig';
  return 'none';
}

/** P0 평지 연습장. 굴착 구역은 정면, 덤프 구역은 왼쪽 90°에 있다. */
export const TRAINING_YARD: Site = {
  name: '평지 연습장',
  terrainSize: 32,
  cell: 0.125,
  digZone: { x0: -1.75, x1: 1.75, z0: 3.4, z1: 9.2 },
  dumpZone: { x0: -8.2, x1: -4.0, z0: -2.1, z1: 2.1 },
  start: { x: 0, z: 0, heading: 0 },
};
