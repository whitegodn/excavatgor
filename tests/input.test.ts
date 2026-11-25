import { describe, expect, it } from 'vitest';
import {
  commandToLevers,
  FINE_SCALE,
  keysToTargets,
  LeverRamp,
  leversToCommand,
  zeroAxes,
} from '../src/core/input/levers';
import { DT } from '../src/core/sim/command';

const SW = { engineOn: true, locked: false, rpm: 8 };

describe('키보드 → 가상 레버', () => {
  it('WASD는 좌 레버, IJKL은 우 레버를 움직인다', () => {
    const t = keysToTargets(new Set(['KeyW', 'KeyA', 'KeyK', 'KeyL']));
    expect(t).toMatchObject({ lx: -1, ly: 1, rx: 1, ry: -1 });
  });

  it('Shift를 누르면 최대 기울기가 제한된다', () => {
    const t = keysToTargets(new Set(['KeyW', 'ShiftLeft']));
    expect(t.ly).toBeCloseTo(FINE_SCALE);
  });

  it('방향키: 위는 전진, 왼쪽은 제자리 좌회전', () => {
    expect(keysToTargets(new Set(['ArrowUp']))).toMatchObject({ tl: 1, tr: 1 });
    expect(keysToTargets(new Set(['ArrowLeft']))).toMatchObject({ tl: -1, tr: 1 });
  });

  it('키를 누르고 있으면 레버가 서서히 끝까지 기운다', () => {
    const ramp = new LeverRamp(0.4, 0.15);
    const target = { ...zeroAxes(), ly: 1 };
    ramp.update(target, DT);
    expect(ramp.axes.ly).toBeGreaterThan(0);
    expect(ramp.axes.ly).toBeLessThan(0.1);
    for (let i = 0; i < 0.2 / DT; i++) ramp.update(target, DT);
    expect(ramp.axes.ly).toBeGreaterThan(0.4);
    expect(ramp.axes.ly).toBeLessThan(0.7);
    for (let i = 0; i < 0.3 / DT; i++) ramp.update(target, DT);
    expect(ramp.axes.ly).toBe(1);
  });

  it('키를 떼면 짧게 감속한 뒤 정확히 중립으로 돌아온다', () => {
    const ramp = new LeverRamp(0.4, 0.15);
    ramp.axes.ly = 1;
    ramp.update(zeroAxes(), DT);
    expect(ramp.axes.ly).toBeLessThan(1);
    expect(ramp.axes.ly).toBeGreaterThan(0.8);
    for (let i = 0; i < 0.2 / DT; i++) ramp.update(zeroAxes(), DT);
    expect(ramp.axes.ly).toBe(0);
  });
});

describe('레버 패턴', () => {
  const levers = { lx: 0.3, ly: 0.5, rx: -0.7, ry: 0.9, tl: 0, tr: 0 };

  it('ISO: 좌 레버 앞 = 암 펴기, 우 레버 앞 = 붐 내리기', () => {
    const c = leversToCommand(levers, 'ISO', SW);
    expect(c.arm).toBeCloseTo(-0.5);
    expect(c.boom).toBeCloseTo(-0.9);
    expect(c.swing).toBeCloseTo(0.3);
    expect(c.bucket).toBeCloseTo(0.7);
  });

  it('SAE: 좌 레버 앞 = 붐 내리기, 우 레버 앞 = 암 펴기', () => {
    const c = leversToCommand(levers, 'SAE', SW);
    expect(c.boom).toBeCloseTo(-0.5);
    expect(c.arm).toBeCloseTo(-0.9);
  });

  it('명령 → 레버 변환은 레버 → 명령의 반대다', () => {
    for (const pattern of ['ISO', 'SAE'] as const) {
      const back = commandToLevers(leversToCommand(levers, pattern, SW), pattern);
      for (const k of ['lx', 'ly', 'rx', 'ry'] as const) expect(back[k]).toBeCloseTo(levers[k]);
    }
  });
});
