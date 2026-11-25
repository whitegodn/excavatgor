import { ramp, scoreItem, type ScoreItem } from '../core/scoring/score';
import { FLAT_COURSE, HAUL_SITE, HILL_COURSE, ROAD_COURSE, TRUCK_YARD } from '../sites/simSites';
import { CycleObjective } from './objectives/cycleObjective';
import { type Checkpoint, DriveObjective } from './objectives/driveObjective';
import { TruckObjective } from './objectives/truckObjective';
import type { Progress } from './progress';
import type { Metrics, TaskDef } from './task';

/**
 * ② 시뮬레이터 모드: 게임처럼 스테이지를 깨며 레벨을 올린다.
 * 스테이지의 level은 "이 레벨이 되어야 열린다"는 뜻이다.
 * 경험치는 스테이지별 최고 점수의 합이고, 경험치가 쌓이면 레벨이 오른다.
 */

export interface SimRank {
  level: number;
  name: string;
  /** 이 레벨이 되는 데 필요한 경험치 */
  xp: number;
}

export const SIM_RANKS: SimRank[] = [
  { level: 1, name: '신입', xp: 0 },
  { level: 2, name: '조수', xp: 140 },
  { level: 3, name: '기사', xp: 320 },
  { level: 4, name: '반장', xp: 520 },
];

export const SIM_LEVEL_NAMES: Record<number, string> = {
  1: '작업장 적응',
  2: '현장 이동과 운반',
  3: '도로와 본 작업',
};

/** 주행 스테이지 채점: 완주 50, 시간 40, 안전 10 */
function driveScore(par: number, zero: number) {
  return (m: Metrics): ScoreItem[] => {
    const all = m.completed >= m.total;
    return [
      scoreItem('course', '코스', 50, m.completed / m.total, `깃발 ${m.completed} / ${m.total}개`),
      scoreItem(
        'time',
        '시간',
        40,
        all ? ramp(m.time, par, zero) : 0,
        all ? `${m.time.toFixed(1)}초 (${par}초 이내 만점, ${zero}초부터 0점)` : '완주하지 못해 0점',
      ),
      scoreItem(
        'safety',
        '안전',
        10,
        m.belt > 0 ? 0 : (10 - 5 * m.drags) / 10,
        m.belt > 0 ? '안전벨트 미착용' : m.drags === 0 ? '위반 없음' : `버킷을 끌며 주행 ${m.drags}회 (1회 5점)`,
      ),
    ];
  };
}

/** 상차 스테이지 채점: 적재량 40, 흘림 20, 시간 25, 안전 15 */
function truckScore(par: number, limit: number) {
  return (m: Metrics): ScoreItem[] => {
    const all = m.loaded >= m.target;
    return [
      scoreItem('load', '적재량', 40, ramp(m.loaded, m.target, m.target * 0.3), `트럭에 ${m.loaded.toFixed(2)} / ${m.target.toFixed(1)}m³`),
      scoreItem(
        'clean',
        '흘림',
        20,
        m.loaded < 0.05 ? 0 : ramp(m.spilled + m.returned, 0.1 * m.target, 0.6 * m.target),
        m.loaded < 0.05 ? '실은 흙이 없어 0점' : `트럭 밖 ${m.spilled.toFixed(2)}m³, 들다가 떨어뜨림 ${m.returned.toFixed(2)}m³`,
      ),
      scoreItem(
        'time',
        '시간',
        25,
        all ? ramp(m.time, par, limit) : 0,
        all ? `${m.time.toFixed(1)}초 (${par}초 이내 만점, ${limit}초부터 0점)` : '목표량을 채우지 못해 0점',
      ),
      scoreItem(
        'safety',
        '안전',
        15,
        m.belt > 0 ? 0 : (15 - 5 * m.hits) / 15,
        m.belt > 0 ? '안전벨트 미착용' : m.hits === 0 ? '트럭 접촉 없음' : `트럭 접촉 ${m.hits}회 (1회 5점)`,
      ),
    ];
  };
}

/** 운반 스테이지 채점 (굴착 사이클과 같은 구성) */
function haulScore(par: number, limit: number) {
  return (m: Metrics): ScoreItem[] => {
    const all = m.cycles >= m.target;
    return [
      scoreItem('work', '운반량', 40, ramp(m.dumped, m.target * 0.45, m.target * 0.1), `파란 구역에 ${m.dumped.toFixed(2)}m³, ${m.cycles}/${m.target}회`),
      scoreItem(
        'clean',
        '흘림',
        20,
        m.dumped < 0.05 ? 0 : ramp(m.spilled + m.returned, 0.05 * m.target, 0.3 * m.target),
        m.dumped < 0.05 ? '옮긴 흙이 없어 0점' : `구역 밖 ${m.spilled.toFixed(2)}m³, 들다가 떨어뜨림 ${m.returned.toFixed(2)}m³`,
      ),
      scoreItem(
        'time',
        '시간',
        25,
        all ? ramp(m.time, par, limit) : 0,
        all ? `${m.time.toFixed(1)}초 (${par}초 이내 만점, ${limit}초부터 0점)` : '횟수를 채우지 못해 0점',
      ),
      scoreItem('safety', '안전', 15, m.belt > 0 ? 0 : 1, m.belt > 0 ? '안전벨트 미착용' : '위반 없음'),
    ];
  };
}

const FLAT_GATES: Checkpoint[] = [
  { x: 0, z: -14 },
  { x: 8, z: -2 },
  { x: -8, z: 10 },
  { x: 8, z: 22 },
  { x: 0, z: 32 },
];
const HILL_GATES: Checkpoint[] = [
  { x: 0, z: -20 },
  { x: 10, z: -6 },
  { x: -6, z: 8 },
  { x: 8, z: 22 },
  { x: 0, z: 34 },
];
const ROAD_GATES: Checkpoint[] = [
  { x: -30, z: -12 },
  { x: -22, z: 8 },
  { x: -4, z: 18 },
  { x: 14, z: 10 },
  { x: 22, z: -8 },
  { x: 12, z: -26 },
  { x: -8, z: -30 },
  { x: -30, z: -32 },
];

const DRIVE_PASS = '60점 이상. 코스 50, 시간 40, 안전 10. 안전벨트 없이 움직이면 실격.';

export const STAGES: TaskDef[] = [
  {
    id: 'S1-1',
    level: 1,
    title: '덤프트럭에 싣기',
    summary: '흙을 파서 왼쪽 덤프트럭에 1.5m³ 싣기',
    brief: [
      '노란 구역의 흙을 파서 왼쪽에 서 있는 덤프트럭에 1.5m³(버킷 세 번쯤)를 싣습니다.',
      '적재함 벽은 높이 1.9m입니다. 버킷을 그보다 높이 든 다음 트럭 위로 선회하세요. 낮게 넣으면 트럭에 부딪힙니다.',
      '화면 위쪽 ①~⑦ 안내가 그대로 나옵니다. 트럭 위에서는 "지면 위" 높이가 적재함 윗면 기준으로 나옵니다.',
    ],
    passText: '60점 이상. 적재량 40, 흘림 20, 시간 25, 안전 15. 트럭에 3번 부딪히면 실격.',
    coach: 'full',
    timeLimit: 300,
    passScore: 60,
    site: TRUCK_YARD,
    create: () => new TruckObjective(1.5, 300),
    score: truckScore(110, 300),
  },
  {
    id: 'S1-2',
    level: 1,
    title: '깃발 따라 주행',
    summary: '평지에서 깃발 5개를 차례로 지나기',
    brief: [
      '방향키로 장비를 몰아 노란 공(깃발) 5개를 차례로 지나갑니다.',
      '↑ 전진, ↓ 후진, ← → 제자리 회전. ↑와 ←를 함께 누르면 돌면서 전진합니다. Q 키로 고속 단을 켭니다.',
      '주행하기 전에 붐을 올려 버킷을 드세요. 버킷을 땅에 끌면 감점입니다.',
    ],
    passText: DRIVE_PASS,
    coach: 'full',
    timeLimit: 300,
    passScore: 60,
    site: FLAT_COURSE,
    create: () => new DriveObjective(FLAT_GATES, 2.5, 300),
    score: driveScore(100, 260),
  },
  {
    id: 'S2-1',
    level: 2,
    title: '오르막과 내리막',
    summary: '언덕 코스를 넘어 깃발 5개 지나기',
    brief: [
      '언덕이 있는 코스입니다. 오르막에서는 느려지고 내리막에서는 조금 빨라집니다.',
      '가파른 곳은 비스듬히 오르지 말고 정면으로 오르세요. 깃발 5개를 차례로 지나면 완주입니다.',
    ],
    passText: DRIVE_PASS,
    coach: 'full',
    timeLimit: 360,
    passScore: 60,
    site: HILL_COURSE,
    create: () => new DriveObjective(HILL_GATES, 2.5, 360),
    score: driveScore(130, 320),
  },
  {
    id: 'S2-2',
    level: 2,
    title: '흙 운반하기',
    summary: '흙을 담아 멀리 떨어진 곳까지 몰고 가서 쏟기, 두 번',
    brief: [
      '이번에는 쏟을 곳(파란 구역)이 오른쪽으로 15m쯤 떨어져 있습니다. 선회만으로는 닿지 않습니다.',
      '흙을 담아 버킷을 든 채 장비를 몰고 가서 쏟고, 노란 구역으로 돌아오면 한 번입니다. 두 번 합니다.',
      '흙을 실은 채 급하게 돌거나 멈추면 흘립니다.',
    ],
    passText: '60점 이상. 운반량 40, 흘림 20, 시간 25, 안전 15.',
    coach: 'notices',
    timeLimit: 480,
    passScore: 60,
    site: HAUL_SITE,
    create: () => new CycleObjective(2, 480),
    score: haulScore(220, 480),
  },
  {
    id: 'S3-1',
    level: 3,
    title: '도로 타임 어택',
    summary: '긴 코스를 고속 단으로 한 바퀴',
    brief: [
      '깃발 8개를 이은 긴 코스를 한 바퀴 돕니다. Q 키로 고속 단을 켜야 만점 시간 안에 들어옵니다.',
      '돌 때는 한쪽 방향키만 길게 누르지 말고, ↑를 누른 채 ← →를 톡톡 눌러 방향을 잡으세요.',
    ],
    passText: DRIVE_PASS,
    coach: 'notices',
    timeLimit: 420,
    passScore: 60,
    site: ROAD_COURSE,
    create: () => new DriveObjective(ROAD_GATES, 3, 420),
    score: driveScore(170, 380),
  },
  {
    id: 'S3-2',
    level: 3,
    title: '덤프트럭 가득 싣기',
    summary: '안내 없이 3m³를 6분 안에',
    brief: [
      '단계 안내 없이 덤프트럭에 3m³(버킷 여섯 번쯤)를 싣습니다. 실수 알림은 나옵니다.',
      '같은 자리만 파면 깊어집니다. 좌우로 옮겨 가며 파세요.',
    ],
    passText: '60점 이상. 트럭에 3번 부딪히면 실격.',
    coach: 'notices',
    timeLimit: 360,
    passScore: 60,
    site: TRUCK_YARD,
    create: () => new TruckObjective(3, 360),
    score: truckScore(200, 360),
  },
];

export function stageById(id: string): TaskDef | undefined {
  return STAGES.find((t) => t.id === id);
}

/** 경험치: 스테이지별 최고 점수의 합 */
export function simXp(progress: Progress): number {
  return STAGES.reduce((sum, st) => sum + (progress.get(st.id)?.best ?? 0), 0);
}

export function simRank(xp: number): SimRank {
  let rank = SIM_RANKS[0];
  for (const r of SIM_RANKS) if (xp >= r.xp) rank = r;
  return rank;
}

/** 다음 레벨. 최고 레벨이면 null */
export function nextRank(xp: number): SimRank | null {
  return SIM_RANKS.find((r) => r.xp > xp) ?? null;
}

/** 스테이지는 그 레벨이 되면 열린다 */
export function stageUnlocked(stage: TaskDef, progress: Progress): boolean {
  return stage.level <= simRank(simXp(progress)).level;
}

/** 별: 60점 1개, 80점 2개, 95점 3개 */
export function stars(score: number): number {
  return score >= 95 ? 3 : score >= 80 ? 2 : score >= 60 ? 1 : 0;
}
