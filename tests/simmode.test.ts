import { describe, expect, it } from 'vitest';
import { finalize, scoreItem } from '../src/core/scoring/score';
import { type Command, idleCommand, SIM_HZ } from '../src/core/sim/command';
import { clamp, DEG, wrapAngle } from '../src/core/sim/math';
import { CycleObjective } from '../src/curriculum/objectives/cycleObjective';
import { DriveObjective } from '../src/curriculum/objectives/driveObjective';
import { TruckObjective } from '../src/curriculum/objectives/truckObjective';
import { Progress } from '../src/curriculum/progress';
import { nextRank, simRank, simXp, STAGES, stageById, stageUnlocked, stars } from '../src/curriculum/simulatorMode';
import { Autopilot } from '../src/equipment/excavator/autopilot';
import { ExcavatorSim } from '../src/equipment/excavator/excavatorSim';
import { FLAT_COURSE, HILL_COURSE, TRUCK_YARD } from '../src/sites/simSites';

const on = (over: Partial<Command> = {}): Command => ({
  ...idleCommand(),
  engineOn: true,
  locked: false,
  rpm: 10,
  belt: true,
  ...over,
});

function begin(id: string) {
  const task = stageById(id)!;
  const sim = new ExcavatorSim(task.site, undefined, task.start);
  return { task, sim, objective: task.create!(sim) };
}

/** 다음 깃발 쪽으로 방향을 잡으며 달리는 단순한 운전자 */
function drive(sim: ExcavatorSim, objective: DriveObjective, fast: boolean, maxSeconds = 600): void {
  // 주행 전에 버킷을 든다
  for (let i = 0; i < 1.5 * SIM_HZ; i++) {
    const cmd = on({ boom: 1 });
    sim.step(cmd);
    objective.update(sim, cmd);
  }
  while (!objective.done && sim.tick < maxSeconds * SIM_HZ) {
    const c = objective.checkpoints[Math.min(objective.index, objective.checkpoints.length - 1)];
    const err = wrapAngle(Math.atan2(c.x - sim.x, c.z - sim.z) - sim.heading) / DEG;
    // 많이 틀어져 있으면 제자리 회전, 아니면 돌면서 전진
    const turn = clamp(err / 25, -1, 1);
    const cmd =
      Math.abs(err) > 50
        ? on({ travelL: Math.sign(err), travelR: -Math.sign(err), fast })
        : on({ travelL: clamp(1 + turn, -1, 1), travelR: clamp(1 - turn, -1, 1), fast });
    sim.step(cmd);
    objective.update(sim, cmd);
  }
}

describe('덤프트럭 싣기', () => {
  it('적재함보다 높은 데서 쏟은 흙은 트럭에 실리고, 총량이 보존된다', () => {
    const sim = new ExcavatorSim(TRUCK_YARD);
    const pilot = new Autopilot(2, -90 * DEG, 4.2);
    while (!pilot.done && sim.tick < 200 * SIM_HZ) sim.step(pilot.next(sim));
    expect(sim.truckLoad).toBeGreaterThan(0.9);
    expect(sim.dumped).toBeCloseTo(sim.truckLoad, 6);
    expect(sim.conservationError()).toBeLessThan(1);
    // 트럭에 실은 흙은 땅에 쌓이지 않는다
    const z = TRUCK_YARD.dumpZone;
    expect(sim.terrain.heightAt((z.x0 + z.x1) / 2, 0)).toBeLessThan(0.05);
  });

  it('적재함 벽보다 낮은 데서 쏟으면 트럭에 실리지 않는다', () => {
    const sim = new ExcavatorSim(TRUCK_YARD);
    // 보통 높이(2.4m)로 들고 가서 버킷을 펴면 입술이 적재함 벽보다 낮아진다
    const pilot = new Autopilot(1, -90 * DEG, 2.4);
    while (!pilot.done && sim.tick < 200 * SIM_HZ) sim.step(pilot.next(sim));
    expect(sim.spilled).toBeGreaterThan(0.2);
    expect(sim.truckLoad).toBeLessThan(sim.spilled);
  });

  it('S1-1: 높이 들고 세 번 실으면 합격, 낮게 넣으면 트럭 접촉으로 센다', () => {
    const good = begin('S1-1');
    const pilot = new Autopilot(4, -90 * DEG, 4.2);
    while (!good.objective.done && good.sim.tick < 400 * SIM_HZ) {
      const cmd = pilot.next(good.sim);
      good.sim.step(cmd);
      good.objective.update(good.sim, cmd);
    }
    const o = good.objective as TruckObjective;
    expect(good.sim.truckLoad).toBeGreaterThanOrEqual(1.5);
    expect(o.hits).toBe(0);
    expect(finalize(good.task.score!(o.metrics(good.sim), o), o.fatal, 60).pass).toBe(true);

    const low = begin('S1-1');
    const lowPilot = new Autopilot(4, -90 * DEG, 1.2);
    while (!low.objective.done && low.sim.tick < 400 * SIM_HZ) {
      const cmd = lowPilot.next(low.sim);
      low.sim.step(cmd);
      low.objective.update(low.sim, cmd);
    }
    expect((low.objective as TruckObjective).hits).toBeGreaterThan(0);
  });
});

describe('주행', () => {
  it('S1-2: 깃발을 따라 달리면 완주하고 합격한다', () => {
    const { task, sim, objective } = begin('S1-2');
    drive(sim, objective as DriveObjective, true);
    expect(objective.done).toBe(true);
    expect(objective.timedOut).toBe(false);
    const result = finalize(task.score!(objective.metrics(sim), objective), objective.fatal, task.passScore);
    expect(result.items[0].points).toBe(50);
    expect(result.pass).toBe(true);
  });

  it('고속 단이 저속보다 빠르다', () => {
    const slow = new ExcavatorSim(FLAT_COURSE);
    const fast = new ExcavatorSim(FLAT_COURSE);
    for (let i = 0; i < 5 * SIM_HZ; i++) {
      slow.step(on({ travelL: 1, travelR: 1 }));
      fast.step(on({ travelL: 1, travelR: 1, fast: true }));
    }
    expect(fast.z - FLAT_COURSE.start.z).toBeGreaterThan((slow.z - FLAT_COURSE.start.z) * 1.5);
  });

  it('언덕 코스: 땅이 평평하지 않고, 장비가 지형을 따라 오르내린다', () => {
    const sim = new ExcavatorSim(HILL_COURSE);
    expect(Math.abs(sim.y)).toBeLessThan(0.05); // 출발 지점은 평평하다
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < 60 * SIM_HZ; i++) {
      sim.step(on({ travelL: 1, travelR: 1, fast: true }));
      lo = Math.min(lo, sim.y);
      hi = Math.max(hi, sim.y);
    }
    expect(hi - lo).toBeGreaterThan(0.8);
  });

  it('오르막에서는 평지보다 느리다', () => {
    const slope = { ...FLAT_COURSE, shape: (_x: number, z: number) => (z + 28) * 0.25 };
    const flat = new ExcavatorSim(FLAT_COURSE);
    const up = new ExcavatorSim(slope);
    for (let i = 0; i < 5 * SIM_HZ; i++) {
      flat.step(on({ travelL: 1, travelR: 1 }));
      up.step(on({ travelL: 1, travelR: 1 }));
    }
    expect(up.z - slope.start.z).toBeLessThan((flat.z - FLAT_COURSE.start.z) * 0.8);
  });

  it('S2-1: 언덕 코스도 완주할 수 있다', () => {
    const { sim, objective } = begin('S2-1');
    drive(sim, objective as DriveObjective, true);
    expect(objective.done).toBe(true);
    expect(objective.timedOut).toBe(false);
  });

  it('버킷을 땅에 댄 채 주행하면 감점으로 센다', () => {
    const { sim, objective } = begin('S1-2');
    const o = objective as DriveObjective;
    for (let i = 0; i < 1.2 * SIM_HZ; i++) sim.step(on({ bucket: -1 }));
    for (let i = 0; i < 6 * SIM_HZ; i++) sim.step(on({ boom: -1 }));
    for (let i = 0; i < 2 * SIM_HZ; i++) {
      const cmd = on({ travelL: 1, travelR: 1 });
      sim.step(cmd);
      o.update(sim, cmd);
    }
    expect(o.drags).toBe(1);
  });
});

describe('스테이지 구성과 레벨업', () => {
  function fakeStore() {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  }
  const scored = (n: number) => finalize([scoreItem('a', 'A', 100, n / 100, '')], null, 60);

  it('모든 스테이지는 채점 만점 합이 100이고 심판을 만들 수 있다', () => {
    for (const st of STAGES) {
      const { sim, objective } = begin(st.id);
      expect(st.score!(objective.metrics(sim), objective).reduce((s, it) => s + it.max, 0)).toBe(100);
      expect(objective instanceof DriveObjective || objective instanceof TruckObjective || objective instanceof CycleObjective).toBe(true);
    }
  });

  it('처음에는 레벨 1 스테이지만 열려 있고, 경험치가 쌓이면 레벨이 오르며 다음 스테이지가 열린다', () => {
    const p = new Progress(STAGES, fakeStore(), 'test-sim');
    expect(simRank(simXp(p)).level).toBe(1);
    expect(stageUnlocked(stageById('S1-1')!, p)).toBe(true);
    expect(stageUnlocked(stageById('S2-1')!, p)).toBe(false);
    p.record('S1-1', scored(80));
    expect(simXp(p)).toBe(80);
    expect(nextRank(simXp(p))?.level).toBe(2);
    p.record('S1-2', scored(70));
    expect(simRank(simXp(p)).level).toBe(2);
    expect(stageUnlocked(stageById('S2-1')!, p)).toBe(true);
    expect(stageUnlocked(stageById('S3-1')!, p)).toBe(false);
  });

  it('같은 스테이지를 다시 해서 점수를 올리면 경험치도 오른다 (최고 점수 기준)', () => {
    const p = new Progress(STAGES, fakeStore(), 'test-sim');
    p.record('S1-1', scored(60));
    p.record('S1-1', scored(90));
    p.record('S1-1', scored(40));
    expect(simXp(p)).toBe(90);
  });

  it('별: 60점 1개, 80점 2개, 95점 3개', () => {
    expect([59, 60, 80, 95].map(stars)).toEqual([0, 1, 2, 3]);
  });
});
