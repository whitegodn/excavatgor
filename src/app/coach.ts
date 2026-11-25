import type { LeverPattern } from '../core/input/levers';
import { type Command, SIM_HZ } from '../core/sim/command';
import { DEG } from '../core/sim/math';
import type { CycleFault, ExcavatorSim } from '../equipment/excavator/excavatorSim';
import { bucketView, keyFor } from './guide';

export interface Notice {
  text: string;
  kind: 'warn' | 'good';
  /** 이 틱까지 보여 준다 */
  until: number;
}

const FAULT_TEXT: Record<Exclude<CycleFault, ''>, string> = {
  returned: '담은 흙을 노란 구역에 거의 다 도로 떨어뜨려 사이클로 세지 않았습니다',
  none: '파란 구역에 들어간 흙이 거의 없어 사이클로 세지 않았습니다',
  spill: '쏟은 흙의 40% 넘게 구역 밖에 떨어져 사이클로 세지 않았습니다',
  source: '노란 구역 밖에서 판 흙이라 사이클로 세지 않았습니다',
};

/**
 * 실수한 순간에 이유를 한 줄로 알려 주는 코치.
 * 시뮬레이션의 측정값이 어떻게 변했는지와 그때의 자세·누른 레버를 보고 판단한다.
 */
export class Coach {
  notice: Notice | null = null;
  /** true면 화면에 띄우지 않고 기록만 한다 (도움 없는 시험 방식 과제) */
  muted = false;
  /** 이번 과제에서 나온 실수 알림과 횟수. 결과 화면에 보여 준다 */
  readonly log = new Map<string, number>();
  private spilled = 0;
  private bySwing = 0;
  private byTravel = 0;
  private truckAt = 0;
  private spillAt = 0;
  private returnAt = 0;
  private returned = 0;
  private overflow = 0;
  private outside = 0;
  private reports = 0;
  private stuckTicks = 0;
  private wasTouching = false;
  private readonly cooldown = new Map<string, number>();

  /** 새 훈련을 시작할 때 부른다 */
  reset(): void {
    this.notice = null;
    this.spilled = 0;
    this.bySwing = 0;
    this.byTravel = 0;
    this.truckAt = 0;
    this.spillAt = 0;
    this.returnAt = 0;
    this.returned = 0;
    this.overflow = 0;
    this.outside = 0;
    this.reports = 0;
    this.stuckTicks = 0;
    this.wasTouching = false;
    this.cooldown.clear();
    this.log.clear();
    this.muted = false;
  }

  private announce(sim: ExcavatorSim, text: string, kind: Notice['kind'], seconds: number, force = false): void {
    if (kind === 'warn') this.log.set(text, (this.log.get(text) ?? 0) + 1);
    if (this.muted && !force) return;
    this.notice = { text, kind, until: sim.tick + seconds * SIM_HZ };
  }

  /** 같은 알림은 quiet초 안에 다시 띄우지 않는다 */
  say(sim: ExcavatorSim, id: string, text: string, kind: Notice['kind'] = 'warn', seconds = 5, quiet = 2): void {
    const blockedUntil = this.cooldown.get(id) ?? -1;
    if (sim.tick < blockedUntil) return;
    this.cooldown.set(id, sim.tick + quiet * SIM_HZ);
    this.announce(sim, text, kind, seconds);
  }

  /** 과제 심판이 보낸 알림을 그대로 띄운다 */
  push(sim: ExcavatorSim, text: string, kind: Notice['kind'], seconds = 5): void {
    this.announce(sim, text, kind, seconds, true);
  }

  /** 코치가 말하지 않는 과제에서도 지난 알림은 지운다 */
  expire(sim: ExcavatorSim): void {
    if (this.notice && sim.tick > this.notice.until) this.notice = null;
  }

  /** 매 틱, 시뮬레이션을 한 단계 진행한 뒤에 부른다 */
  update(sim: ExcavatorSim, cmd: Command, pattern: LeverPattern): void {
    const key = (fn: Parameters<typeof keyFor>[0]) => `[${keyFor(fn, pattern)}]`;
    const b = bucketView(sim);
    const opening = cmd.bucket < -0.05;
    const anyLever =
      Math.abs(cmd.arm) + Math.abs(cmd.boom) + Math.abs(cmd.bucket) + Math.abs(cmd.swing) > 0.3 ||
      Math.abs(cmd.travelL) + Math.abs(cmd.travelR) > 0.3;
    const active = cmd.engineOn && !cmd.locked;
    // 덤프트럭 현장에서는 쏟을 곳이 파란 구역이 아니라 트럭 적재함이다
    const truck = sim.site.truck ?? null;

    // 장비가 꺼져 있거나 잠겨 있는데 레버를 움직이는 경우
    if (!active && anyLever) {
      this.say(
        sim,
        'locked',
        cmd.engineOn
          ? '안전레버가 잠겨 있어 레버가 듣지 않습니다. F 키로 해제하세요'
          : '시동이 꺼져 있습니다. R 키로 시동을 거세요',
        'warn',
        4,
        3,
      );
    }

    if (sim.reportCount !== this.reports) {
      this.reports = sim.reportCount;
      const r = sim.lastCycle!;
      if (truck) {
        // 상차에서는 사이클 인정 여부를 따지지 않는다. 버킷 한 번의 결과는 아래에서 따로 알려 준다
      } else if (r.valid) {
        const parts = [
          `${r.time.toFixed(1)}초`,
          `쏟음 ${r.dumped.toFixed(2)}m³`,
          `구역 밖 흘림 ${r.spilled.toFixed(2)}`,
          `들다가 떨어뜨림 ${r.returned.toFixed(2)}`,
        ];
        if (r.leftover > 0.03) parts.push(`버킷에 남김 ${r.leftover.toFixed(2)} (다음엔 끝까지 펴서 다 쏟으세요)`);
        this.announce(sim, `사이클 ${sim.cycles} 완료 · ${parts.join(' · ')}`, 'good', 8);
      } else if (r.fault !== '') {
        this.announce(sim, FAULT_TEXT[r.fault], 'warn', 7);
      }
    }

    // 상차: 버킷을 다 비울 때마다 이번 버킷의 결과를 알려 준다
    if (truck && sim.truckLoad - this.truckAt > 0.03 && sim.load < 0.02) {
      this.announce(
        sim,
        `버킷 한 번 완료 · 트럭에 ${(sim.truckLoad - this.truckAt).toFixed(2)}m³ (모두 ${sim.truckLoad.toFixed(2)}m³) · 트럭 밖 ${(sim.spilled - this.spillAt).toFixed(2)} · 들다가 떨어뜨림 ${(sim.returned - this.returnAt).toFixed(2)}`,
        'good',
        7,
      );
      this.truckAt = sim.truckLoad;
      this.spillAt = sim.spilled;
      this.returnAt = sim.returned;
    }

    // 급선회로 흘림
    if (sim.spilledBySwing - this.bySwing > 0.01) {
      this.say(sim, 'swing', '선회를 급하게 꺾어 흙을 흘렸습니다. 반대 키로 멈추지 말고, 미리 놓아 천천히 멈추세요');
      this.spilled += sim.spilledBySwing - this.bySwing;
      this.bySwing = sim.spilledBySwing;
    }
    // 흙을 실은 채 주행을 급하게 멈추거나 꺾어 흘림
    if (sim.spilledByTravel - this.byTravel > 0.02) {
      this.say(
        sim,
        'travel',
        '흙을 가득 실은 채 고속 단으로 급하게 꺾어 흙을 흘렸습니다. 흙을 실었을 때는 저속 단으로 [Q] 다니세요',
      );
      this.byTravel = sim.spilledByTravel;
      // 같은 흙을 다른 이유로 한 번 더 알리지 않는다
      this.spilled = sim.spilled;
      this.returned = sim.returned;
    }
    // 구역 밖에 떨어뜨림: 버킷을 펴서 쏟은 것인지, 기울어서 흘린 것인지 구분한다
    if (sim.spilled - this.spilled > 0.03) {
      if (opening && truck) {
        this.say(
          sim,
          'outside',
          b.zone === 'dump'
            ? `버킷이 낮아 흙이 적재함 벽에 막혀 트럭 밖에 떨어졌습니다. 붐을 더 올린 뒤 ${key('boomUp')} 펴세요`
            : '트럭 밖에 흙을 쏟았습니다. 바닥의 원 표시가 적재함 안에 들어온 뒤 버킷을 펴세요',
        );
      } else if (opening) {
        this.say(sim, 'outside', '구역 밖에 흙을 쏟았습니다. 바닥의 원 표시가 파란 구역 안에 들어온 뒤 버킷을 펴세요');
      } else if (cmd.arm < -0.05) {
        this.say(
          sim,
          'tilt',
          `암을 펴다 버킷이 앞으로 기울어 흙을 흘렸습니다. 암을 펴기 전에 버킷 입구가 '위'를 보게 오므려 두세요 ${key('curl')}`,
        );
      } else {
        this.say(sim, 'tilt', `버킷이 기울어 구역 밖에 흙을 흘렸습니다. 입구가 위를 보게 맞추세요`);
      }
      this.spilled = sim.spilled;
    }
    // 노란 구역 밖의 흙을 담는 중
    if (sim.capturedOutside - this.outside > 0.05) {
      this.say(
        sim,
        'source',
        truck
          ? '노란 구역 밖의 흙을 담고 있습니다. 노란 구역 안에서 파세요 (구역 밖에서 판 흙은 감점)'
          : '노란 구역 밖의 흙을 담고 있습니다. 노란 구역 안에서 파야 사이클로 셉니다',
      );
      this.outside = sim.capturedOutside;
    }
    // 들어 올린 뒤 노란 구역에 떨어뜨림 (일부러 펴는 중이면 알리지 않는다)
    if (sim.returned - this.returned > 0.05) {
      if (!opening) {
        this.say(
          sim,
          'returned',
          b.over
            ? `버킷을 너무 오므려 흙이 뒤로 떨어졌습니다. 조금 펴세요 ${key('open')}`
            : `버킷을 덜 오므린 채 들어 흙이 떨어졌습니다. 입구가 위를 볼 때까지 오므리세요 ${key('curl')}`,
          'warn',
          5,
          1.2,
        );
      }
      this.returned = sim.returned;
    }
    if (sim.overflow - this.overflow > 0.12) {
      if (b.fill > 0.9) {
        this.say(sim, 'overflow', `버킷이 이미 가득 찼습니다. 더 긁지 말고 오므려서 ${key('curl')} 들어 올리세요 ${key('boomUp')}`, 'warn', 5, 8);
      }
      this.overflow = sim.overflow;
    }

    // 버킷을 너무 빨리 오므려 흙을 못 담고 땅에서 빠진 경우
    if (this.wasTouching && !b.touching && b.zone === 'dig' && b.fill > 0.02 && b.fill < 0.4 && cmd.bucket > 0.05) {
      this.say(
        sim,
        'popped',
        `버킷을 너무 빨리 오므려 흙을 조금만 담고 땅에서 빠졌습니다. 암은 길게 ${key('armIn')}, 버킷은 짧게 ${key('curl')}`,
      );
    }
    this.wasTouching = b.touching;

    // 쏟으려는데 버킷이 흙더미에 닿은 경우
    if (active && opening && !truck && b.zone === 'dump' && b.touching && b.fill > 0.08) {
      this.say(sim, 'low', `버킷이 땅(흙더미)에 닿아 더 펴지지 않습니다. 붐을 올리세요 ${key('boomUp')}`);
    }
    // 버킷을 땅에 박은 채 주행하려는 경우
    if (active && Math.abs(cmd.travelL) + Math.abs(cmd.travelR) > 0.3 && sim.burial > 0.03) {
      this.say(sim, 'drag', `버킷이 땅에 박혀 있어 주행이 되지 않습니다. 붐을 올려 버킷을 땅에서 떼세요 ${key('boomUp')}`);
    }
    // 흙을 많이 남긴 채 노란 구역으로 돌아온 경우
    if (sim.dumpingStarted && b.zone === 'dig' && sim.load > 0.1 && Math.abs(sim.swingVel) < 15 * DEG) {
      this.say(
        sim,
        'leftover',
        truck
          ? `버킷에 흙이 ${sim.load.toFixed(2)}m³ 남아 있습니다. 트럭 위에서 버킷을 끝까지 펴서 다 쏟고 돌아오세요`
          : `버킷에 흙이 ${sim.load.toFixed(2)}m³ 남아 있어 사이클이 아직 끝나지 않았습니다. 파란 구역에서 마저 쏟으세요`,
        'warn',
        6,
        10,
      );
    }

    // 흙에 막혀 움직이지 않는데 계속 밀고 있는 경우
    const onlyBoomDown = cmd.boom < 0 && cmd.arm === 0 && cmd.bucket === 0 && cmd.swing === 0;
    const pushing = cmd.arm !== 0 || cmd.boom < 0 || cmd.bucket !== 0 || cmd.swing !== 0;
    if (active && pushing && sim.digResist < 0.12 && b.zone !== 'dump') this.stuckTicks++;
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
