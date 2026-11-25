import { type LeverAxes, zeroAxes } from './levers';

const DEADZONE = 0.08;

function dz(v: number | undefined): number {
  if (v === undefined || Math.abs(v) < DEADZONE) return 0;
  return (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
}

/**
 * 조이스틱·게임패드 입력(Gamepad API).
 * - 표준 게임패드 1개: 왼쪽/오른쪽 스틱 = 좌/우 레버, 십자키 = 주행
 * - 조이스틱 2개: 첫 번째 = 좌 레버, 두 번째 = 우 레버
 * 주의: 실제 장비로 아직 검증하지 못했다. 장비 연결 후 축 방향과 번호를 확인해야 한다.
 */
export class GamepadInput {
  lastActive = false;

  read(): LeverAxes | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = Array.from(navigator.getGamepads()).filter((p): p is Gamepad => !!p && p.connected);
    if (pads.length === 0) {
      this.lastActive = false;
      return null;
    }
    const out = zeroAxes();
    const std = pads.find((p) => p.mapping === 'standard');
    if (std) {
      out.lx = dz(std.axes[0]);
      out.ly = -dz(std.axes[1]);
      out.rx = dz(std.axes[2]);
      out.ry = -dz(std.axes[3]);
      const b = (i: number) => (std.buttons[i]?.pressed ? 1 : 0);
      const f = b(12) - b(13);
      const t = b(15) - b(14);
      out.tl = Math.max(-1, Math.min(1, f + t));
      out.tr = Math.max(-1, Math.min(1, f - t));
    } else {
      const left = pads[0];
      const right = pads[1];
      out.lx = dz(left.axes[0]);
      out.ly = -dz(left.axes[1]);
      if (right) {
        out.rx = dz(right.axes[0]);
        out.ry = -dz(right.axes[1]);
      }
    }
    this.lastActive = Object.values(out).some((v) => v !== 0);
    return out;
  }
}
