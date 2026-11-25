import type { LeverPattern } from '../../core/input/levers';
import { type Command, SIM_HZ } from '../../core/sim/command';
import { DEG, wrapAngle } from '../../core/sim/math';
import type { ExcavatorSim } from '../../equipment/excavator/excavatorSim';
import { type Point3, tipPosition } from '../../equipment/excavator/kinematics';
import { type Marker, type Metrics, Objective, type ProgressLine } from '../task';

/** 목표 자세(도). 적지 않은 관절은 시작 자세 그대로다. */
export interface JointTarget {
  boom?: number;
  arm?: number;
  bucket?: number;
  swing?: number;
}

const HOLD_SECONDS = 0.6;

/**
 * 공중에 놓인 목표 지점에 버킷 날 끝을 차례로 가져다 대는 과제.
 * 목표는 "관절을 이 각도로 만들면 날 끝이 오는 자리"로 정하므로 항상 닿을 수 있다.
 */
export class TargetObjective extends Objective {
  readonly points: Point3[];
  index = 0;
  groundTouches = 0;
  private holdTicks = 0;
  private wasTouching = false;

  constructor(
    sim: ExcavatorSim,
    /** 목표 자세 목록. 자동 검사가 같은 값을 써서 과제를 풀어 본다 */
    readonly targets: readonly JointTarget[],
    readonly radius: number,
    /** 어떤 레버를 쓰면 되는지 알려 주는 말. 도움 없는 과제면 null */
    private readonly hint: ((pattern: LeverPattern) => string) | null,
    timeLimit: number | null,
  ) {
    super(timeLimit);
    const start = { boom: sim.boomAngle, arm: sim.armAngle, bucket: sim.bucketAngle, swing: sim.swing };
    const base = { x: sim.x, y: sim.y, z: sim.z, heading: sim.heading };
    this.points = targets.map((t) =>
      tipPosition(sim.spec, base, {
        boom: t.boom === undefined ? start.boom : t.boom * DEG,
        arm: t.arm === undefined ? start.arm : t.arm * DEG,
        bucket: t.bucket === undefined ? start.bucket : t.bucket * DEG,
        swing: t.swing === undefined ? start.swing : t.swing * DEG,
      }),
    );
  }

  private tip(sim: ExcavatorSim): Point3 {
    const p = sim.pose();
    return { x: p.baseX + p.fwdX * p.tipR, y: p.baseY + p.tipY, z: p.baseZ + p.fwdZ * p.tipR };
  }

  private distance(sim: ExcavatorSim): number {
    const t = this.tip(sim);
    const g = this.points[Math.min(this.index, this.points.length - 1)];
    return Math.hypot(t.x - g.x, t.y - g.y, t.z - g.z);
  }

  protected step(sim: ExcavatorSim, _cmd: Command): void {
    const tip = this.tip(sim);
    const touching = sim.burial > 0.03 || tip.y - sim.terrain.heightAt(tip.x, tip.z) < 0.03;
    if (touching && !this.wasTouching) {
      this.groundTouches++;
      this.say('버킷이 땅에 닿았습니다 (감점). 이 과제에서는 공중에서만 움직입니다', 'warn');
    }
    this.wasTouching = touching;

    if (this.distance(sim) <= this.radius) this.holdTicks++;
    else this.holdTicks = 0;
    if (this.holdTicks >= HOLD_SECONDS * SIM_HZ) {
      this.holdTicks = 0;
      this.index++;
      if (this.index >= this.points.length) {
        this.done = true;
        this.say('모든 목표를 통과했습니다');
      } else {
        this.say(`목표 ${this.index}/${this.points.length} 통과`);
      }
    }
  }

  /** 목표가 지금 날 끝에서 어느 쪽으로 얼마나 떨어져 있는지 말로 풀어 준다 */
  private directions(sim: ExcavatorSim): string {
    const g = this.points[this.index];
    const t = this.tip(sim);
    const parts: string[] = [];
    const bearing = (x: number, z: number) => Math.atan2(x - sim.x, z - sim.z);
    const turn = wrapAngle(bearing(g.x, g.z) - bearing(t.x, t.z)) / DEG;
    if (Math.abs(turn) > 1) parts.push(`${turn < 0 ? '왼쪽' : '오른쪽'}으로 ${Math.abs(turn).toFixed(0)}°`);
    const reach = Math.hypot(g.x - sim.x, g.z - sim.z) - Math.hypot(t.x - sim.x, t.z - sim.z);
    if (Math.abs(reach) > 0.05) parts.push(`${reach > 0 ? '멀리' : '가까이'} ${Math.abs(reach).toFixed(1)}m`);
    const up = g.y - t.y;
    if (Math.abs(up) > 0.05) parts.push(`${up > 0 ? '위로' : '아래로'} ${Math.abs(up).toFixed(1)}m`);
    return parts.length ? `날 끝에서 ${parts.join(', ')}` : '바로 앞';
  }

  goal(sim: ExcavatorSim, pattern: LeverPattern): string | null {
    if (this.done) return this.timedOut ? '제한 시간이 끝났습니다' : '과제 완료';
    const n = this.points.length;
    if (this.distance(sim) <= this.radius) {
      return `목표 ${this.index + 1}/${n}: 좋습니다. 그대로 잠깐 멈추세요<small>공 안에서 ${HOLD_SECONDS}초 머물면 통과합니다</small>`;
    }
    const hint = this.hint ? `${this.hint(pattern)} · ` : '';
    return `목표 ${this.index + 1}/${n}: 노란 공 안에 버킷 날 끝을 넣으세요<small>${hint}목표는 ${this.directions(sim)}</small>`;
  }

  brief(_sim: ExcavatorSim): string {
    return `노란 공 안에 버킷 날 끝을 차례로 넣으세요 (${Math.min(this.index + 1, this.points.length)}/${this.points.length})`;
  }

  lines(sim: ExcavatorSim): ProgressLine[] {
    const lines: ProgressLine[] = [
      { label: '통과한 목표', value: `${this.index} / ${this.points.length}` },
      { label: '목표까지 거리', value: this.done ? '—' : `${this.distance(sim).toFixed(2)} m` },
    ];
    lines.push({
      label: '땅에 닿은 횟수',
      value: `${this.groundTouches} 회`,
      tone: this.groundTouches > 0 ? 'warn' : undefined,
    });
    return lines;
  }

  markers(_sim: ExcavatorSim): Marker[] {
    return this.points.map((pt, i) => ({
      kind: 'target' as const,
      x: pt.x,
      y: pt.y,
      z: pt.z,
      radius: this.radius,
      state: i < this.index ? ('done' as const) : i === this.index ? ('active' as const) : ('todo' as const),
    }));
  }

  focus() {
    if (this.done) return null;
    const g = this.points[this.index];
    return { x: g.x, y: g.y, z: g.z, radius: this.radius };
  }

  metrics(_sim: ExcavatorSim): Metrics {
    return {
      completed: this.index,
      total: this.points.length,
      time: this.time,
      groundTouches: this.groundTouches,
      belt: this.beltViolations,
    };
  }
}
