import type { LeverPattern } from '../../core/input/levers';
import { type Command, SIM_HZ } from '../../core/sim/command';
import type { ExcavatorSim } from '../../equipment/excavator/excavatorSim';
import { type Metrics, Objective, type ProgressLine } from '../task';

/** 이 횟수만큼 버킷이 트럭에 닿으면 실격 */
const TRUCK_HIT_FAIL = 3;

/**
 * 덤프트럭 적재함에 정해진 양의 흙을 싣는 과제.
 * 적재함 벽보다 낮은 높이로 버킷을 트럭 위에 넣으면 "트럭 접촉"으로 센다.
 */
export class TruckObjective extends Objective {
  hits = 0;
  private quietUntil = 0;

  constructor(
    /** 실어야 하는 양(m³) */
    readonly target: number,
    timeLimit: number | null,
  ) {
    super(timeLimit);
  }

  protected step(sim: ExcavatorSim, _cmd: Command): void {
    const truck = sim.site.truck;
    if (truck) {
      const p = sim.pose();
      const zn = sim.site.dumpZone;
      const low = p.baseY + Math.min(p.tipY, p.wristY) - 0.15;
      for (const r of [p.wristR, p.tipR]) {
        const x = p.baseX + p.fwdX * r;
        const z = p.baseZ + p.fwdZ * r;
        const over = x > zn.x0 - 0.2 && x < zn.x1 + 0.2 && z > zn.z0 - 0.2 && z < zn.z1 + 0.2;
        if (over && low < truck.bedTop && this.ticks >= this.quietUntil) {
          this.hits++;
          this.quietUntil = this.ticks + 2 * SIM_HZ;
          this.say(`버킷이 트럭 적재함에 부딪혔습니다 (${this.hits}회). 적재함보다 높이 든 뒤 트럭 위로 가세요`, 'warn');
          if (this.hits >= TRUCK_HIT_FAIL) {
            this.fatal = `버킷이 트럭에 ${TRUCK_HIT_FAIL}번 부딪혔습니다`;
            this.done = true;
          }
        }
      }
    }
    if (sim.truckLoad >= this.target) {
      this.done = true;
      this.say(`트럭에 ${sim.truckLoad.toFixed(2)}m³를 실었습니다`);
    }
  }

  goal(_sim: ExcavatorSim, _pattern: LeverPattern): string | null {
    // 굴착과 쏟기는 일반 굴착 안내(①~⑦)를 그대로 쓴다
    return null;
  }

  brief(sim: ExcavatorSim): string {
    return `노란 구역의 흙을 파서 덤프트럭에 실으세요 (${sim.truckLoad.toFixed(2)} / ${this.target.toFixed(1)}m³). 적재함보다 높이 들고 쏟으세요.`;
  }

  lines(sim: ExcavatorSim): ProgressLine[] {
    return [
      { label: '트럭에 실은 흙', value: `${sim.truckLoad.toFixed(2)} / ${this.target.toFixed(1)} m³` },
      { label: '트럭 접촉', value: `${this.hits} 회`, tone: this.hits > 0 ? 'warn' : undefined },
    ];
  }

  metrics(sim: ExcavatorSim): Metrics {
    return {
      loaded: sim.truckLoad,
      target: this.target,
      spilled: sim.spilled,
      returned: sim.returned,
      time: this.time,
      hits: this.hits,
      belt: this.beltViolations,
    };
  }
}
