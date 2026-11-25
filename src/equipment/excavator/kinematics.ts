import type { ExcavatorSpec } from './params';

export interface JointAngles {
  boom: number;
  arm: number;
  bucket: number;
  swing: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** 관절 각도(라디안)가 주어졌을 때 버킷 날 끝이 어디에 오는지 계산한다. */
export function tipPosition(
  spec: ExcavatorSpec,
  base: { x: number; y: number; z: number; heading: number },
  j: JointAngles,
): Point3 {
  const psi = base.heading + j.swing;
  const fwdX = Math.sin(psi);
  const fwdZ = Math.cos(psi);
  const latX = Math.cos(psi);
  const latZ = -Math.sin(psi);
  const a1 = j.boom;
  const a2 = a1 + j.arm;
  const a3 = a2 + j.bucket;
  const r = spec.pivotR + spec.boomLen * Math.cos(a1) + spec.armLen * Math.cos(a2) + spec.bucketLen * Math.cos(a3);
  const y = spec.pivotH + spec.boomLen * Math.sin(a1) + spec.armLen * Math.sin(a2) + spec.bucketLen * Math.sin(a3);
  return {
    x: base.x + latX * spec.latOffset + fwdX * r,
    y: base.y + y,
    z: base.z + latZ * spec.latOffset + fwdZ * r,
  };
}
