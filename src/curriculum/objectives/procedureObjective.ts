import { keyFor, type LeverPattern } from '../../core/input/levers';
import type { Command } from '../../core/sim/command';
import { DEG } from '../../core/sim/math';
import type { ExcavatorSim } from '../../equipment/excavator/excavatorSim';
import { type Metrics, Objective, type ProgressLine } from '../task';

interface Ref {
  boom: number;
  arm: number;
  bucket: number;
  swing: number;
}

interface Step {
  text: (key: (fn: Parameters<typeof keyFor>[0]) => string) => string;
  why: string;
  done: (sim: ExcavatorSim, cmd: Command, ref: Ref, self: ProcedureObjective) => boolean;
}

const k = (name: string) => `<kbd>${name}</kbd>`;

const STEPS: Step[] = [
  { text: () => `안전벨트를 매세요 (${k('B')})`, why: '운전석에 앉으면 가장 먼저 합니다', done: (_s, c) => c.belt },
  { text: () => `시동을 거세요 (${k('R')})`, why: '안전레버가 잠긴 상태에서 겁니다', done: (_s, c) => c.engineOn },
  {
    text: () => `경음기를 울려 주변에 알리세요 (${k('Space')})`,
    why: '장비를 움직이기 전에 주변 사람에게 알립니다',
    done: (_s, _c, _r, self) => self.hornUsed,
  },
  { text: () => `안전레버를 해제하세요 (${k('F')})`, why: '이제 레버가 듣습니다', done: (_s, c) => c.engineOn && !c.locked },
  {
    text: (key) => `붐을 올려 보세요 (${key('boomUp')})`,
    why: '붐은 차체에 붙은 굵은 팔입니다',
    done: (s, _c, r) => s.boomAngle - r.boom > 5 * DEG,
  },
  {
    text: (key) => `암을 펴 보세요 (${key('armOut')})`,
    why: '암은 붐 끝에 달린 가는 팔입니다',
    done: (s, _c, r) => s.armAngle - r.arm > 8 * DEG,
  },
  {
    text: (key) => `버킷을 펴 보세요 (${key('open')})`,
    why: '버킷은 흙을 담는 바가지입니다. 펴면 쏟고 오므리면 담습니다',
    done: (s, _c, r) => s.bucketAngle - r.bucket > 10 * DEG,
  },
  {
    text: (key) => `왼쪽이나 오른쪽으로 선회해 보세요 (${key('swingL')} 또는 ${key('swingR')})`,
    why: '선회는 놓아도 조금 더 돕니다',
    done: (s, _c, r) => Math.abs(s.swing - r.swing) > 15 * DEG,
  },
  {
    text: (key) => `작업을 마칩니다. 붐을 내려 버킷을 땅에 내려놓으세요 (${key('boomDown')})`,
    why: '버킷을 든 채로 장비를 떠나면 안 됩니다',
    done: (s) => s.burial > 0.02 || onGround(s),
  },
  { text: () => `안전레버를 잠그세요 (${k('F')})`, why: '시동을 끄기 전에 먼저 잠급니다', done: (_s, c) => c.locked },
  { text: () => `시동을 끄세요 (${k('R')})`, why: '', done: (_s, c) => !c.engineOn },
  { text: () => `안전벨트를 푸세요 (${k('B')})`, why: '모든 절차가 끝났습니다', done: (_s, c) => !c.belt },
];

function onGround(sim: ExcavatorSim): boolean {
  const p = sim.pose();
  const x = p.baseX + p.fwdX * p.tipR;
  const z = p.baseZ + p.fwdZ * p.tipR;
  return p.baseY + p.tipY - sim.terrain.heightAt(x, z) < 0.05;
}

/**
 * 시동 전 점검부터 작업 종료까지의 절차를 순서대로 해 보는 과제.
 * 순서를 어기면(벨트 없이 시동, 경음기 없이 해제 등) 감점으로 기록한다.
 */
export class ProcedureObjective extends Objective {
  index = 0;
  mistakes = 0;
  hornUsed = false;
  private ref: Ref | null = null;
  private prev: Command | null = null;

  constructor() {
    super(null);
  }

  private mistake(text: string): void {
    this.mistakes++;
    this.say(`${text} (감점)`, 'warn');
  }

  protected step(sim: ExcavatorSim, cmd: Command): void {
    if (cmd.horn) this.hornUsed = true;
    const prev = this.prev;
    if (prev) {
      if (!prev.engineOn && cmd.engineOn && !cmd.belt) this.mistake('안전벨트를 매기 전에 시동을 걸었습니다');
      if (prev.locked && !cmd.locked && !this.hornUsed) this.mistake('경음기로 주변에 알리지 않고 안전레버를 풀었습니다');
      if (prev.engineOn && !prev.locked && !cmd.engineOn) this.mistake('안전레버를 잠그지 않고 시동을 껐습니다');
      if (!prev.locked && cmd.locked && cmd.engineOn && !(sim.burial > 0.02 || onGround(sim))) {
        this.mistake('버킷을 땅에 내려놓지 않고 안전레버를 잠갔습니다');
      }
      if (prev.belt && !cmd.belt && cmd.engineOn) this.mistake('시동을 끄기 전에 안전벨트를 풀었습니다');
    }
    this.prev = { ...cmd };

    if (!this.ref) this.ref = { boom: sim.boomAngle, arm: sim.armAngle, bucket: sim.bucketAngle, swing: sim.swing };
    while (this.index < STEPS.length && STEPS[this.index].done(sim, cmd, this.ref, this)) {
      this.index++;
      // 다음 단계의 "얼마나 움직였나"는 지금 자세를 기준으로 잰다
      this.ref = { boom: sim.boomAngle, arm: sim.armAngle, bucket: sim.bucketAngle, swing: sim.swing };
      if (this.index < STEPS.length) this.say(`${this.index}/${STEPS.length}단계 완료`);
    }
    if (this.index >= STEPS.length) {
      this.done = true;
      this.say('모든 절차를 마쳤습니다');
    }
  }

  goal(_sim: ExcavatorSim, pattern: LeverPattern): string | null {
    if (this.done) return '절차 완료';
    const s = STEPS[this.index];
    const text = s.text((fn) => k(keyFor(fn, pattern)));
    return `${this.index + 1}/${STEPS.length}단계: ${text}${s.why ? `<small>${s.why}</small>` : ''}`;
  }

  brief(): string {
    return `시동부터 종료까지 절차를 순서대로 하세요 (${this.index}/${STEPS.length})`;
  }

  lines(): ProgressLine[] {
    return [
      { label: '완료한 단계', value: `${this.index} / ${STEPS.length}` },
      { label: '순서 실수', value: `${this.mistakes} 회`, tone: this.mistakes > 0 ? 'warn' : undefined },
    ];
  }

  metrics(): Metrics {
    return { steps: this.index, total: STEPS.length, mistakes: this.mistakes, time: this.ticks / 60, belt: this.beltViolations };
  }
}

export const PROCEDURE_STEP_COUNT = STEPS.length;
