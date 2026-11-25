import { type Command, idleCommand } from '../../core/sim/command';
import { clamp, DEG } from '../../core/sim/math';
import type { ExcavatorSim } from './excavatorSim';

export const AUTOPILOT_PHASES = [
  '암을 뻗고 버킷을 편다',
  '붐을 내려 날을 땅에 넣는다',
  '암을 당기며 흙을 담는다',
  '버킷을 오므려 흙을 가둔다',
  '붐을 올린다',
  '덤프 구역으로 선회한다',
  '버킷을 펴서 쏟는다',
  '굴착 위치로 돌아온다',
  '완료',
] as const;

/**
 * 굴착 → 선회 → 덤프를 스스로 하는 시범 운전.
 * 자동 검사(테스트)와 화면의 "시범 보기"에 함께 쓴다.
 * 장비 상태만 보고 명령을 정하므로 결과가 항상 같다.
 */
export class Autopilot {
  phase = 0;
  done = false;
  private hold = 0;

  constructor(
    private cyclesLeft = 1,
    private readonly dumpSwing = -90 * DEG,
  ) {}

  get phaseLabel(): string {
    return AUTOPILOT_PHASES[this.done ? 8 : this.phase];
  }

  next(sim: ExcavatorSim): Command {
    const cmd: Command = { ...idleCommand(), engineOn: true, locked: false, rpm: 10 };
    if (this.done) return cmd;
    const p = sim.pose();
    const r2 = sim.armAngle;
    const r3 = sim.bucketAngle;
    const tipY = p.baseY + p.tipY;
    const cap = sim.spec.bucketCapacity;
    const swingTo = (target: number) => {
      const errDeg = (target - sim.swing) / DEG;
      // 제동 거리를 고려해 미리 속도를 줄인다(역레버로 급제동하지 않게)
      const w = Math.sqrt(2 * 30 * Math.abs(errDeg)) / 60;
      return clamp(Math.sign(errDeg) * w, -1, 1);
    };

    switch (this.phase) {
      case 0: {
        cmd.swing = swingTo(0);
        cmd.arm = r2 < -47 * DEG ? -1 : 0;
        cmd.bucket = clamp((r3 / DEG + 25) / 8, -1, 1);
        cmd.boom = clamp((1.0 - tipY) * 2, -1, 1);
        const ready = r2 >= -47 * DEG && Math.abs(r3 / DEG + 25) < 3 && Math.abs(sim.swing) < 1.5 * DEG;
        if (ready && Math.abs(sim.swingVel) < 3 * DEG) this.phase = 1;
        break;
      }
      case 1:
        cmd.boom = tipY > 0.3 ? -1 : -0.5;
        if (tipY <= -0.15) this.phase = 2;
        break;
      case 2:
        // 얇게 깎으면서 암을 당기고, 버킷을 조금씩 오므린다
        cmd.arm = 1;
        cmd.bucket = p.a3 > -130 * DEG ? 0.3 : 0;
        cmd.boom = clamp((-0.2 - tipY) * 8, -1, 1);
        if (sim.load >= cap * 0.92 || r2 <= -125 * DEG) this.phase = 3;
        break;
      case 3:
        // 땅속에서 버킷을 먼저 오므려 흙을 가둔 다음 들어 올린다
        cmd.bucket = 1;
        cmd.boom = p.a3 < -142 * DEG ? 1 : clamp((-0.15 - tipY) * 8, -1, 1);
        if (p.a3 <= -172 * DEG || r3 <= sim.spec.bucket.min + 1 * DEG) this.phase = 4;
        break;
      case 4:
        cmd.boom = 1;
        cmd.bucket = clamp((p.a3 / DEG + 178) / 10, -1, 1);
        if (tipY >= 2.3) this.phase = 5;
        break;
      case 5: {
        cmd.swing = swingTo(this.dumpSwing);
        cmd.arm = clamp((p.wristR - 5.9) * 1.5, -1, 1);
        cmd.bucket = clamp((p.a3 / DEG + 178) / 10, -1, 1);
        cmd.boom = clamp((2.4 - tipY) * 2, -1, 1);
        const arrived = Math.abs(sim.swing - this.dumpSwing) < 1.5 * DEG && Math.abs(sim.swingVel) < 3 * DEG;
        if (arrived) this.phase = 6;
        break;
      }
      case 6:
        cmd.bucket = -1;
        if (sim.load < 0.002) {
          if (++this.hold > 20) {
            this.hold = 0;
            this.phase = 7;
          }
        }
        break;
      case 7: {
        cmd.swing = swingTo(0);
        cmd.bucket = clamp((r3 / DEG + 60) / 8, -1, 1);
        if (Math.abs(sim.swing) < 1.5 * DEG && Math.abs(sim.swingVel) < 3 * DEG) {
          this.cyclesLeft--;
          if (this.cyclesLeft > 0) this.phase = 0;
          else this.done = true;
        }
        break;
      }
    }
    return cmd;
  }
}
