import type { LeverPattern } from '../../core/input/levers';
import type { Command } from '../../core/sim/command';
import type { CycleReport, ExcavatorSim } from '../../equipment/excavator/excavatorSim';
import { type Marker, type Metrics, Objective, type ProgressLine } from '../task';
import { bucketSpan, GateWatch, type Hurdle } from './gate';

export type { Hurdle } from './gate';

/** 이 횟수만큼 통과 구역의 줄이나 제한선에 닿으면 실격 (임시 기준) */
const HURDLE_FAIL = 3;

/**
 * 굴착 → 선회 → 쏟기 사이클을 정해진 횟수만큼 하는 과제.
 * 사이클 인정 여부는 시뮬레이션의 판정(굴착 구역의 흙, 덤프 구역에 쏟기, 복귀)을 그대로 쓴다.
 * hurdle을 주면 선회할 때 버킷이 통과 구역(아래 줄과 위쪽 제한선 사이)을 지나가야 한다.
 */
export class CycleObjective extends Objective {
  /** 사이클마다의 결과(인정된 것과 세지 않은 것 모두). 결과 화면에 보여 준다 */
  readonly reports: CycleReport[] = [];
  private seenReports = 0;
  private readonly watch: GateWatch | null;

  constructor(
    readonly cycles: number,
    timeLimit: number | null,
    readonly hurdle: Hurdle | null = null,
  ) {
    super(timeLimit);
    this.watch = hurdle ? new GateWatch(hurdle) : null;
  }

  /** 통과 구역의 줄이나 제한선에 닿은 횟수 */
  get hurdleHits(): number {
    return this.watch?.hits ?? 0;
  }

  protected step(sim: ExcavatorSim, _cmd: Command): void {
    if (sim.reportCount !== this.seenReports) {
      this.seenReports = sim.reportCount;
      if (sim.lastCycle) this.reports.push({ ...sim.lastCycle });
    }
    if (this.watch) {
      const event = this.watch.update(sim, this.ticks);
      if (event === 'low' || event === 'high') {
        this.say(this.watch.message(event), 'warn');
        if (this.watch.hits >= HURDLE_FAIL) {
          this.fatal = `통과 구역의 줄이나 제한선에 ${HURDLE_FAIL}번 닿았습니다`;
          this.done = true;
        }
      }
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
    const h = this.hurdle;
    const over = !h
      ? ''
      : h.top === undefined
        ? ' 선회할 때는 버킷을 장애물 줄보다 높이 드세요.'
        : ` 선회할 때는 버킷을 줄(${h.height.toFixed(1)}m)과 제한선(${h.top.toFixed(1)}m) 사이 높이로 지나가세요.`;
    return `노란 구역의 흙을 파서 파란 구역에 쏟으세요 (${Math.min(sim.cycles, this.cycles)}/${this.cycles}사이클).${over}`;
  }

  lines(sim: ExcavatorSim): ProgressLine[] {
    const lines: ProgressLine[] = [
      { label: '완료한 사이클', value: `${Math.min(sim.cycles, this.cycles)} / ${this.cycles}` },
    ];
    const h = this.hurdle;
    if (h) {
      const span = bucketSpan(sim);
      lines.push({
        label: `버킷 바닥 높이 (줄 ${h.height.toFixed(1)}m)`,
        value: `${span.low.toFixed(2)} m`,
        tone: span.low < h.height ? 'warn' : 'good',
      });
      if (h.top !== undefined) {
        lines.push({
          label: `버킷 위쪽 높이 (제한선 ${h.top.toFixed(1)}m)`,
          value: `${span.high.toFixed(2)} m`,
          tone: span.high > h.top ? 'warn' : 'good',
        });
      }
      lines.push({
        label: '통과 구역 접촉',
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
      // 사이클로 인정된 흙만 작업량으로 친다
      dumped: this.reports.filter((r) => r.valid).reduce((sum, r) => sum + r.dumped, 0),
      uncounted: this.reports.filter((r) => !r.valid).length,
      spilled: sim.spilled,
      returned: sim.returned,
      time: this.time,
      hurdleHits: this.hurdleHits,
      belt: this.beltViolations,
    };
  }
}
