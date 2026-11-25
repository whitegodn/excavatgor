import type { LeverPattern } from '../../core/input/levers';
import { type Command, SIM_HZ } from '../../core/sim/command';
import type { ExcavatorSim } from '../../equipment/excavator/excavatorSim';
import { type Metrics, Objective, type ProgressLine } from '../task';

/** 이 횟수만큼 버킷이 트럭에 닿으면 실격 */
const TRUCK_HIT_FAIL = 3;
/** 버킷을 다 펴려면 버킷 핀이 적재함 벽보다 이만큼 높아야 한다 (단계 안내와 같은 값) */
export const TRUCK_CLEARANCE = 1.6;

/**
 * 덤프트럭 적재함에 정해진 양의 흙을 싣는 과제.
 * 트럭은 단단해서, 버킷이 적재함 벽보다 낮은 채로 트럭 쪽으로 가면 벽에 막힌다. 그것을 "트럭 접촉"으로 센다.
 */
export class TruckObjective extends Objective {
  hits = 0;
  /** 버킷이 트럭에 닿아 있는 중인가. 떼었다가 다시 닿아야 새로 센다 */
  private touching = false;
  private clearTicks = 0;

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
      if (sim.truckBlocked) {
        this.clearTicks = 0;
        if (!this.touching) {
          this.touching = true;
          this.hits++;
          this.say(
            `버킷이 트럭 적재함에 부딪혀 막혔습니다 (${this.hits}회). 붐을 올려 버킷을 적재함 벽(${truck.bedTop}m)보다 높이 드세요`,
            'warn',
          );
          if (this.hits >= TRUCK_HIT_FAIL) {
            this.fatal = `버킷이 트럭에 ${TRUCK_HIT_FAIL}번 부딪혔습니다`;
            this.done = true;
          }
        }
      } else if (this.touching && ++this.clearTicks > SIM_HZ) {
        // 1초 넘게 밀지 않아야 접촉이 끝난 것으로 본다
        this.touching = false;
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
    const truck = sim.site.truck;
    const p = sim.pose();
    const pin = p.baseY + p.wristY;
    const need = (truck?.bedTop ?? 0) + TRUCK_CLEARANCE;
    return [
      { label: '실은 흙', value: `${sim.truckLoad.toFixed(2)} / ${this.target.toFixed(1)} m³` },
      {
        label: `버킷 높이 (선회는 ${need.toFixed(1)}m부터)`,
        value: `${pin.toFixed(2)} m`,
        tone: pin >= need ? 'good' : sim.load > 0.25 * sim.spec.bucketCapacity ? 'warn' : undefined,
      },
      { label: '트럭 접촉', value: `${this.hits} 회`, tone: this.hits > 0 ? 'warn' : undefined },
    ];
  }

  metrics(sim: ExcavatorSim): Metrics {
    return {
      loaded: sim.truckLoad,
      target: this.target,
      spilled: sim.spilled,
      returned: sim.returned,
      outside: sim.capturedOutside,
      time: this.time,
      hits: this.hits,
      belt: this.beltViolations,
    };
  }
}
