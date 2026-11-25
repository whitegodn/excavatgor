import type { LeverPattern } from '../../core/input/levers';
import { type Command, SIM_HZ } from '../../core/sim/command';
import { DEG, wrapAngle } from '../../core/sim/math';
import type { ExcavatorSim } from '../../equipment/excavator/excavatorSim';
import { type Marker, type Metrics, Objective, type ProgressLine } from '../task';

export interface Checkpoint {
  x: number;
  z: number;
}

export interface DriveOptions {
  /** 도로 코스: 이 폭(중심에서 m)을 벗어나 달린 시간을 잰다 */
  roadHalfWidth?: number;
  /** 언덕 코스: 비탈을 비스듬히 타면 알려 준다 */
  slopes?: boolean;
}

const k = (name: string) => `<kbd>${name}</kbd>`;
/** 좌우 기울기가 이보다 크면 "비스듬히 탄다"고 본다 (약 11°) */
const STEEP_ROLL = 0.2;

function distToSegment(px: number, pz: number, a: Checkpoint, b: Checkpoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
}

/**
 * 깃발(노란 공)을 차례로 지나가는 주행 과제.
 * 버킷을 땅에 끌면서 주행하면 감점이다. 주행 전에 버킷을 들어야 한다.
 */
export class DriveObjective extends Objective {
  index = 0;
  drags = 0;
  /** 도로를 벗어나 달린 시간(틱) */
  offRoadTicks = 0;
  private dragging = false;
  private liftedTicks = 0;
  private offRoad = false;
  private steepTicks = 0;
  private steepQuietUntil = 0;
  private path: Checkpoint[] | null = null;

  constructor(
    readonly checkpoints: readonly Checkpoint[],
    readonly radius: number,
    timeLimit: number | null,
    readonly options: DriveOptions = {},
  ) {
    super(timeLimit);
  }

  /** 도로를 벗어나 달린 시간(초) */
  get offRoadSeconds(): number {
    return this.offRoadTicks / SIM_HZ;
  }

  private next(): Checkpoint {
    return this.checkpoints[Math.min(this.index, this.checkpoints.length - 1)];
  }

  private distance(sim: ExcavatorSim): number {
    const c = this.next();
    return Math.hypot(c.x - sim.x, c.z - sim.z);
  }

  protected step(sim: ExcavatorSim, cmd: Command): void {
    const moving = Math.abs(sim.trackL) + Math.abs(sim.trackR) > 0.1 || Math.abs(cmd.travelL) + Math.abs(cmd.travelR) > 0.3;
    // 버킷 끌림은 한 번 닿아서 1초 넘게 뗄 때까지를 1회로 센다 (울퉁불퉁한 땅에서 여러 번 세지 않게)
    if (moving && sim.burial > 0.03) {
      this.liftedTicks = 0;
      if (!this.dragging) {
        this.dragging = true;
        this.drags++;
        this.say('버킷을 땅에 끌면서 주행했습니다 (감점). 붐을 올려 버킷을 든 뒤 주행하세요', 'warn');
      }
    } else if (this.dragging && sim.burial < 0.01 && ++this.liftedTicks > SIM_HZ) {
      this.dragging = false;
    }
    if (this.options.roadHalfWidth !== undefined && moving) {
      this.path ??= [{ x: sim.site.start.x, z: sim.site.start.z }, ...this.checkpoints];
      let d = Number.POSITIVE_INFINITY;
      for (let i = 0; i + 1 < this.path.length; i++) d = Math.min(d, distToSegment(sim.x, sim.z, this.path[i], this.path[i + 1]));
      const off = d > this.options.roadHalfWidth;
      if (off) this.offRoadTicks++;
      if (off && !this.offRoad) this.say('도로를 벗어났습니다 (벗어나 달린 시간만큼 감점). 아스팔트 위로 돌아가세요', 'warn');
      this.offRoad = off;
    }
    if (this.options.slopes) {
      if (moving && Math.abs(sim.roll) > STEEP_ROLL) this.steepTicks++;
      else this.steepTicks = 0;
      if (this.steepTicks > 1.5 * SIM_HZ && this.ticks >= this.steepQuietUntil) {
        this.steepQuietUntil = this.ticks + 20 * SIM_HZ;
        this.say('비탈을 비스듬히 타고 있어 아래쪽으로 미끄러집니다. 가파른 곳은 정면으로 오르내리세요', 'warn');
      }
    }
    if (this.distance(sim) <= this.radius) {
      this.index++;
      if (this.index >= this.checkpoints.length) {
        this.done = true;
        this.say('모든 깃발을 지났습니다');
      } else {
        this.say(`깃발 ${this.index}/${this.checkpoints.length} 통과`);
      }
    }
  }

  goal(sim: ExcavatorSim, _pattern: LeverPattern): string | null {
    if (this.done) return this.timedOut ? '제한 시간이 끝났습니다' : '코스 완주';
    const c = this.next();
    const turn = wrapAngle(Math.atan2(c.x - sim.x, c.z - sim.z) - sim.heading) / DEG;
    const way =
      Math.abs(turn) < 8
        ? `정면 ${k('↑')}`
        : `${turn < 0 ? '왼쪽' : '오른쪽'}으로 ${Math.abs(turn).toFixed(0)}° ${turn < 0 ? k('←') : k('→')}`;
    return `깃발 ${this.index + 1}/${this.checkpoints.length}: ${this.distance(sim).toFixed(0)}m 앞 · ${way}<small>${k('↑')} 전진, ${k('←')}${k('→')} 제자리 회전, ${k('↑')}+${k('←')} 돌면서 전진 · ${k('Q')} 고속 단 · 버킷은 들고 주행하세요</small>`;
  }

  brief(_sim: ExcavatorSim): string {
    return `깃발(노란 공)을 차례로 지나가세요 (${Math.min(this.index + 1, this.checkpoints.length)}/${this.checkpoints.length})`;
  }

  lines(sim: ExcavatorSim): ProgressLine[] {
    return [
      { label: '지난 깃발', value: `${this.index} / ${this.checkpoints.length}` },
      { label: '다음 깃발까지', value: this.done ? '—' : `${this.distance(sim).toFixed(1)} m` },
      { label: '버킷 끌림', value: `${this.drags} 회`, tone: this.drags > 0 ? 'warn' : undefined },
      ...(this.options.roadHalfWidth !== undefined
        ? [{ label: '도로 이탈', value: `${this.offRoadSeconds.toFixed(0)} 초`, tone: this.offRoad ? ('warn' as const) : undefined }]
        : []),
    ];
  }

  markers(sim: ExcavatorSim): Marker[] {
    return this.checkpoints.map((c, i) => ({
      kind: 'target' as const,
      x: c.x,
      y: sim.terrain.heightAt(c.x, c.z) + 1.6,
      z: c.z,
      radius: 1.1,
      state: i < this.index ? ('done' as const) : i === this.index ? ('active' as const) : ('todo' as const),
    }));
  }

  focus() {
    if (this.done) return null;
    const c = this.next();
    return { x: c.x, y: 1.6, z: c.z, radius: 1.1 };
  }

  metrics(_sim: ExcavatorSim): Metrics {
    return {
      completed: this.index,
      total: this.checkpoints.length,
      time: this.time,
      drags: this.drags,
      offRoad: this.offRoadSeconds,
      belt: this.beltViolations,
    };
  }
}
