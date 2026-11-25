import { type Site, TRAINING_YARD } from './site';

/** 주행 코스는 굴착 구역을 쓰지 않는다. 형식상 필요한 구역은 구석에 작게 둔다 */
const NO_ZONE = { x0: 0, x1: 0, z0: 0, z1: 0 };

/** 상차 작업장: 왼쪽에 덤프트럭이 서 있다. 적재함 벽(1.9m)보다 높이 들어서 쏟아야 실린다 */
export const TRUCK_YARD: Site = {
  ...TRAINING_YARD,
  name: '상차 작업장',
  dumpZone: { x0: -7.6, x1: -4.6, z0: -1.3, z1: 1.3 },
  truck: { bedTop: 1.9, capacity: 6 },
};

/** 평지 주행 코스 */
export const FLAT_COURSE: Site = {
  name: '평지 주행 코스',
  terrainSize: 80,
  cell: 0.4,
  digZone: NO_ZONE,
  dumpZone: NO_ZONE,
  hideZones: true,
  start: { x: 0, z: -28, heading: 0 },
};

/** 언덕 코스: 오르막과 내리막. 출발 지점 주변과 가장자리는 평평하다 */
export const HILL_COURSE: Site = {
  name: '언덕 코스',
  terrainSize: 90,
  cell: 0.45,
  digZone: NO_ZONE,
  dumpZone: NO_ZONE,
  hideZones: true,
  start: { x: 0, z: -34, heading: 0 },
  shape: (x, z) => {
    const edge = Math.max(0, Math.min(1, (45 - Math.max(Math.abs(x), Math.abs(z))) / 8));
    const nearStart = Math.max(0, Math.min(1, (Math.hypot(x, z + 34) - 6) / 8));
    // 바깥 평지(높이 0)보다 낮아지지 않게 한다. 언덕은 평지 위로만 솟는다
    return Math.max(0, edge * nearStart * (1.3 + 1.6 * Math.sin(z / 7.5) * Math.cos(x / 14) + 1.0 * Math.sin((x + z) / 9)));
  },
};

/** 운반 현장: 흙을 쏟을 곳이 멀리 있어 장비를 몰고 가야 한다 */
export const HAUL_SITE: Site = {
  name: '운반 현장',
  terrainSize: 60,
  cell: 0.2,
  digZone: { x0: -1.75, x1: 1.75, z0: 3.4, z1: 9.2 },
  dumpZone: { x0: 13, x1: 18, z0: 2, z1: 7 },
  start: { x: 0, z: 0, heading: 0 },
};

/** 도로 코스: 길게 이어지는 평지 코스. 고속 단으로 달린다 */
export const ROAD_COURSE: Site = {
  name: '도로 코스',
  terrainSize: 90,
  cell: 0.45,
  digZone: NO_ZONE,
  dumpZone: NO_ZONE,
  hideZones: true,
  start: { x: -30, z: -32, heading: 0 },
};
