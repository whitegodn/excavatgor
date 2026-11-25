import { describe, expect, it } from 'vitest';
import { DT, SIM_HZ } from '../src/core/sim/command';
import { DEG } from '../src/core/sim/math';
import { CylinderJoint } from '../src/equipment/excavator/cylinder';
import { EXCAVATOR_14T } from '../src/equipment/excavator/params';
import { Autopilot } from '../src/equipment/excavator/autopilot';
import { activeCommand, newSim, replay, runAutopilot } from './helpers';

describe('실린더 관절', () => {
  it('각도 ↔ 실린더 길이 변환이 서로 맞는다', () => {
    for (const spec of [EXCAVATOR_14T.boom, EXCAVATOR_14T.arm, EXCAVATOR_14T.bucket]) {
      for (let t = 0; t <= 1; t += 0.1) {
        const angle = spec.min + (spec.max - spec.min) * t;
        const j = new CylinderJoint(spec, angle);
        expect(j.angle).toBeCloseTo(angle, 9);
      }
    }
  });

  it('스트로크 끝에서 멈춘다', () => {
    const j = new CylinderJoint(EXCAVATOR_14T.boom, 0);
    for (let i = 0; i < 20 * SIM_HZ; i++) j.step(j.vMax, DT);
    expect(j.angle).toBeCloseTo(EXCAVATOR_14T.boom.max, 6);
    for (let i = 0; i < 20 * SIM_HZ; i++) j.step(-j.vMax, DT);
    expect(j.angle).toBeCloseTo(EXCAVATOR_14T.boom.min, 6);
  });
});

describe('유압 동작', () => {
  it('시동이 꺼져 있거나 안전레버가 잠겨 있으면 움직이지 않는다', () => {
    for (const over of [{ engineOn: false }, { locked: true }]) {
      const sim = newSim();
      const before = sim.hash();
      for (let i = 0; i < 2 * SIM_HZ; i++) sim.step(activeCommand({ boom: 1, swing: 1, travelL: 1, ...over }));
      expect(sim.swing).toBe(0);
      expect(sim.x).toBe(0);
      expect(sim.hash().slice(0)).not.toBe('');
      expect(sim.boomAngle).toBeCloseTo(EXCAVATOR_14T.initial.boom, 9);
      expect(before).not.toBe(sim.hash()); // 틱 수는 올라간다
    }
  });

  it('여러 동작을 동시에 하면 각 동작이 느려진다(유량 분배)', () => {
    const solo = newSim();
    const multi = newSim();
    for (let i = 0; i < SIM_HZ; i++) {
      solo.step(activeCommand({ boom: 1 }));
      multi.step(activeCommand({ boom: 1, arm: -1, bucket: -1, swing: 1 }));
    }
    const soloRise = solo.boomAngle - EXCAVATOR_14T.initial.boom;
    const multiRise = multi.boomAngle - EXCAVATOR_14T.initial.boom;
    expect(soloRise).toBeGreaterThan(5 * DEG);
    expect(multiRise).toBeLessThan(soloRise * 0.75);
    expect(multi.flowShare).toBeLessThan(1);
  });

  it('엔진 RPM이 낮으면 느려진다', () => {
    const fast = newSim();
    const slow = newSim();
    for (let i = 0; i < SIM_HZ; i++) {
      fast.step(activeCommand({ boom: 1, rpm: 10 }));
      slow.step(activeCommand({ boom: 1, rpm: 2 }));
    }
    expect(slow.boomAngle).toBeLessThan(fast.boomAngle);
  });

  it('선회는 관성이 있어 레버를 놓아도 조금 더 돈다', () => {
    const sim = newSim();
    for (let i = 0; i < 3 * SIM_HZ; i++) sim.step(activeCommand({ swing: 1 }));
    const atRelease = sim.swing;
    expect(sim.swingVel).toBeGreaterThan(40 * DEG);
    for (let i = 0; i < 3 * SIM_HZ; i++) sim.step(activeCommand());
    expect(sim.swingVel).toBe(0);
    expect(sim.swing - atRelease).toBeGreaterThan(10 * DEG);
  });

  it('좌우 주행 레버를 함께 밀면 직진, 반대로 밀면 제자리 회전', () => {
    const straight = newSim();
    const spin = newSim();
    for (let i = 0; i < 3 * SIM_HZ; i++) {
      straight.step(activeCommand({ travelL: 1, travelR: 1 }));
      spin.step(activeCommand({ travelL: -1, travelR: 1 }));
    }
    expect(straight.z).toBeGreaterThan(2);
    expect(Math.abs(straight.x)).toBeLessThan(1e-9);
    expect(spin.heading).toBeLessThan(-30 * DEG);
    expect(Math.hypot(spin.x, spin.z)).toBeLessThan(1e-6);
  });

  it('버킷 날을 세워 땅에 박으면 깊어질수록 느려지다가 멈춘다', () => {
    const sim = newSim();
    // 버킷을 펴서 날이 아래를 향하게 한 뒤 붐만 내린다
    for (let i = 0; i < 1.2 * SIM_HZ; i++) sim.step(activeCommand({ bucket: -1 }));
    for (let i = 0; i < 12 * SIM_HZ; i++) sim.step(activeCommand({ boom: -1 }));
    const p = sim.pose();
    // 붐으로 누르는 힘만으로는 얕게만 들어간다
    expect(p.baseY + p.tipY).toBeLessThan(-0.08);
    expect(p.baseY + p.tipY).toBeGreaterThan(-0.4);
    expect(sim.digResist).toBeLessThan(0.3);
  });

  it('오므린 버킷의 등으로 땅을 눌러도 흙이 담기지 않고 거의 들어가지 않는다', () => {
    const sim = newSim();
    for (let i = 0; i < 6 * SIM_HZ; i++) sim.step(activeCommand({ boom: -1 }));
    const p = sim.pose();
    expect(sim.load).toBeLessThan(EXCAVATOR_14T.bucketCapacity * 0.05);
    expect(p.baseY + p.tipY).toBeGreaterThan(-0.3);
    expect(sim.digResist).toBeLessThan(0.3);
  });

  it('버킷이 멈춰 있으면 적재량이 저절로 늘지 않는다', () => {
    const sim = newSim();
    for (let i = 0; i < 1.2 * SIM_HZ; i++) sim.step(activeCommand({ bucket: -1 }));
    for (let i = 0; i < 3 * SIM_HZ; i++) sim.step(activeCommand({ boom: -1 }));
    for (let i = 0; i < 1.5 * SIM_HZ; i++) sim.step(activeCommand({ arm: 1 }));
    for (let i = 0; i < 0.5 * SIM_HZ; i++) sim.step(activeCommand());
    const settled = sim.load;
    expect(settled).toBeGreaterThan(0.05);
    for (let i = 0; i < 3 * SIM_HZ; i++) sim.step(activeCommand());
    expect(sim.load).toBeLessThanOrEqual(settled + 1e-9);
  });

  it('흙을 가득 실으면 선회가 둔해진다', () => {
    const empty = newSim();
    const full = newSim();
    for (const sim of [empty, full]) {
      for (let i = 0; i < 4 * SIM_HZ; i++) sim.step(activeCommand({ bucket: 1, boom: 0.5 }));
    }
    full.load = EXCAVATOR_14T.bucketCapacity;
    for (let i = 0; i < SIM_HZ; i++) {
      empty.step(activeCommand({ swing: 1 }));
      full.step(activeCommand({ swing: 1 }));
    }
    expect(full.swing).toBeLessThan(empty.swing * 0.9);
  });
});

describe('굴착 → 선회 → 덤프 사이클', () => {
  const run = runAutopilot(1);

  it('시범 운전이 한 사이클을 1분 안에 마친다', () => {
    expect(run.pilot.done).toBe(true);
    expect(run.sim.cycles).toBe(1);
    expect(run.sim.time).toBeLessThan(60);
    expect(run.sim.lastCycleTime).toBeGreaterThan(8);
  });

  it('버킷을 거의 채워 지정 구역에 쏟는다', () => {
    const cap = EXCAVATOR_14T.bucketCapacity;
    expect(run.sim.captured).toBeGreaterThan(cap * 0.8);
    expect(run.sim.dumped).toBeGreaterThan(cap * 0.7);
    expect(run.sim.load).toBeLessThan(0.01);
    expect(run.sim.spilled).toBeLessThan(cap * 0.1);
  });

  it('덤프 구역에 흙더미가 생기고 굴착 구역이 파인다', () => {
    const t = run.sim.terrain;
    let pile = 0;
    let pit = 0;
    for (let k = 0; k < t.h.length; k++) {
      pile = Math.max(pile, t.h[k]);
      pit = Math.min(pit, t.h[k]);
    }
    expect(pile).toBeGreaterThan(0.2);
    expect(pit).toBeLessThan(-0.2);
  });

  it('부피 보존 오차가 1% 이내다', () => {
    expect(run.sim.conservationError()).toBeLessThan(1);
  });

  it('같은 입력 기록을 재생하면 결과가 완전히 같다', () => {
    const a = replay(run.log);
    const b = replay(run.log);
    expect(a.hash()).toBe(run.sim.hash());
    expect(b.hash()).toBe(a.hash());
    expect(a.dumped).toBe(run.sim.dumped);
    expect(a.spilled).toBe(run.sim.spilled);
  });

  it('입력이 조금이라도 다르면 결과가 달라진다', () => {
    const changed = run.log.map((c, i) => (i === 200 ? { ...c, boom: c.boom * 0.5 + 0.1 } : c));
    expect(replay(changed).hash()).not.toBe(run.sim.hash());
  });

  it('세 사이클을 이어서 해도 보존 오차가 1% 이내다', () => {
    const three = runAutopilot(3, 240);
    expect(three.pilot.done).toBe(true);
    expect(three.sim.cycles).toBe(3);
    expect(three.sim.conservationError()).toBeLessThan(1);
  });
});

describe('사이클 판정', () => {
  it('유효한 사이클은 굴착 구역으로 돌아왔을 때 기록된다', () => {
    const run = runAutopilot(1);
    const r = run.sim.lastCycle!;
    expect(run.sim.reportCount).toBe(1);
    expect(r.valid).toBe(true);
    expect(r.time).toBe(run.sim.lastCycleTime);
    expect(r.dumped).toBeCloseTo(run.sim.dumped, 9);
    expect(run.sim.awaitingReturn).toBe(false);
  });

  it('지정 구역 밖에 쏟으면 사이클로 세지 않는다', () => {
    const sim = newSim();
    // 덤프 구역(왼쪽 90°)의 반대쪽에 쏟는 시범 운전
    const pilot = new Autopilot(1, 90 * DEG);
    while (!pilot.done && sim.tick < 120 * SIM_HZ) sim.step(pilot.next(sim));
    expect(pilot.done).toBe(true);
    expect(sim.cycles).toBe(0);
    expect(sim.spilled).toBeGreaterThan(0.3);
    expect(sim.lastCycle?.valid).toBe(false);
    expect(sim.lastCycle?.fault).toBe('none');
  });

  it('덜 오므린 채 들어 올려 떨어뜨린 흙은 "도로 떨어뜨림"으로 집계된다', () => {
    const sim = newSim();
    // 버킷 입구가 옆을 보는 자세에서 가득 실려 있다고 하면, 버틸 수 있는 양만 남고 쏟아진다
    for (let i = 0; i < 1.2 * SIM_HZ; i++) sim.step(activeCommand({ bucket: -1 }));
    const cap = EXCAVATOR_14T.bucketCapacity;
    sim.load = cap;
    for (let i = 0; i < 3 * SIM_HZ; i++) sim.step(activeCommand({ boom: 1 }));
    expect(sim.load).toBeLessThan(cap * 0.8);
    expect(sim.load + sim.returned).toBeCloseTo(cap, 6);
    expect(sim.returned).toBeGreaterThan(0.05);
    expect(sim.spilled).toBe(0);
  });
});

describe('사이클 판정 (보완)', () => {
  it('엎어진 버킷으로는 흙이 담기지 않는다', () => {
    const sim = newSim();
    // 암을 끝까지 당기고 버킷을 끝까지 오므리면 입구가 아래를 향한다
    for (let i = 0; i < 0.5 * SIM_HZ; i++) sim.step(activeCommand({ boom: 1 }));
    for (let i = 0; i < 3 * SIM_HZ; i++) sim.step(activeCommand({ arm: 1 }));
    for (let i = 0; i < 3 * SIM_HZ; i++) sim.step(activeCommand({ bucket: 1 }));
    const before = sim.load;
    for (let i = 0; i < 6 * SIM_HZ; i++) sim.step(activeCommand({ boom: -1 }));
    expect(-Math.cos(sim.pose().a3)).toBeLessThan(-0.5);
    expect(sim.load).toBeLessThanOrEqual(before + 0.02);
  });

  it('흙을 남긴 채 굴착 구역으로 돌아와도 한 사이클로 마감하고 남긴 양을 알려 준다', () => {
    const sim = newSim();
    const pilot = new Autopilot(1);
    let cut = false;
    while (!pilot.done && sim.tick < 120 * SIM_HZ) {
      const cmd = pilot.next(sim);
      // 쏟는 단계에서 절반쯤 쏟았으면 그만 쏟고 돌아간다
      if (pilot.phase === 6 && sim.load < EXCAVATOR_14T.bucketCapacity * 0.5) {
        pilot.phase = 7;
        cut = true;
      }
      sim.step(cmd);
    }
    expect(cut).toBe(true);
    expect(sim.cycles).toBe(1);
    expect(sim.lastCycle?.valid).toBe(true);
    expect(sim.lastCycle!.leftover).toBeGreaterThan(0.1);
  });

  it('선회하다 굴착 구역을 스쳐 지나가는 것만으로는 복귀로 치지 않는다', () => {
    const run = runAutopilot(1);
    // 시범 운전은 굴착 구역에서 멈춘 뒤에야 사이클이 기록된다
    expect(run.sim.cycles).toBe(1);
    expect(Math.abs(run.sim.swing)).toBeLessThan(20 * DEG);
  });
});

describe('흘림', () => {
  it('가득 실은 채 선회를 반대로 꺾으면 흙이 흘러내린다', () => {
    const sim = newSim();
    // 버킷을 위로 향하게 들고 흙을 채운 상태를 만든다
    for (let i = 0; i < 4 * SIM_HZ; i++) sim.step(activeCommand({ bucket: 1, boom: 0.5 }));
    sim.load = EXCAVATOR_14T.bucketCapacity;
    for (let i = 0; i < 2.5 * SIM_HZ; i++) sim.step(activeCommand({ swing: 1 }));
    const gentle = sim.spilled + sim.returned + sim.dumped;
    for (let i = 0; i < SIM_HZ; i++) sim.step(activeCommand({ swing: -1 }));
    const harsh = sim.spilled + sim.returned + sim.dumped;
    expect(gentle).toBeLessThan(0.005);
    expect(harsh).toBeGreaterThan(0.02);
  });
});
