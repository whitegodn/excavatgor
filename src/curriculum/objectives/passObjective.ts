import { keyFor, type LeverPattern } from '../../core/input/levers';
import type { Command } from '../../core/sim/command';
import { DEG, wrapAngle } from '../../core/sim/math';
import type { ExcavatorSim } from '../../equipment/excavator/excavatorSim';
import { type Marker, type Metrics, Objective, type ProgressLine } from '../task';
import { bucketSpan, GateWatch, type Hurdle } from './gate';

const k = (name: string) => `<kbd>${name}</kbd>`;

/**
 * 버킷 통과 구역 높이 연습: 버킷을 아래 줄과 위쪽 제한선 사이 높이에 맞춰
 * 선회로 통과 구역을 정해진 횟수만큼 왔다 갔다 한다. 흙은 파지 않는다.
 */
export class PassObjective extends Objective {
  readonly watch: GateWatch;

  constructor(
    readonly gate: Hurdle,
    /** 깨끗하게 지나가야 하는 횟수 */
    readonly target: number,
    timeLimit: number | null,
  ) {
    super(timeLimit);
    this.watch = new GateWatch(gate);
  }

  protected step(sim: ExcavatorSim, _cmd: Command): void {
    const event = this.watch.update(sim, this.ticks);
    if (event === 'pass') {
      if (this.watch.passes >= this.target) {
        this.done = true;
        this.say(`통과 구역을 ${this.target}번 지나갔습니다`);
      } else this.say(`통과 ${this.watch.passes}/${this.target}`);
    } else if (event) this.say(this.watch.message(event), 'warn');
  }

  goal(sim: ExcavatorSim, pattern: LeverPattern): string | null {
    if (this.done) return this.timedOut ? '제한 시간이 끝났습니다' : '연습 완료';
    const g = this.gate;
    const top = g.top ?? Number.POSITIVE_INFINITY;
    const span = bucketSpan(sim);
    const count = `통과 ${this.watch.passes}/${this.target}`;
    const now = `지금 버킷: 바닥 ${span.low.toFixed(1)}m, 위쪽 ${span.high.toFixed(1)}m · 지나갈 높이: ${g.height.toFixed(1)}m ~ ${top.toFixed(1)}m`;
    const key = (fn: Parameters<typeof keyFor>[0]) => k(keyFor(fn, pattern));
    if (span.low < g.height + 0.1) {
      return `붐을 올려(${key('boomUp')}) 버킷 바닥을 줄보다 높이 드세요<small>${now} · ${count}</small>`;
    }
    if (span.high > top - 0.1) {
      return `붐을 내려(${key('boomDown')}) 버킷 위쪽을 제한선보다 낮추세요<small>${now} · 버킷을 오므리면 위아래 폭이 달라집니다 · ${count}</small>`;
    }
    // 버킷이 두 기둥 사이의 거리에 있어야 통과 구역을 지나간다
    const p = sim.pose();
    const r = (p.wristR + p.tipR) / 2;
    const near = Math.hypot(g.x1 - sim.x, g.z1 - sim.z);
    const far = Math.hypot(g.x2 - sim.x, g.z2 - sim.z);
    if (r < Math.min(near, far) + 0.3) {
      return `암을 펴서(${key('armOut')}) 버킷을 두 기둥 사이 거리로 보내세요<small>${now} · ${count}</small>`;
    }
    // 통과 구역이 있는 방향을 기준으로 버킷이 어느 쪽에 있는지 보고 선회 방향을 정한다
    const mid = Math.atan2((g.x1 + g.x2) / 2 - sim.x, (g.z1 + g.z2) / 2 - sim.z);
    const off = wrapAngle(sim.heading + sim.swing - mid) / DEG;
    const dir = off > 0 ? `왼쪽으로 선회해(${key('swingL')})` : `오른쪽으로 선회해(${key('swingR')})`;
    return `높이가 맞습니다. ${dir} 통과 구역을 지나가세요<small>${now} · 선회하는 동안 높이가 변하지 않게 다른 레버는 놓으세요 · ${count}</small>`;
  }

  brief(_sim: ExcavatorSim): string {
    const g = this.gate;
    return `버킷을 줄(${g.height.toFixed(1)}m)과 제한선(${(g.top ?? 0).toFixed(1)}m) 사이 높이로 통과 구역을 지나가세요 (${this.watch.passes}/${this.target})`;
  }

  lines(sim: ExcavatorSim): ProgressLine[] {
    const g = this.gate;
    const span = bucketSpan(sim);
    return [
      { label: '깨끗한 통과', value: `${this.watch.passes} / ${this.target}` },
      {
        label: `버킷 바닥 (줄 ${g.height.toFixed(1)}m)`,
        value: `${span.low.toFixed(2)} m`,
        tone: span.low < g.height ? 'warn' : 'good',
      },
      ...(g.top !== undefined
        ? [
            {
              label: `버킷 위쪽 (제한선 ${g.top.toFixed(1)}m)`,
              value: `${span.high.toFixed(2)} m`,
              tone: span.high > g.top ? ('warn' as const) : ('good' as const),
            },
          ]
        : []),
      { label: '접촉', value: `${this.watch.hits} 회`, tone: this.watch.hits > 0 ? 'warn' : undefined },
    ];
  }

  markers(_sim: ExcavatorSim): Marker[] {
    return [{ kind: 'bar', ...this.gate }];
  }

  metrics(_sim: ExcavatorSim): Metrics {
    return {
      passes: Math.min(this.watch.passes, this.target),
      target: this.target,
      hits: this.watch.hits,
      time: this.time,
      belt: this.beltViolations,
    };
  }
}
