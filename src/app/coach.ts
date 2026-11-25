import type { LeverPattern } from '../core/input/levers';
import { type Command, SIM_HZ } from '../core/sim/command';
import type { CycleFault, ExcavatorSim } from '../equipment/excavator/excavatorSim';
import { bucketView, keyFor } from './guide';

export interface Notice {
  text: string;
  kind: 'warn' | 'good';
  /** 이 틱까지 보여 준다 */
  until: number;
}

const FAULT_TEXT: Record<Exclude<CycleFault, ''>, string> = {
  returned: '들어 올리다 흙을 거의 다 떨어뜨려 사이클로 세지 않았습니다. 버킷 입구가 위를 향할 때까지 오므린 뒤 올리세요',
  none: '파란 구역에 들어간 흙이 거의 없어 사이클로 세지 않았습니다',
  spill: '쏟은 흙의 40% 넘게 구역 밖에 떨어져 사이클로 세지 않았습니다',
  source: '노란 구역 밖에서 판 흙이라 사이클로 세지 않았습니다',
};

/**
 * 실수한 순간에 이유를 한 줄로 알려 주는 코치.
 * 시뮬레이션의 측정값이 어떻게 변했는지와 그때의 자세를 보고 판단한다.
 */
export class Coach {
  notice: Notice | null = null;
  private spilled = 0;
  private bySwing = 0;
  private returned = 0;
  private overflow = 0;
  private outside = 0;
  private reports = 0;
  private stuckTicks = 0;
  private readonly cooldown = new Map<string, number>();

  /** 새 훈련을 시작할 때 부른다 */
  reset(): void {
    this.notice = null;
    this.spilled = 0;
    this.bySwing = 0;
    this.returned = 0;
    this.overflow = 0;
    this.outside = 0;
    this.reports = 0;
    this.stuckTicks = 0;
    this.cooldown.clear();
  }

  /** 같은 알림은 quiet초 안에 다시 띄우지 않는다 */
  say(sim: ExcavatorSim, id: string, text: string, kind: Notice['kind'] = 'warn', seconds = 5, quiet = 2): void {
    const blockedUntil = this.cooldown.get(id) ?? -1;
    if (sim.tick < blockedUntil) return;
    this.cooldown.set(id, sim.tick + quiet * SIM_HZ);
    this.notice = { text, kind, until: sim.tick + seconds * SIM_HZ };
  }

  /** 매 틱, 시뮬레이션을 한 단계 진행한 뒤에 부른다 */
  update(sim: ExcavatorSim, cmd: Command, pattern: LeverPattern): void {
    const key = (fn: Parameters<typeof keyFor>[0]) => `[${keyFor(fn, pattern)}]`;
    const b = bucketView(sim);
    const opening = cmd.bucket < -0.05;

    if (sim.reportCount !== this.reports) {
      this.reports = sim.reportCount;
      const r = sim.lastCycle!;
      if (r.valid) {
        const parts = [
          `${r.time.toFixed(1)}초`,
          `덤프 ${r.dumped.toFixed(2)}m³`,
          `흘림 ${r.spilled.toFixed(2)}`,
          `도로 떨어뜨림 ${r.returned.toFixed(2)}`,
        ];
        if (r.leftover > 0.03) parts.push(`버킷에 남김 ${r.leftover.toFixed(2)} (다음엔 끝까지 펴서 다 쏟으세요)`);
        this.notice = { text: `사이클 ${sim.cycles} 완료 · ${parts.join(' · ')}`, kind: 'good', until: sim.tick + 8 * SIM_HZ };
      } else if (r.fault !== '') {
        this.notice = { text: FAULT_TEXT[r.fault], kind: 'warn', until: sim.tick + 7 * SIM_HZ };
      }
    }

    // 급선회로 흘림
    if (sim.spilledBySwing - this.bySwing > 0.01) {
      this.say(sim, 'swing', '선회를 급하게 꺾어 흙을 흘렸습니다. 반대 키로 멈추지 말고, 미리 놓아 천천히 멈추세요');
      this.spilled += sim.spilledBySwing - this.bySwing;
      this.bySwing = sim.spilledBySwing;
    }
    // 구역 밖에 쏟음 (땅을 파는 중에 넘친 흙은 쏟은 것이 아니다)
    if (sim.spilled - this.spilled > 0.03) {
      if (!b.touching) {
        this.say(sim, 'outside', '구역 밖에 흙을 쏟았습니다. 바닥의 원 표시가 파란 구역 안에 들어온 뒤 버킷을 펴세요');
      }
      this.spilled = sim.spilled;
    }
    // 노란 구역 밖의 흙을 담는 중
    if (sim.capturedOutside - this.outside > 0.05) {
      this.say(sim, 'source', '노란 구역 밖의 흙을 담고 있습니다. 노란 구역 안에서 파야 사이클로 셉니다');
      this.outside = sim.capturedOutside;
    }
    // 들다가 떨어뜨림: 버킷이 땅 위에 있고, 일부러 펴는 중이 아닐 때만
    if (sim.returned - this.returned > 0.05) {
      if (!b.touching && !opening) {
        this.say(
          sim,
          'returned',
          `버킷을 덜 오므린 채 들어 흙이 떨어졌습니다. 입구가 똑바로 위를 볼 때까지 오므리세요 ${key('curl')}`,
          'warn',
          5,
          1.2,
        );
      }
      this.returned = sim.returned;
    }
    if (sim.overflow - this.overflow > 0.12) {
      this.say(sim, 'overflow', `버킷이 이미 가득 찼습니다. 더 긁지 말고 오므려서 ${key('curl')} 들어 올리세요 ${key('boomUp')}`);
      this.overflow = sim.overflow;
    }

    // 흙에 막혀 움직이지 않는데 계속 밀고 있는 경우
    const active = cmd.engineOn && !cmd.locked;
    const onlyBoomDown = cmd.boom < 0 && cmd.arm === 0 && cmd.bucket === 0 && cmd.swing === 0;
    const pushing = cmd.arm !== 0 || cmd.boom < 0 || cmd.bucket !== 0 || cmd.swing !== 0;
    if (active && pushing && sim.digResist < 0.12) this.stuckTicks++;
    else this.stuckTicks = 0;
    if (this.stuckTicks > 0.6 * SIM_HZ) {
      this.stuckTicks = 0;
      if (b.fill > 0.6 && b.openUp > 40) {
        this.say(sim, 'lift', `흙을 담았습니다. 이제 붐을 올리세요 ${key('boomUp')}`, 'good');
      } else if (b.openUp > 40) {
        this.say(
          sim,
          'stuck',
          `버킷 등이 땅에 눌려 움직이지 않습니다. 붐을 올리고 ${key('boomUp')} 버킷을 펴서 ${key('open')} 날부터 넣으세요`,
        );
      } else if (b.openUp < -30) {
        this.say(
          sim,
          'stuck',
          `버킷이 엎어져 있어 흙이 담기지 않습니다. 붐을 올리고 ${key('boomUp')} 버킷 입구가 옆을 보게 맞추세요`,
        );
      } else if (onlyBoomDown) {
        this.say(sim, 'touch', `버킷 날이 땅에 들어갔습니다. 붐은 그만 내리고 암을 당기세요 ${key('armIn')}`, 'good');
      } else {
        this.say(sim, 'stuck', `버킷이 흙에 막혔습니다. 붐을 살짝 올리거나 ${key('boomUp')} 버킷을 오므리세요 ${key('curl')}`);
      }
    }

    if (this.notice && sim.tick > this.notice.until) this.notice = null;
  }
}
