import { keyFor, type LeverPattern } from '../core/input/levers';
import { ramp, scoreItem, type ScoreItem } from '../core/scoring/score';
import { DEG } from '../core/sim/math';
import { TRAINING_YARD } from '../sites/site';
import { CycleObjective, type Hurdle } from './objectives/cycleObjective';
import { ProcedureObjective } from './objectives/procedureObjective';
import { type JointTarget, TargetObjective } from './objectives/targetObjective';
import type { LevelDef, Metrics, TaskDef } from './task';

/**
 * ① 자격증 취득 과정 (굴착기운전기능사 실기 대비).
 *
 * 주의: 시험과 관련된 수치(장애물 높이, 제한 시간, 사이클 수, 감점·실격 기준)는
 * 공식 규격을 확인하기 전의 임시 값이다. provisional: true 로 표시한 과제가 해당한다.
 */

/** 공중 조작 과제의 시작 자세: 버킷을 적당히 든 준비 자세 */
const READY = { boom: 30 * DEG, arm: -90 * DEG, bucket: -60 * DEG };

const kb = (fn: Parameters<typeof keyFor>[0], p: LeverPattern) => `<kbd>${keyFor(fn, p)}</kbd>`;

/** 목표 지점 과제의 채점: 목표 달성 50, 시간 30, 안전 20. 벨트 없이 움직이면 점수와 상관없이 실격이다 */
function targetScore(par: number) {
  const zero = par * 2.5;
  return (m: Metrics): ScoreItem[] => {
    const all = m.completed >= m.total;
    return [
      scoreItem('targets', '목표 달성', 50, m.completed / m.total, `${m.completed} / ${m.total}개 통과`),
      scoreItem(
        'time',
        '시간',
        30,
        all ? ramp(m.time, par, zero) : 0,
        all ? `${m.time.toFixed(1)}초 (${par}초 이내 만점, ${zero}초부터 0점)` : '목표를 다 통과하지 못해 0점',
      ),
      scoreItem(
        'safety',
        '안전',
        20,
        m.belt > 0 ? 0 : (20 - 5 * m.groundTouches) / 20,
        m.belt > 0 ? '안전벨트 미착용' : m.groundTouches === 0 ? '위반 없음' : `땅에 닿음 ${m.groundTouches}회 (1회 5점)`,
      ),
    ];
  };
}

/** 굴착 사이클 과제의 채점: 작업량 40, 흘림 20, 시간 25, 안전 15 */
function cycleScore(par: number, limit: number, hurdle = false) {
  return (m: Metrics): ScoreItem[] => {
    const all = m.cycles >= m.target;
    const skipped = m.uncounted > 0 ? `, 세지 않은 사이클 ${m.uncounted}회의 흙은 제외` : '';
    return [
      scoreItem(
        'work',
        '작업량',
        40,
        ramp(m.dumped, m.target * 0.5, m.target * 0.15),
        `인정된 ${m.cycles}/${m.target}사이클로 파란 구역에 ${m.dumped.toFixed(2)}m³ (${(m.target * 0.5).toFixed(1)}m³ 이상 만점)${skipped}`,
      ),
      scoreItem(
        'clean',
        '흘림',
        20,
        // 쏟은 것이 없으면 흘리지 않았다고 점수를 주지 않는다
        m.dumped < 0.05 ? 0 : ramp(m.spilled + m.returned, 0.05 * m.target, 0.3 * m.target),
        m.dumped < 0.05
          ? '쏟은 흙이 없어 0점'
          : `구역 밖 ${m.spilled.toFixed(2)}m³, 들다가 떨어뜨림 ${m.returned.toFixed(2)}m³ (합계 ${(0.3 * m.target).toFixed(1)}m³부터 0점)`,
      ),
      scoreItem(
        'time',
        '시간',
        25,
        all ? ramp(m.time, par, limit) : 0,
        all ? `${m.time.toFixed(1)}초 (${par}초 이내 만점, ${limit}초부터 0점)` : '사이클을 다 채우지 못해 0점',
      ),
      scoreItem(
        'safety',
        '안전',
        15,
        m.belt > 0 ? 0 : (15 - 5 * m.hurdleHits) / 15,
        m.belt > 0
          ? '안전벨트 미착용'
          : hurdle
            ? m.hurdleHits === 0
              ? '장애물 접촉 없음'
              : `장애물 접촉 ${m.hurdleHits}회 (1회 5점)`
            : '위반 없음',
      ),
    ];
  };
}

function targetTask(
  id: string,
  level: number,
  title: string,
  summary: string,
  brief: string[],
  targets: JointTarget[],
  opts: { radius: number; par: number; limit: number | null; hint: ((p: LeverPattern) => string) | null; coach: TaskDef['coach'] },
): TaskDef {
  return {
    id,
    level,
    title,
    summary,
    brief,
    passText: '60점 이상. 목표를 모두 통과해야 시간 점수를 받습니다. 안전벨트 없이 움직이면 실격.',
    coach: opts.coach,
    timeLimit: opts.limit,
    passScore: 60,
    site: TRAINING_YARD,
    start: READY,
    create: (sim) => new TargetObjective(sim, targets, opts.radius, opts.hint, opts.limit),
    score: targetScore(opts.par),
  };
}

/** 임시 규격: 굴착 구역과 덤프 구역 사이에 가로놓인 높이 1.3m의 줄 */
export const PROVISIONAL_HURDLE: Hurdle = { x1: -2.2, z1: 2.2, x2: -6.2, z2: 6.2, height: 1.3 };

export const LEVELS: LevelDef[] = [
  { level: 0, name: '입문', summary: '장비 부위와 말뜻, 시동부터 종료까지의 절차' },
  { level: 1, name: '기초 조작', summary: '레버 하나씩: 붐, 암, 버킷, 선회' },
  { level: 2, name: '복합 조작', summary: '여러 레버를 함께 써서 버킷을 원하는 자리로' },
  { level: 3, name: '굴착 작업 연습', summary: '굴착 → 선회 → 쏟기 사이클' },
  {
    level: 4,
    name: '코스 운전 연습',
    summary: '실기시험 코스 주행',
    comingSoon: '다음 작업에서 만듭니다. 시험에 쓰는 장비(타이어식 여부)와 코스 치수를 확인해야 합니다.',
  },
  {
    level: 5,
    name: '모의 실기시험',
    summary: '실제 시험과 같은 순서·시간·채점',
    comingSoon: '레벨 4와 시험 규격이 준비된 뒤에 만듭니다.',
  },
];

export const TASKS: TaskDef[] = [
  {
    id: 'L0-1',
    level: 0,
    title: '장비와 말 익히기',
    summary: '부위 이름과 기본 안전 수칙 퀴즈',
    brief: ['굴착기의 부위 이름과 기본 안전 수칙을 묻는 문제 7개입니다.', '틀리면 설명을 읽고 다시 풀 수 있습니다.'],
    passText: '7문제를 모두 맞혀야 합니다.',
    coach: 'full',
    timeLimit: null,
    passScore: 100,
    site: TRAINING_YARD,
    quiz: [
      {
        q: '"붐"은 굴착기의 어느 부분입니까?',
        choices: ['흙을 담는 바가지', '차체에 붙은 굵은 팔', '굵은 팔 끝에 달린 가는 팔', '차체 아래의 궤도'],
        answer: 1,
        why: '붐은 차체에 붙은 굵은 팔입니다. 그 끝에 가는 팔인 "암"이, 암 끝에 "버킷"이 달려 있습니다.',
      },
      {
        q: '흙을 담는 바가지의 이름은 무엇입니까?',
        choices: ['암', '붐', '버킷', '궤도'],
        answer: 2,
        why: '버킷입니다. 오므리면 흙을 담고, 펴면 쏟습니다.',
      },
      {
        q: '"선회"는 무엇을 말합니까?',
        choices: ['장비가 앞으로 가는 것', '버킷을 오므리는 것', '차체 윗부분 전체가 좌우로 도는 것', '붐을 올리는 것'],
        answer: 2,
        why: '선회는 차체 윗부분(운전실과 팔 전체)이 좌우로 도는 것입니다. 궤도는 그대로 있습니다.',
      },
      {
        q: '안전레버가 잠겨 있으면 어떻게 됩니까?',
        choices: ['시동이 걸리지 않는다', '레버를 움직여도 장비가 움직이지 않는다', '장비가 더 빨리 움직인다', '경음기가 울린다'],
        answer: 1,
        why: '안전레버가 잠겨 있으면 조종 레버를 건드려도 장비가 움직이지 않습니다. 타고 내릴 때 실수로 움직이는 사고를 막습니다.',
      },
      {
        q: '운전석에 앉아 가장 먼저 할 일은 무엇입니까?',
        choices: ['안전레버를 푼다', '시동을 건다', '안전벨트를 맨다', '버킷을 든다'],
        answer: 2,
        why: '안전벨트를 먼저 맵니다. 그다음 시동, 경음기로 주변에 알리기, 안전레버 해제 순서입니다.',
      },
      {
        q: '흙을 가득 실은 채 선회를 멈출 때 옳은 방법은 무엇입니까?',
        choices: ['반대쪽 레버로 급하게 멈춘다', '도착하기 전에 레버를 놓아 천천히 멈춘다', '버킷을 펴서 멈춘다', '시동을 끈다'],
        answer: 1,
        why: '선회는 레버를 놓아도 조금 더 돕니다. 미리 놓아 천천히 멈춰야 흙을 흘리지 않습니다.',
      },
      {
        q: '작업을 마치고 장비에서 내리기 전의 올바른 순서는 무엇입니까?',
        choices: [
          '시동 끄기 → 버킷 내리기 → 안전레버 잠금',
          '안전레버 잠금 → 시동 끄기 → 버킷 내리기',
          '버킷을 땅에 내리기 → 안전레버 잠금 → 시동 끄기',
          '안전벨트 풀기 → 시동 끄기 → 버킷 내리기',
        ],
        answer: 2,
        why: '버킷을 땅에 내려놓고, 안전레버를 잠근 다음, 시동을 끕니다. 버킷을 든 채로 장비를 떠나면 안 됩니다.',
      },
    ],
  },
  {
    id: 'L0-2',
    level: 0,
    title: '시동부터 종료까지',
    summary: '안전벨트, 시동, 경음기, 안전레버, 각 레버 한 번씩, 종료 절차',
    brief: [
      '화면 위쪽 안내를 따라 12단계를 순서대로 합니다.',
      '안전벨트 → 시동 → 경음기 → 안전레버 해제 → 붐·암·버킷·선회를 한 번씩 → 버킷을 땅에 → 안전레버 잠금 → 시동 끄기 → 벨트 풀기',
      '순서를 어기면 감점됩니다. 시간 제한은 없습니다.',
    ],
    passText: '12단계를 순서 실수 없이 마쳐야 합니다 (100점).',
    coach: 'full',
    timeLimit: null,
    passScore: 100,
    site: TRAINING_YARD,
    create: () => new ProcedureObjective(),
    score: (m) => [
      scoreItem('steps', '절차 완료', 60, m.steps / m.total, `${m.steps} / ${m.total}단계`),
      scoreItem('order', '순서', 40, (40 - 10 * m.mistakes) / 40, m.mistakes === 0 ? '순서 실수 없음' : `순서 실수 ${m.mistakes}회`),
    ],
  },

  targetTask(
    'L1-1',
    1,
    '붐 올리고 내리기',
    '붐 레버만으로 버킷 높이 맞추기',
    ['붐만 움직여 노란 공 4개에 버킷 날 끝을 차례로 넣습니다.', '공 안에서 잠깐 멈추면 통과합니다. 짧게 톡톡 누르거나 Shift를 누른 채 조작하면 미세하게 움직입니다.'],
    [{ boom: 45 }, { boom: 25 }, { boom: 55 }, { boom: 30 }],
    { radius: 0.4, par: 25, limit: null, coach: 'full', hint: (p) => `붐만 쓰면 됩니다: 올리기 ${kb('boomUp', p)}, 내리기 ${kb('boomDown', p)}` },
  ),
  targetTask(
    'L1-2',
    1,
    '암 펴고 당기기',
    '암 레버만으로 버킷을 멀리, 가까이',
    ['암만 움직여 노란 공 4개에 버킷 날 끝을 차례로 넣습니다.', '암을 펴면 버킷이 멀어지고, 당기면 가까워집니다.'],
    [{ arm: -60 }, { arm: -120 }, { arm: -45 }, { arm: -90 }],
    { radius: 0.4, par: 25, limit: null, coach: 'full', hint: (p) => `암만 쓰면 됩니다: 펴기 ${kb('armOut', p)}, 당기기 ${kb('armIn', p)}` },
  ),
  targetTask(
    'L1-3',
    1,
    '버킷 오므리고 펴기',
    '버킷 레버만으로 날 끝 움직이기',
    ['버킷만 움직여 노란 공 4개에 버킷 날 끝을 차례로 넣습니다.', '버킷은 손목처럼 움직입니다. 오므리면 날 끝이 운전석 쪽으로 옵니다.'],
    [{ bucket: -110 }, { bucket: -15 }, { bucket: -125 }, { bucket: -60 }],
    { radius: 0.35, par: 20, limit: null, coach: 'full', hint: (p) => `버킷만 쓰면 됩니다: 오므리기 ${kb('curl', p)}, 펴기 ${kb('open', p)}` },
  ),
  targetTask(
    'L1-4',
    1,
    '선회하고 멈추기',
    '선회 레버만으로 방향 맞추기',
    ['선회만으로 노란 공 4개에 버킷 날 끝을 차례로 넣습니다.', '선회는 레버를 놓아도 조금 더 돕니다. 미리 놓고, 마지막은 Shift를 누른 채 맞추세요.'],
    [{ swing: -45 }, { swing: 40 }, { swing: -90 }, { swing: 0 }],
    { radius: 0.45, par: 35, limit: null, coach: 'full', hint: (p) => `선회만 쓰면 됩니다: 왼쪽 ${kb('swingL', p)}, 오른쪽 ${kb('swingR', p)}` },
  ),

  targetTask(
    'L2-1',
    2,
    '붐과 암 함께 쓰기',
    '두 레버를 함께 써서 버킷을 목표 지점으로',
    ['이번에는 붐과 암을 함께 써야 닿는 목표 5개입니다.', '두 키를 동시에 누르면 버킷이 비스듬히 움직입니다. 제한 시간은 2분입니다.'],
    [
      { boom: 42, arm: -60 },
      { boom: 24, arm: -115 },
      { boom: 50, arm: -100 },
      { boom: 32, arm: -50 },
      { boom: 30, arm: -90 },
    ],
    { radius: 0.35, par: 40, limit: 120, coach: 'notices', hint: (p) => `붐 ${kb('boomUp', p)}${kb('boomDown', p)} 과 암 ${kb('armOut', p)}${kb('armIn', p)} 을 함께` },
  ),
  targetTask(
    'L2-2',
    2,
    '선회하며 높이 맞추기',
    '선회, 붐, 암을 모두 써서 버킷 옮기기',
    ['선회하면서 붐과 암으로 높이와 거리를 맞춰야 하는 목표 5개입니다.', '선회하는 동안 붐을 함께 움직이면 시간이 줄어듭니다. 제한 시간은 2분 30초입니다.'],
    [
      { swing: -50, boom: 42, arm: -65 },
      { swing: 35, boom: 25, arm: -110 },
      { swing: -90, boom: 48, arm: -95 },
      { swing: 20, boom: 35, arm: -55 },
      { swing: 0 },
    ],
    { radius: 0.4, par: 60, limit: 150, coach: 'notices', hint: null },
  ),

  {
    id: 'L3-1',
    level: 3,
    title: '안내 따라 2사이클',
    summary: '안내를 따라 굴착 → 선회 → 쏟기를 두 번',
    brief: [
      '노란 구역의 흙을 파서 파란 구역에 쏟고, 노란 구역으로 돌아오면 한 사이클입니다. 두 번 합니다.',
      '화면 위쪽의 ①~⑦ 안내를 따라 하세요. 실수하면 이유를 알려 줍니다.',
      '두 번째는 쏟고 돌아온 자세에서 다시 시작합니다. 같은 자리가 깊어지면 조금 옆으로 옮겨 파세요.',
      '레벨 1·2와 달리 여기서는 땅을 팝니다. 버킷 입구 방향(위/옆)은 왼쪽 "자세" 칸에서 확인하세요.',
    ],
    passText: '60점 이상. 작업량 40, 흘림 20, 시간 25, 안전 15. 안전벨트 없이 움직이면 실격.',
    coach: 'full',
    timeLimit: 300,
    passScore: 60,
    site: TRAINING_YARD,
    create: () => new CycleObjective(2, 300),
    score: cycleScore(90, 300),
  },
  {
    id: 'L3-2',
    level: 3,
    title: '연속 3사이클',
    summary: '단계 안내 없이 세 번 이어서',
    brief: [
      '단계 안내 없이 3사이클을 이어서 합니다. 실수 알림은 나옵니다.',
      '같은 자리만 파면 깊어져 담기 어렵습니다. 좌우로 10°쯤씩 옮겨 파세요. 노란 구역을 벗어나 판 흙은 사이클로 세지 않습니다.',
      '버킷 입구 방향과 날 끝 높이는 왼쪽 "자세" 칸에 나옵니다. 제한 시간은 4분입니다.',
    ],
    passText: '60점 이상. 만점 기준: 1.5m³ 이상을 110초 안에. 안전벨트 없이 움직이면 실격.',
    coach: 'notices',
    timeLimit: 240,
    passScore: 60,
    site: TRAINING_YARD,
    create: () => new CycleObjective(3, 240),
    score: cycleScore(110, 240),
  },
  {
    id: 'L3-3',
    level: 3,
    title: '장애물 넘겨 쏟기 (시험 방식)',
    summary: '선회 경로의 줄을 넘겨 4사이클, 도움 없음',
    brief: [
      '굴착 구역과 덤프 구역 사이에 높이 1.3m의 줄이 있습니다. 버킷을 줄보다 높이 들고 선회해야 합니다.',
      '4사이클을 4분 안에 합니다. 단계 안내와 실수 알림이 없고, 줄에 닿았을 때만 알려 줍니다. 결과 화면에서 사이클별 기록과 실수를 볼 수 있습니다.',
      '줄에 닿으면 감점이고, 3번 닿으면 실격입니다.',
      '※ 줄 높이, 시간, 횟수, 감점·실격 기준은 공식 시험 규격을 확인하기 전의 임시 값입니다.',
    ],
    passText: '60점 이상. 장애물에 3번 닿거나 안전벨트 없이 움직이면 실격.',
    coach: 'none',
    timeLimit: 240,
    passScore: 60,
    provisional: true,
    site: TRAINING_YARD,
    create: () => new CycleObjective(4, 240, PROVISIONAL_HURDLE),
    score: cycleScore(130, 240, true),
  },
];

export function taskById(id: string): TaskDef | undefined {
  return TASKS.find((t) => t.id === id);
}
