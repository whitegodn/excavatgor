import { clamp } from '../../core/sim/math';
import type { JointSpec } from './params';

/** 실린더 길이를 상태로 갖는 관절. 각도는 길이에서 계산한다. */
export class CylinderJoint {
  length: number;
  readonly lMin: number;
  readonly lMax: number;
  /** 실린더 최고 속도(m/s) */
  readonly vMax: number;

  constructor(
    readonly spec: JointSpec,
    initialAngle: number,
  ) {
    const l0 = this.lengthFor(spec.min);
    const l1 = this.lengthFor(spec.max);
    this.lMin = Math.min(l0, l1);
    this.lMax = Math.max(l0, l1);
    this.vMax = (this.lMax - this.lMin) / spec.strokeTime;
    this.length = this.lengthFor(clamp(initialAngle, spec.min, spec.max));
  }

  lengthFor(angle: number): number {
    const { a, b, phiK, phiC } = this.spec;
    const phi = phiK * angle + phiC;
    return Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(phi));
  }

  /** 실린더가 이루는 삼각형의 끼인각 φ */
  get phi(): number {
    const { a, b } = this.spec;
    return Math.acos(clamp((a * a + b * b - this.length * this.length) / (2 * a * b), -1, 1));
  }

  get angle(): number {
    return (this.phi - this.spec.phiC) / this.spec.phiK;
  }

  /** 0 = 완전히 줄어듦, 1 = 완전히 늘어남 */
  get stroke(): number {
    return (this.length - this.lMin) / (this.lMax - this.lMin);
  }

  /** v > 0 이면 늘어난다. 스트로크 끝에서 멈춘다. */
  step(v: number, dt: number): void {
    this.length = clamp(this.length + v * dt, this.lMin, this.lMax);
  }
}
