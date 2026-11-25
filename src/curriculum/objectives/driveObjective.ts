import type { LeverPattern } from '../../core/input/levers';
import type { Command } from '../../core/sim/command';
import { DEG, wrapAngle } from '../../core/sim/math';
import type { ExcavatorSim } from '../../equipment/excavator/excavatorSim';
import { type Marker, type Metrics, Objective, type ProgressLine } from '../task';

export interface Checkpoint {
  x: number;
  z: number;
}

const k = (name: string) => `<kbd>${name}</kbd>`;

/**
 * 깃발(노란 공)을 차례로 지나가는 주행 과제.
 * 버킷을 땅에 끌면서 주행하면 감점이다. 주행 전에 버킷을 들어야 한다.
 */
export class DriveObjective extends Objective {
  index = 0;
  drags = 0;
  private wasDragging = false;

  constructor(
    readonly checkpoints: readonly Checkpoint[],
    readonly radius: number,
    timeLimit: number | null,
  ) {
    super(timeLimit);
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
    const dragging = moving && sim.burial > 0.03;
    if (dragging && !this.wasDragging) {
      this.drags++;
      this.say('버킷을 땅에 끌면서 주행했습니다 (감점). 붐을 올려 버킷을 든 뒤 주행하세요', 'warn');
    }
    this.wasDragging = dragging;
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
    return `깃발 ${this.index + 1}/${this.checkpoints.length}: 노란 공까지 ${this.distance(sim).toFixed(0)}m · ${way}<small>${k('↑')} 전진, ${k('←')}${k('→')} 제자리 회전, ${k('↑')}+${k('←')} 돌면서 전진 · ${k('Q')} 고속 단 · 버킷은 들고 주행하세요</small>`;
  }

  brief(_sim: ExcavatorSim): string {
    return `노란 공(깃발)을 차례로 지나가세요 (${Math.min(this.index + 1, this.checkpoints.length)}/${this.checkpoints.length})`;
  }

  lines(sim: ExcavatorSim): ProgressLine[] {
    return [
      { label: '지난 깃발', value: `${this.index} / ${this.checkpoints.length}` },
      { label: '다음 깃발까지', value: this.done ? '—' : `${this.distance(sim).toFixed(1)} m` },
      { label: '버킷 끌림', value: `${this.drags} 회`, tone: this.drags > 0 ? 'warn' : undefined },
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
      belt: this.beltViolations,
    };
  }
}
