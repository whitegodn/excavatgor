import { SIM_HZ } from '../../core/sim/command';
import type { ExcavatorSim } from '../../equipment/excavator/excavatorSim';

/**
 * 버킷 통과 구역: 선회 경로에 가로놓인 두 기둥(폴) 사이.
 * 실기시험의 굴착작업에서 버킷은 아래의 줄보다 높게, 위의 가상 통과 제한선보다 낮게 지나가야 한다.
 */
export interface Hurdle {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** 아래 줄의 높이(m). 버킷 바닥이 이보다 높아야 한다 */
  height: number;
  /** 위쪽 통과 제한선의 높이(m). 버킷 위쪽이 이보다 낮아야 한다. 없으면 위쪽 제한이 없다 */
  top?: number;
}

/** 선분 a-b가 통과 구역의 선(두 기둥 사이)을 가로지르는가 */
export function crosses(ax: number, az: number, bx: number, bz: number, h: Hurdle): boolean {
  const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
    (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = side(h.x1, h.z1, h.x2, h.z2, ax, az);
  const d2 = side(h.x1, h.z1, h.x2, h.z2, bx, bz);
  const d3 = side(ax, az, bx, bz, h.x1, h.z1);
  const d4 = side(ax, az, bx, bz, h.x2, h.z2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** 버킷에서 가장 낮은 곳과 가장 높은 곳의 높이(처음 지면 기준) */
export function bucketSpan(sim: ExcavatorSim): { low: number; high: number } {
  const p = sim.pose();
  return {
    low: p.baseY + Math.min(p.tipY, p.wristY) - 0.15,
    high: p.baseY + Math.max(p.tipY, p.wristY) + 0.15,
  };
}

/** pass: 줄과 제한선 사이로 지나감 / low: 아래 줄에 닿음 / high: 위쪽 제한선을 넘음 */
export type GateEvent = 'pass' | 'low' | 'high';

/** 버킷이 통과 구역을 지나는 순간을 지켜보고 통과·접촉을 센다 */
export class GateWatch {
  /** 줄에 닿거나 제한선을 넘은 횟수 */
  hits = 0;
  /** 깨끗하게 지나간 횟수 */
  passes = 0;
  private prevX = Number.NaN;
  private prevZ = Number.NaN;
  private quietUntil = 0;

  constructor(readonly gate: Hurdle) {}

  /** 매 틱 부른다. 이번 틱에 버킷 가운데가 통과 구역의 선을 가로질렀으면 그 결과를 돌려준다 */
  update(sim: ExcavatorSim, tick: number): GateEvent | null {
    const p = sim.pose();
    const r = (p.wristR + p.tipR) / 2;
    const cx = p.baseX + p.fwdX * r;
    const cz = p.baseZ + p.fwdZ * r;
    let event: GateEvent | null = null;
    if (!Number.isNaN(this.prevX) && crosses(this.prevX, this.prevZ, cx, cz, this.gate)) {
      const span = bucketSpan(sim);
      if (span.low < this.gate.height) event = 'low';
      else if (this.gate.top !== undefined && span.high > this.gate.top) event = 'high';
      else event = 'pass';
      if (event === 'pass') this.passes++;
      else if (tick >= this.quietUntil) {
        // 같은 자리에서 떨다가 여러 번 세지 않게 1초 동안은 다시 세지 않는다
        this.hits++;
        this.quietUntil = tick + SIM_HZ;
      } else event = null;
    }
    this.prevX = cx;
    this.prevZ = cz;
    return event;
  }

  /** 접촉했을 때 띄울 알림 */
  message(event: 'low' | 'high'): string {
    const g = this.gate;
    return event === 'low'
      ? `아래 줄에 버킷이 닿았습니다 (${this.hits}회). 버킷 바닥을 줄(${g.height.toFixed(1)}m)보다 높이 들고 선회하세요`
      : `버킷이 위쪽 통과 제한선(${(g.top ?? 0).toFixed(1)}m)을 넘었습니다 (${this.hits}회). 줄과 제한선 사이 높이로 낮춰 선회하세요`;
  }
}
