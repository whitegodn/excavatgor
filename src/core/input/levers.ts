import type { Command } from '../sim/command';
import { clamp } from '../sim/math';

/** 가상 레버의 기울기. 키보드·조이스틱·게임패드 모두 이 값으로 바뀐다. */
export interface LeverAxes {
  /** 좌 레버 좌(-)/우(+) */
  lx: number;
  /** 좌 레버 뒤(-)/앞(+) */
  ly: number;
  /** 우 레버 좌(-)/우(+) */
  rx: number;
  /** 우 레버 뒤(-)/앞(+) */
  ry: number;
  /** 좌 주행 레버 */
  tl: number;
  /** 우 주행 레버 */
  tr: number;
}

export const AXIS_KEYS: readonly (keyof LeverAxes)[] = ['lx', 'ly', 'rx', 'ry', 'tl', 'tr'];

export function zeroAxes(): LeverAxes {
  return { lx: 0, ly: 0, rx: 0, ry: 0, tl: 0, tr: 0 };
}

/** ISO: 좌=선회·암, 우=붐·버킷. SAE: 좌=선회·붐, 우=암·버킷. */
export type LeverPattern = 'ISO' | 'SAE';

export interface MachineSwitches {
  engineOn: boolean;
  locked: boolean;
  rpm: number;
  belt: boolean;
  horn: boolean;
  /** 주행 고속 단 */
  fast?: boolean;
}

/** 장비 동작 하나. 레버 방식에 따라 누르는 키가 달라진다. */
export type Fn = 'armOut' | 'armIn' | 'boomDown' | 'boomUp' | 'curl' | 'open' | 'swingL' | 'swingR';

export function keyFor(fn: Fn, pattern: LeverPattern): string {
  const iso = pattern === 'ISO';
  switch (fn) {
    case 'armOut':
      return iso ? 'W' : 'I';
    case 'armIn':
      return iso ? 'S' : 'K';
    case 'boomDown':
      return iso ? 'I' : 'W';
    case 'boomUp':
      return iso ? 'K' : 'S';
    case 'curl':
      return 'J';
    case 'open':
      return 'L';
    case 'swingL':
      return 'A';
    case 'swingR':
      return 'D';
  }
}

export function leversToCommand(l: LeverAxes, pattern: LeverPattern, sw: MachineSwitches): Command {
  const iso = pattern === 'ISO';
  return {
    swing: l.lx,
    arm: -(iso ? l.ly : l.ry),
    boom: -(iso ? l.ry : l.ly),
    bucket: -l.rx,
    travelL: l.tl,
    travelR: l.tr,
    engineOn: sw.engineOn,
    locked: sw.locked,
    rpm: sw.rpm,
    belt: sw.belt,
    horn: sw.horn,
    fast: sw.fast ?? false,
  };
}

/** 명령을 레버 기울기로 되돌린다(시범 운전 때 레버 표시용). */
export function commandToLevers(c: Command, pattern: LeverPattern): LeverAxes {
  const iso = pattern === 'ISO';
  return {
    lx: c.swing,
    ly: -(iso ? c.arm : c.boom),
    rx: -c.bucket,
    ry: -(iso ? c.boom : c.arm),
    tl: c.travelL,
    tr: c.travelR,
  };
}

export interface LeverLabels {
  left: { up: string; down: string; left: string; right: string };
  right: { up: string; down: string; left: string; right: string };
}

export function leverLabels(pattern: LeverPattern): LeverLabels {
  const arm = { up: '암 펴기', down: '암 당기기' };
  const boom = { up: '붐 내리기', down: '붐 올리기' };
  const iso = pattern === 'ISO';
  return {
    left: { ...(iso ? arm : boom), left: '좌선회', right: '우선회' },
    right: { ...(iso ? boom : arm), left: '버킷 오므리기', right: '버킷 펴기' },
  };
}

export const FINE_SCALE = 0.25;

/** 눌린 키 → 가상 레버 목표 기울기. Shift를 누르면 미세 조작(최대 기울기 제한). */
export function keysToTargets(keys: ReadonlySet<string>, fineScale = FINE_SCALE): LeverAxes {
  const k = (code: string) => (keys.has(code) ? 1 : 0);
  const fine = keys.has('ShiftLeft') || keys.has('ShiftRight') ? fineScale : 1;
  const f = k('ArrowUp') - k('ArrowDown');
  const t = k('ArrowRight') - k('ArrowLeft');
  return {
    lx: (k('KeyD') - k('KeyA')) * fine,
    ly: (k('KeyW') - k('KeyS')) * fine,
    rx: (k('KeyL') - k('KeyJ')) * fine,
    ry: (k('KeyI') - k('KeyK')) * fine,
    tl: clamp(f + t, -1, 1) * fine,
    tr: clamp(f - t, -1, 1) * fine,
  };
}

/**
 * 키보드의 눌림/안 눌림을 조이스틱처럼 서서히 기울어지는 값으로 바꾼다.
 * 누르면 rampUp초에 걸쳐 끝까지 기울고, 떼면 rampDown초에 걸쳐 중립으로 돌아온다.
 */
export class LeverRamp {
  readonly axes: LeverAxes = zeroAxes();

  constructor(
    public rampUp = 0.4,
    public rampDown = 0.15,
  ) {}

  update(target: LeverAxes, dt: number): void {
    for (const key of AXIS_KEYS) {
      this.axes[key] = this.approach(this.axes[key], target[key], dt);
    }
  }

  private approach(cur: number, tgt: number, dt: number): number {
    if (cur === tgt) return cur;
    const towardZero = Math.abs(tgt) < Math.abs(cur) || (cur !== 0 && Math.sign(tgt) !== Math.sign(cur));
    const step = dt / (towardZero ? this.rampDown : this.rampUp);
    const d = tgt - cur;
    if (Math.abs(d) <= step) return tgt;
    const next = cur + Math.sign(d) * step;
    // 중립으로 돌아오는 중에 0을 지나치지 않게 한다.
    if (towardZero && tgt === 0 && Math.sign(next) !== Math.sign(cur)) return 0;
    return next;
  }
}

/** 두 입력 중 더 크게 기울인 쪽을 쓴다(키보드와 조이스틱을 함께 쓸 수 있게). */
export function mergeAxes(a: LeverAxes, b: LeverAxes | null): LeverAxes {
  if (!b) return { ...a };
  const out = zeroAxes();
  for (const key of AXIS_KEYS) out[key] = Math.abs(b[key]) > Math.abs(a[key]) ? b[key] : a[key];
  return out;
}
