import type { LeverPattern } from '../../core/input/levers';
import { type Command, SIM_HZ } from '../../core/sim/command';
import type { ExcavatorSim } from '../../equipment/excavator/excavatorSim';
import { type Marker, type Metrics, Objective, type ProgressLine } from '../task';

/** 선회 경로에 가로놓인 장애물(두 기둥 사이의 줄). 버킷이 이 높이 위로 넘어가야 한다. */
export interface Hurdle {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number;
}

/** 이 횟수만큼 장애물에 닿으면 실격 (임시 기준) */
const HURDLE_FAIL = 3;

function crosses(ax: number, az: number, bx: number, bz: number, h: Hurdle): boolean {
  const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
    (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = side(h.x1, h.z1, h.x2, h.z2, ax, az);
  const d2 = side(h.x1, h.z1, h.x2, h.z2, bx, bz);
  const d3 = side(ax, az, bx, bz, h.x1, h.z1);
  const d4 = side(ax, az, bx, bz, h.x2, h.z2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * 굴착 → 선회 → 쏟기 사이클을 정해진 횟수만큼 하는 과제.
 * 사이클 인정 여부는 시뮬레이션의 판정(굴착 구역의 흙, 덤프 구역에 쏟기, 복귀)을 그대로 쓴다.
 */
export class CycleObjective extends Objective {
  hurdleHits = 0;
  private prevX = Number.NaN;
  private prevZ = Number.NaN;
  private quietUntil = 0;

  constructor(
    readonly cycles: number,
    timeLimit: number | null,
    readonly hurdle: Hurdle | null = null,
  ) {
    super(timeLimit);
  }

  protected step(sim: ExcavatorSim, _cmd: Command): void {
    if (this.hurdle) {
      const p = sim.pose();
      // 버킷 가운데가 줄을 가로지르는 순간, 버킷의 가장 낮은 곳이 줄보다 낮으면 닿은 것이다
      const r = (p.wristR + p.tipR) / 2;
      const cx = p.baseX + p.fwdX * r;
      const cz = p.baseZ + p.fwdZ * r;
      const low = p.baseY + Math.min(p.tipY, p.wristY) - 0.15;
      if (!Number.isNaN(this.prevX) && crosses(this.prevX, this.prevZ, cx, cz, this.hurdle)) {
        if (low < this.hurdle.height && this.ticks >= this.quietUntil) {
          this.hurdleHits++;
          this.quietUntil = this.ticks + SIM_HZ;
          this.say(`장애물 줄에 버킷이 닿았습니다 (${this.hurdleHits}회). 줄보다 높이 들고 선회하세요`, 'warn');
          if (this.hurdleHits >= HURDLE_FAIL) {
            this.fatal = `장애물에 ${HURDLE_FAIL}번 닿았습니다`;
            this.done = true;
          }
        }
      }
      this.prevX = cx;
      this.prevZ = cz;
    }
    if (sim.cycles >= this.cycles) {
      this.done = true;
      this.say(`${this.cycles}사이클을 모두 마쳤습니다`);
    }
  }

  goal(_sim: ExcavatorSim, _pattern: LeverPattern): string | null {
    // 굴착 사이클은 앱의 일반 굴착 안내(①~⑦)를 그대로 쓴다
    return null;
  }

  brief(sim: ExcavatorSim): string {
    const over = this.hurdle ? ' 선회할 때는 버킷을 장애물 줄보다 높이 드세요.' : '';
    return `노란 구역의 흙을 파서 파란 구역에 쏟으세요 (${Math.min(sim.cycles, this.cycles)}/${this.cycles}사이클).${over}`;
  }

  lines(sim: ExcavatorSim): ProgressLine[] {
    const lines: ProgressLine[] = [
      { label: '완료한 사이클', value: `${Math.min(sim.cycles, this.cycles)} / ${this.cycles}` },
    ];
    if (this.hurdle) {
      lines.push({
        label: '장애물 접촉',
        value: `${this.hurdleHits} 회`,
        tone: this.hurdleHits > 0 ? 'warn' : undefined,
      });
    }
    return lines;
  }

  markers(_sim: ExcavatorSim): Marker[] {
    return this.hurdle ? [{ kind: 'bar', ...this.hurdle }] : [];
  }

  metrics(sim: ExcavatorSim): Metrics {
    return {
      cycles: Math.min(sim.cycles, this.cycles),
      target: this.cycles,
      dumped: sim.dumped,
      spilled: sim.spilled,
      returned: sim.returned,
      time: this.time,
      hurdleHits: this.hurdleHits,
      belt: this.beltViolations,
    };
  }
}
