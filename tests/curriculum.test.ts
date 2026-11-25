import { describe, expect, it } from 'vitest';
import { finalize, ramp, scoreItem } from '../src/core/scoring/score';
import { type Command, idleCommand, SIM_HZ } from '../src/core/sim/command';
import { clamp, DEG } from '../src/core/sim/math';
import { LEVELS, PROVISIONAL_HURDLE, taskById, TASKS } from '../src/curriculum/excavatorLicense';
import { CycleObjective } from '../src/curriculum/objectives/cycleObjective';
import { ProcedureObjective } from '../src/curriculum/objectives/procedureObjective';
import { TargetObjective } from '../src/curriculum/objectives/targetObjective';
import { Progress } from '../src/curriculum/progress';
import type { Objective, TaskDef } from '../src/curriculum/task';
import { Autopilot } from '../src/equipment/excavator/autopilot';
import { ExcavatorSim } from '../src/equipment/excavator/excavatorSim';

function begin(id: string) {
  const task = taskById(id)!;
  const sim = new ExcavatorSim(task.site, undefined, task.start);
  const objective = task.create!(sim);
  return { task, sim, objective };
}

function score(task: TaskDef, sim: ExcavatorSim, objective: Objective) {
  return finalize(task.score!(objective.metrics(sim), objective), objective.fatal, task.passScore);
}

const on = (over: Partial<Command> = {}): Command => ({
  ...idleCommand(),
  engineOn: true,
  locked: false,
  rpm: 10,
  belt: true,
  ...over,
});

/** 목표 자세를 향해 관절을 하나씩 맞춰 가는 단순한 운전자 */
function driveTargets(sim: ExcavatorSim, objective: TargetObjective, belt = true, maxSeconds = 200): void {
  const start = { boom: sim.boomAngle, arm: sim.armAngle, bucket: sim.bucketAngle, swing: sim.swing };
  while (!objective.done && sim.tick < maxSeconds * SIM_HZ) {
    const t = objective.targets[Math.min(objective.index, objective.targets.length - 1)];
    const want = {
      boom: t.boom === undefined ? start.boom : t.boom * DEG,
      arm: t.arm === undefined ? start.arm : t.arm * DEG,
      bucket: t.bucket === undefined ? start.bucket : t.bucket * DEG,
      swing: t.swing === undefined ? start.swing : t.swing * DEG,
    };
    const swingErr = (want.swing - sim.swing) / DEG;
    const cmd = on({
      belt,
      boom: clamp((want.boom - sim.boomAngle) / DEG / 4, -1, 1),
      // 암·버킷은 실린더가 늘어날수록 각도가 줄어든다
      arm: clamp(-(want.arm - sim.armAngle) / DEG / 4, -1, 1),
      bucket: clamp(-(want.bucket - sim.bucketAngle) / DEG / 4, -1, 1),
      swing: clamp((Math.sign(swingErr) * Math.sqrt(2 * 25 * Math.abs(swingErr))) / 60, -1, 1),
    });
    sim.step(cmd);
    objective.update(sim, cmd);
  }
}

describe('채점', () => {
  it('ramp: 좋은 쪽 끝은 1, 나쁜 쪽 끝은 0', () => {
    expect(ramp(20, 25, 60)).toBe(1); // 시간: 작을수록 좋음
    expect(ramp(60, 25, 60)).toBe(0);
    expect(ramp(42.5, 25, 60)).toBeCloseTo(0.5);
    expect(ramp(2, 1.5, 0.5)).toBe(1); // 작업량: 클수록 좋음
    expect(ramp(0.2, 1.5, 0.5)).toBe(0);
  });

  it('60점 이상이면 합격, 실격 사유가 있으면 점수와 상관없이 불합격', () => {
    const items = [scoreItem('a', 'A', 70, 1, ''), scoreItem('b', 'B', 30, 0, '')];
    expect(finalize(items, null).pass).toBe(true);
    expect(finalize(items, null).total).toBe(70);
    expect(finalize(items, '실격').pass).toBe(false);
    expect(finalize([scoreItem('a', 'A', 100, 0.59, '')], null).pass).toBe(false);
  });
});

describe('과제 구성', () => {
  it('과제 번호가 겹치지 않고, 모든 과제가 정의된 레벨에 속한다', () => {
    const ids = TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TASKS) expect(LEVELS.some((l) => l.level === t.level && !l.comingSoon)).toBe(true);
  });

  it('모든 과제는 퀴즈이거나 조작 과제이고, 채점 항목의 만점 합이 100이다', () => {
    for (const t of TASKS) {
      if (t.quiz) {
        expect(t.quiz.length).toBeGreaterThan(0);
        for (const q of t.quiz) expect(q.answer).toBeLessThan(q.choices.length);
        continue;
      }
      const { sim, objective } = begin(t.id);
      const items = t.score!(objective.metrics(sim), objective);
      expect(items.reduce((s, it) => s + it.max, 0)).toBe(100);
    }
  });

  it('공중 조작 과제의 목표는 모두 땅 위 0.4m 이상에 있다', () => {
    for (const t of TASKS) {
      if (!t.create) continue;
      const { objective } = begin(t.id);
      if (!(objective instanceof TargetObjective)) continue;
      for (const pt of objective.points) expect(pt.y - objective.radius).toBeGreaterThan(0);
      for (const pt of objective.points) expect(pt.y).toBeGreaterThan(0.4);
    }
  });
});

describe('공중 조작 과제 (L1, L2)', () => {
  const ids = TASKS.filter((t) => t.level === 1 || t.level === 2).map((t) => t.id);

  it.each(ids)('%s: 목표 자세로 운전하면 모두 통과하고 합격한다', (id) => {
    const { task, sim, objective } = begin(id);
    driveTargets(sim, objective as TargetObjective);
    expect(objective.done).toBe(true);
    expect(objective.timedOut).toBe(false);
    const result = score(task, sim, objective);
    expect(result.items[0].points).toBe(50);
    expect(result.pass).toBe(true);
  });

  it('안전벨트 없이 장비를 움직이면 그 자리에서 실격으로 끝난다', () => {
    const { task, sim, objective } = begin('L1-1');
    driveTargets(sim, objective as TargetObjective, false);
    const result = score(task, sim, objective);
    expect(objective.beltViolations).toBe(1);
    expect(objective.done).toBe(true);
    // 움직이자마자 끝나므로 1초도 지나지 않았다
    expect(objective.time).toBeLessThan(1);
    expect(result.items.find((it) => it.id === 'safety')!.points).toBe(0);
    expect(result.fatal).not.toBeNull();
    expect(result.pass).toBe(false);
  });

  it('아무것도 하지 않으면 제한 시간에 끝나고 불합격이다', () => {
    const { task, sim, objective } = begin('L2-1');
    while (!objective.done && sim.tick < 300 * SIM_HZ) {
      const cmd = on();
      sim.step(cmd);
      objective.update(sim, cmd);
    }
    expect(objective.timedOut).toBe(true);
    expect(score(task, sim, objective).pass).toBe(false);
  });
});

describe('굴착 사이클 과제 (L3)', () => {
  function runPilot(id: string, pilot: Autopilot) {
    const { task, sim, objective } = begin(id);
    while (!objective.done && sim.tick < 400 * SIM_HZ) {
      const cmd = pilot.next(sim);
      sim.step(cmd);
      objective.update(sim, cmd);
    }
    return { task, sim, objective, result: score(task, sim, objective) };
  }

  it('L3-1: 시범 운전 2사이클이면 합격', () => {
    const r = runPilot('L3-1', new Autopilot(2));
    expect(r.objective.done).toBe(true);
    expect(r.result.pass).toBe(true);
    expect(r.result.total).toBeGreaterThan(85);
  });

  it('L3-2: 시범 운전 3사이클이면 합격', () => {
    const r = runPilot('L3-2', new Autopilot(3));
    expect(r.sim.cycles).toBe(3);
    expect(r.result.pass).toBe(true);
    // 사이클마다의 기록이 남고, 작업량은 인정된 사이클의 흙만 센다
    const o = r.objective as CycleObjective;
    expect(o.reports.length).toBe(3);
    expect(o.metrics(r.sim).dumped).toBeCloseTo(r.sim.dumped, 6);
  });

  it('세지 않은 사이클의 흙은 작업량에 넣지 않고, 쏟은 것이 없으면 흘림 점수도 없다', () => {
    const task = taskById('L3-2')!;
    const sim = new ExcavatorSim(task.site);
    const objective = task.create!(sim) as CycleObjective;
    // 덤프 구역의 반대쪽에 쏟는 시범 운전: 사이클로 인정되지 않는다
    const pilot = new Autopilot(1, 90 * DEG);
    while (!pilot.done && sim.tick < 120 * SIM_HZ) {
      const cmd = pilot.next(sim);
      sim.step(cmd);
      objective.update(sim, cmd);
    }
    const m = objective.metrics(sim);
    expect(m.uncounted).toBe(1);
    expect(m.dumped).toBe(0);
    const items = task.score!(m, objective);
    expect(items.find((it) => it.id === 'work')!.points).toBe(0);
    expect(items.find((it) => it.id === 'clean')!.points).toBe(0);
  });

  it('L3-3: 버킷을 높이 들고 선회하면 장애물에 닿지 않고 합격', () => {
    const r = runPilot('L3-3', new Autopilot(4));
    expect(r.sim.cycles).toBe(4);
    expect((r.objective as CycleObjective).hurdleHits).toBe(0);
    expect(r.result.fatal).toBeNull();
    expect(r.result.pass).toBe(true);
  });

  it('버킷을 낮게 든 채 장애물 쪽으로 선회하면 접촉으로 세고, 3번이면 실격', () => {
    const sim = new ExcavatorSim(taskById('L3-3')!.site);
    const objective = new CycleObjective(4, 240, PROVISIONAL_HURDLE);
    const run = (cmd: Command, seconds: number) => {
      for (let i = 0; i < seconds * SIM_HZ && !objective.done; i++) {
        sim.step(cmd);
        objective.update(sim, cmd);
      }
    };
    // 처음 자세는 버킷이 줄(1.3m)보다 낮다. 그대로 왼쪽으로 돌았다가 돌아오기를 되풀이한다
    for (let k = 0; k < 3 && !objective.done; k++) {
      run(on({ swing: -1 }), 2.2);
      run(on(), 1.5);
      run(on({ swing: 1 }), 2.2);
      run(on(), 1.5);
    }
    expect(objective.hurdleHits).toBe(3);
    expect(objective.fatal).not.toBeNull();
    expect(objective.done).toBe(true);
  });
});

describe('절차 과제 (L0-2)', () => {
  function run(objective: ProcedureObjective, sim: ExcavatorSim, cmd: Command, seconds: number, until?: () => boolean) {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.step(cmd);
      objective.update(sim, cmd);
      if (until?.()) break;
    }
  }

  it('순서대로 하면 12단계를 실수 없이 마치고 100점이다', () => {
    const { task, sim, objective } = begin('L0-2');
    const o = objective as ProcedureObjective;
    const off = idleCommand();
    run(o, sim, { ...off, belt: true }, 0.2);
    run(o, sim, { ...off, belt: true, engineOn: true }, 0.2);
    run(o, sim, { ...off, belt: true, engineOn: true, horn: true }, 0.2);
    run(o, sim, on(), 0.2);
    run(o, sim, on({ boom: 1 }), 2, () => o.index >= 5);
    run(o, sim, on({ arm: -1 }), 2, () => o.index >= 6);
    run(o, sim, on({ bucket: -1 }), 2, () => o.index >= 7);
    run(o, sim, on({ swing: 1 }), 3, () => o.index >= 8);
    run(o, sim, on(), 2);
    run(o, sim, on({ boom: -1 }), 10, () => o.index >= 9);
    run(o, sim, { ...off, belt: true, engineOn: true, locked: true }, 0.2);
    run(o, sim, { ...off, belt: true }, 0.2);
    run(o, sim, off, 0.2);
    expect(o.index).toBe(12);
    expect(o.done).toBe(true);
    expect(o.mistakes).toBe(0);
    const result = score(task, sim, objective);
    expect(result.total).toBe(100);
    expect(result.pass).toBe(true);
  });

  it('벨트 없이 시동을 걸고 경음기 없이 해제하면 순서 실수로 세고 불합격이다', () => {
    const { task, sim, objective } = begin('L0-2');
    const o = objective as ProcedureObjective;
    const off = idleCommand();
    // 과제가 시작되자마자(첫 틱에) 시동을 걸어도 잡아낸다
    run(o, sim, { ...off, engineOn: true }, 0.2);
    run(o, sim, { ...off, engineOn: true, locked: false }, 0.2);
    expect(o.mistakes).toBe(2);
    // 벨트 없이 레버를 움직인 것도 순서 실수다 (실격은 아니다)
    run(o, sim, { ...off, engineOn: true, locked: false, boom: 1 }, 0.3);
    expect(o.mistakes).toBe(3);
    expect(o.fatal).toBeNull();
    expect(score(task, sim, objective).pass).toBe(false);
  });
});

describe('진도와 해금', () => {
  function fakeStore() {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  }
  const pass = finalize([scoreItem('a', 'A', 100, 1, '')], null, 60);
  const fail = finalize([scoreItem('a', 'A', 100, 0.3, '')], null, 60);

  it('처음에는 첫 과제만 열려 있고, 합격하면 다음 과제가 열린다', () => {
    const p = new Progress(TASKS, fakeStore());
    expect(p.isUnlocked(TASKS[0].id)).toBe(true);
    expect(p.isUnlocked(TASKS[1].id)).toBe(false);
    p.record(TASKS[0].id, fail);
    expect(p.isUnlocked(TASKS[1].id)).toBe(false);
    expect(p.record(TASKS[0].id, pass)).toBe(true);
    expect(p.isUnlocked(TASKS[1].id)).toBe(true);
    expect(p.next()?.id).toBe(TASKS[1].id);
  });

  it('최고 점수와 시도 횟수를 기억하고, 한 번 합격한 과제는 합격으로 남는다', () => {
    const p = new Progress(TASKS, fakeStore());
    p.record('L0-1', pass);
    p.record('L0-1', fail);
    expect(p.get('L0-1')).toEqual({ best: 100, passed: true, attempts: 2 });
  });

  it('저장한 기록은 다시 열어도 남아 있다', () => {
    const store = fakeStore();
    new Progress(TASKS, store).record('L0-1', pass);
    expect(new Progress(TASKS, store).get('L0-1')?.passed).toBe(true);
  });

  it('L0~L2를 모두 합격하면 브론즈 등급이다', () => {
    const p = new Progress(TASKS, fakeStore());
    for (const t of TASKS.filter((x) => x.level <= 2)) {
      expect(p.badge()).toBeNull();
      p.record(t.id, pass);
    }
    expect(p.badge()).toEqual({ tier: '브론즈', name: '입문 운전자' });
  });
});
