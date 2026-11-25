import { type Command, DT } from '../../core/sim/command';
import { clamp, DEG, wrapAngle } from '../../core/sim/math';
import { Terrain } from '../../core/terrain/terrain';
import { type Site, zoneAt } from '../../sites/site';
import { BUCKET_PROFILE, buildProfileSamples } from './bucketProfile';
import { CylinderJoint } from './cylinder';
import { EXCAVATOR_14T, type ExcavatorSpec } from './params';

/**
 * 한 시점의 자세. 작업 장치는 상부 선회체의 앞(r)·위(y) 평면 위에서 움직인다.
 * 세계 좌표 = base + fwd·r + (0, y, 0).
 */
export interface Pose {
  /** 붐·암·버킷의 절대 각도(수평 기준, 위쪽 +) */
  a1: number;
  a2: number;
  a3: number;
  fwdX: number;
  fwdZ: number;
  latX: number;
  latZ: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  pivotR: number;
  pivotY: number;
  elbowR: number;
  elbowY: number;
  wristR: number;
  wristY: number;
  tipR: number;
  tipY: number;
}

const SPOOLS = ['swing', 'arm', 'boom', 'bucket', 'travelL', 'travelR'] as const;

/** 버킷에서 흙이 떨어진 까닭: 파는 중 넘침 / 버킷을 펴서 쏟음 / 기울거나 흔들려 흘림 */
type DropCause = 'dig' | 'pour' | 'slip';

/** 사이클이 인정되지 않은 이유 */
export type CycleFault = '' | 'returned' | 'none' | 'spill' | 'source';

export interface CycleReport {
  valid: boolean;
  fault: CycleFault;
  /** 유효한 사이클일 때만: 굴착 구역 출발 → 덤프 → 굴착 구역 복귀까지(초) */
  time: number;
  captured: number;
  dumped: number;
  spilled: number;
  returned: number;
  /** 다 쏟지 않고 버킷에 남긴 채 돌아온 흙 */
  leftover: number;
}

/**
 * 굴착기 한 대와 지형의 시뮬레이션. 화면·브라우저에 의존하지 않는다.
 * step(command)를 같은 순서로 부르면 항상 같은 결과가 나온다.
 */
export class ExcavatorSim {
  readonly terrain: Terrain;
  tick = 0;
  x: number;
  z: number;
  y = 0;
  heading: number;
  swing = 0;
  swingVel = 0;
  swingAcc = 0;
  trackL = 0;
  trackR = 0;
  readonly boom: CylinderJoint;
  readonly arm: CylinderJoint;
  readonly bucket: CylinderJoint;
  /** 밸브 스풀 위치. 레버 입력을 약간 늦게 따라간다. */
  readonly spool = { swing: 0, arm: 0, boom: 0, bucket: 0, travelL: 0, travelR: 0 };
  /** 버킷 안의 흙(m³, 풀린 흙 기준) */
  load = 0;

  /** 버킷이 흙에 묻힌 깊이(m)와 그에 따른 속도 배율(1 = 저항 없음) */
  burial = 0;
  /** 지금 누르는 레버 기준으로 흙 때문에 느려진 정도 (화면의 "굴착 저항") */
  digResist = 1;
  /** 암·버킷으로 긁을 때의 저항만 (붐으로 누르는 힘의 한계는 뺀 값) */
  soilResist = 1;
  /** 여러 동작을 동시에 할 때의 유량 분배 배율(1 = 감속 없음) */
  flowShare = 1;
  private rateResist = 1;
  /** 최근 굴착 속도(m³/s, 풀린 흙 기준) */
  cutRate = 0;
  /** 버킷 등이나 옆면으로 흙을 미는 속도(m³/s). 크면 거의 움직이지 못한다. */
  pushRate = 0;
  private pushedThisTick = 0;

  // 측정값 (모두 풀린 흙 기준 m³)
  dumped = 0;
  /** 구역 밖에 떨어뜨린 흙 */
  spilled = 0;
  /** 그중 선회를 급하게 꺾어서 흘린 양 */
  spilledBySwing = 0;
  /** 들다가 굴착 구역에 도로 떨어뜨린 흙 */
  returned = 0;
  overflow = 0;
  captured = 0;
  /** 굴착 구역 밖에서 담은 흙 */
  capturedOutside = 0;
  cutTotal = 0;
  cycles = 0;
  lastCycleTime = 0;
  bestCycleTime = 0;
  /** 가장 최근 사이클의 결과. reportCount가 늘면 새 결과가 나온 것이다. */
  lastCycle: CycleReport | null = null;
  reportCount = 0;
  /** 유효하게 쏟은 뒤 굴착 구역으로 돌아오기를 기다리는 중 */
  awaitingReturn = false;
  private cycleStartTick = -1;
  private restartAtDig = false;
  private cycleLoaded = false;
  private cycleCaptured = 0;
  private cycleFromDig = 0;
  private cycleDumped = 0;
  private cycleSpilled = 0;
  private cycleReturned = 0;
  /** 버킷을 펴서 일부러 쏟은 양 (넘침·흘림과 구분한다) */
  private cyclePoured = 0;

  /** 이번 틱에 버킷에서 떨어진 흙(m³/s)과 그 위치. 화면 효과용. */
  dropRate = 0;
  dropX = 0;
  dropY = 0;
  dropZ = 0;

  private prevTipX: number;
  private prevTipY: number;
  private prevTipZ: number;
  private readonly samples: Float64Array;
  private readonly latCount: number;
  private readonly latStep: number;
  private readonly colVol: Float64Array;
  private readonly midC: number;
  private readonly midN: number;
  private readonly total0: number;

  constructor(
    readonly site: Site,
    readonly spec: ExcavatorSpec = EXCAVATOR_14T,
    /** 시작 자세(라디안). 주지 않으면 장비 제원의 기본 자세 */
    start: { boom: number; arm: number; bucket: number } = spec.initial,
  ) {
    this.terrain = new Terrain(site.terrainSize, site.cell);
    this.x = site.start.x;
    this.z = site.start.z;
    this.heading = site.start.heading;
    this.boom = new CylinderJoint(spec.boom, start.boom);
    this.arm = new CylinderJoint(spec.arm, start.arm);
    this.bucket = new CylinderJoint(spec.bucket, start.bucket);

    const step = site.cell * 0.5;
    this.samples = buildProfileSamples(spec.bucketLen, step);
    this.latCount = Math.ceil(spec.bucketWidth / 2 / step);
    this.latStep = spec.bucketWidth / 2 / this.latCount;
    this.colVol = new Float64Array(this.latCount * 2 + 1);
    let mc = 0;
    let mn = 0;
    for (const [c, n] of BUCKET_PROFILE) {
      mc += c;
      mn += n;
    }
    this.midC = (mc / BUCKET_PROFILE.length) * spec.bucketLen;
    this.midN = (mn / BUCKET_PROFILE.length) * spec.bucketLen;

    const p = this.pose();
    this.prevTipX = p.baseX + p.fwdX * p.tipR;
    this.prevTipY = p.baseY + p.tipY;
    this.prevTipZ = p.baseZ + p.fwdZ * p.tipR;
    this.total0 = this.terrain.totalLooseEq();
  }

  get boomAngle(): number {
    return this.boom.angle;
  }
  get armAngle(): number {
    return this.arm.angle;
  }
  get bucketAngle(): number {
    return this.bucket.angle;
  }
  get time(): number {
    return this.tick * DT;
  }
  /** 지금 진행 중인 사이클의 경과 시간(초) */
  get cycleTime(): number {
    return this.cycleStartTick < 0 ? 0 : (this.tick - this.cycleStartTick) * DT;
  }

  pose(): Pose {
    const sp = this.spec;
    const psi = this.heading + this.swing;
    const fwdX = Math.sin(psi);
    const fwdZ = Math.cos(psi);
    const latX = Math.cos(psi);
    const latZ = -Math.sin(psi);
    const a1 = this.boom.angle;
    const a2 = a1 + this.arm.angle;
    const a3 = a2 + this.bucket.angle;
    const elbowR = sp.pivotR + sp.boomLen * Math.cos(a1);
    const elbowY = sp.pivotH + sp.boomLen * Math.sin(a1);
    const wristR = elbowR + sp.armLen * Math.cos(a2);
    const wristY = elbowY + sp.armLen * Math.sin(a2);
    return {
      a1,
      a2,
      a3,
      fwdX,
      fwdZ,
      latX,
      latZ,
      baseX: this.x + latX * sp.latOffset,
      baseY: this.y,
      baseZ: this.z + latZ * sp.latOffset,
      pivotR: sp.pivotR,
      pivotY: sp.pivotH,
      elbowR,
      elbowY,
      wristR,
      wristY,
      tipR: wristR + sp.bucketLen * Math.cos(a3),
      tipY: wristY + sp.bucketLen * Math.sin(a3),
    };
  }

  step(cmd: Command): void {
    const sp = this.spec;
    const S = this.spool;
    const on = cmd.engineOn && !cmd.locked;

    // 1) 밸브 응답 지연
    const kv = Math.min(1, DT / sp.valveTau);
    let anyInput = false;
    for (const key of SPOOLS) {
      const want = on ? clamp(cmd[key], -1, 1) : 0;
      if (Math.abs(want) > 0.05) anyInput = true;
      S[key] += (want - S[key]) * kv;
      if (Math.abs(S[key]) < 1e-5 || !cmd.engineOn) S[key] = 0;
    }
    if (this.cycleStartTick < 0 && anyInput) this.cycleStartTick = this.tick;

    // 2) 굴착 저항
    const p0 = this.pose();
    const burial = this.computeBurial(p0, Math.sign(S.swing));
    this.burial = burial;
    let sDig = clamp(1 - Math.pow(burial / sp.stallDepth, 1.5), 0, 1);
    const pushResist = clamp(1 - (this.pushRate - 0.02) / 0.1, 0.03, 1);
    sDig = Math.min(sDig, this.rateResist, pushResist);
    if (burial > 0.05 && this.load >= sp.bucketCapacity * 0.999) sDig *= 0.6;
    // 붐을 내리누르는 힘에는 한계가 있어 날이 조금 들어가면 멈춘다
    const sBoomDown = Math.min(sDig, clamp(1 - Math.pow(burial / sp.boomStallDepth, 1.5), 0, 1));
    this.soilResist = sDig;
    this.digResist = S.boom < 0 && S.arm === 0 && S.bucket === 0 ? sBoomDown : sDig;

    // 3) 유량 분배: 동시에 쓰는 기능이 많을수록 각각 느려진다
    const w = sp.flowWeights;
    const demand =
      Math.abs(S.boom) * w.boom +
      Math.abs(S.arm) * w.arm +
      Math.abs(S.bucket) * w.bucket +
      Math.abs(S.swing) * w.swing +
      (Math.abs(S.travelL) + Math.abs(S.travelR)) * w.travel;
    const share = demand > sp.pumpUnits ? sp.pumpUnits / demand : 1;
    this.flowShare = share;
    const rpmF = 0.35 + 0.065 * clamp(cmd.rpm, 1, 10);
    const g = share * rpmF;

    // 4) 실린더: 붐 올리기는 저항을 받지 않고, 버킷 오므리기는 힘이 가장 세다
    this.boom.step(S.boom * this.boom.vMax * g * (S.boom > 0 ? 1 : sBoomDown), DT);
    this.arm.step(S.arm * this.arm.vMax * g * sDig, DT);
    this.bucket.step(S.bucket * this.bucket.vMax * g * (S.bucket > 0 ? Math.max(sDig, 0.5) : sDig), DT);

    // 5) 선회: 관성이 있어 서서히 가속하고 멈출 때 밀린다
    const sSwing = Math.min(burial > 0.1 ? sDig * sDig : 1, pushResist);
    const wTarget = S.swing * sp.swingMax * g * sSwing;
    // 흙을 실으면 무거워져 가속도 제동도 둔해진다. 엔진 회전이 낮으면 가속이 약하다.
    const inertia = 1 + 0.35 * (this.load / sp.bucketCapacity);
    let aMax = (sp.swingAccel * (0.4 + 0.6 * rpmF)) / inertia;
    if (wTarget * this.swingVel < -1e-9) aMax = sp.swingCounterBrake / inertia;
    else if (Math.abs(wTarget) < Math.abs(this.swingVel)) aMax = sp.swingBrake / inertia;
    const dv = clamp(wTarget - this.swingVel, -aMax * DT, aMax * DT);
    this.swingAcc = dv / DT;
    this.swingVel += dv;
    if (wTarget === 0 && Math.abs(this.swingVel) < 1e-6) this.swingVel = 0;
    this.swing = wrapAngle(this.swing + this.swingVel * DT);

    // 6) 주행: 좌우 궤도 속도 차이로 회전한다
    const ta = sp.travelAccel * DT;
    // 버킷을 땅에 박은 채로는 궤도가 버킷을 끌지 못한다
    const sTravel = burial > 0.03 ? Math.min(sDig, pushResist, 0.25) : 1;
    this.trackL += clamp(S.travelL * sp.travelMax * g * sTravel - this.trackL, -ta, ta);
    this.trackR += clamp(S.travelR * sp.travelMax * g * sTravel - this.trackR, -ta, ta);
    if (Math.abs(this.trackL) < 1e-6 && S.travelL === 0) this.trackL = 0;
    if (Math.abs(this.trackR) < 1e-6 && S.travelR === 0) this.trackR = 0;
    const v = (this.trackL + this.trackR) / 2;
    // 좌우 궤도를 반대로 돌리는 제자리 회전은 궤도가 미끄러져 계산보다 느리다
    const slip = this.trackL * this.trackR < 0 ? sp.spinTurnSlip : 1;
    this.heading = wrapAngle(this.heading + ((this.trackL - this.trackR) / sp.trackGauge) * slip * DT);
    const lim = this.site.terrainSize / 2 - 4;
    this.x = clamp(this.x + Math.sin(this.heading) * v * DT, -lim, lim);
    this.z = clamp(this.z + Math.cos(this.heading) * v * DT, -lim, lim);
    this.y += (this.groundUnderTracks() - this.y) * Math.min(1, DT / 0.2);

    // 7) 버킷과 흙
    const p1 = this.pose();
    const tipX = p1.baseX + p1.fwdX * p1.tipR;
    const tipY = p1.baseY + p1.tipY;
    const tipZ = p1.baseZ + p1.fwdZ * p1.tipR;
    const vx = (tipX - this.prevTipX) / DT;
    const vy = (tipY - this.prevTipY) / DT;
    const vz = (tipZ - this.prevTipZ) / DT;
    this.prevTipX = tipX;
    this.prevTipY = tipY;
    this.prevTipZ = tipZ;

    // 버킷 입구가 위를 향할수록 많이 담는다. 입구가 옆을 봐도 바가지 안쪽에는 흙이 남고,
    // 아래로 30° 가까이 기울어야 다 쏟아진다. 흙에 박혀 있는 동안은 주변 흙이 받쳐 준다.
    const cap = sp.bucketCapacity;
    const openUp = Math.asin(clamp(-Math.cos(p1.a3), -1, 1));
    let hold = clamp((openUp + 30 * DEG) / (82 * DEG), 0, 1);
    if (hold < 0.02) hold = 0;
    if (burial > 0.02) hold = Math.min(1, hold + burial / 0.25);
    const maxHold = cap * hold;

    this.pushedThisTick = 0;
    const cut = this.interact(p1, vx, vy, vz, maxHold);
    this.cutTotal += cut;
    this.pushRate += (this.pushedThisTick / DT - this.pushRate) * Math.min(1, DT / 0.2);
    // 깎는 속도는 격자 때문에 들쭉날쭉하므로 평균을 낸 뒤 저항으로 바꾼다
    this.cutRate += (cut / DT - this.cutRate) * Math.min(1, DT / 0.2);
    this.rateResist = clamp(1 - (this.cutRate - sp.cutRateFree) / sp.cutRateSpan, 0.15, 1);

    this.dropRate = 0;
    if (this.load > maxHold + 1e-9) {
      // 낮은 쪽 입술에서 쏟아진다
      const overTip = p1.tipY <= p1.wristY;
      const d = Math.min(this.load - maxHold, sp.pourRate * DT);
      // 땅을 파는 중에 넘친 것 / 버킷을 펴서 쏟는 것 / 기울어서 흘린 것
      const inSoil = burial > 0.02 || tipY - this.terrain.heightAt(tipX, tipZ) < 0.15;
      const cause: DropCause = inSoil ? 'dig' : S.bucket < -0.02 ? 'pour' : 'slip';
      this.drop(d, overTip ? p1.tipR : p1.wristR, overTip ? p1.tipY : p1.wristY, p1, cause);
    }
    const heap = this.load - 0.85 * cap;
    if (heap > 0) {
      // 선회를 급하게 멈추거나 반대로 꺾으면 수북한 부분이 흘러내린다
      const a = Math.abs(this.swingAcc) * p1.wristR;
      if (a > sp.spillAccel) {
        const d = Math.min(heap, (a / sp.spillAccel - 1) * cap * 0.5 * DT);
        const before = this.spilled;
        this.drop(d, p1.wristR + this.midC * Math.cos(p1.a3), p1.wristY, p1);
        this.spilledBySwing += this.spilled - before;
      }
    }
    if (this.load < 1e-6) this.load = 0;

    // 8) 안식각
    this.terrain.relax(this.tick);

    // 9) 사이클 측정: 굴착 구역에서 담기 → 덤프 구역에 쏟기 → 굴착 구역으로 복귀
    const tipZone = zoneAt(this.site, tipX, tipZ);
    // 선회하다 스쳐 지나가는 것은 "돌아왔다"로 보지 않는다
    const atDig = tipZone === 'dig' && Math.abs(this.swingVel) < 15 * DEG;
    if (this.awaitingReturn && (atDig || this.load > 0.05)) this.completeCycle();
    if (!this.cycleLoaded && this.load > 0.05) this.cycleLoaded = true;
    const emptied = this.load < 0.01;
    // 조금 남긴 채(0.1m³ 이하) 굴착 구역으로 돌아온 경우도 마감한다.
    // 그보다 많이 남겼으면 아직 끝난 것이 아니다: 마저 쏟을 때까지 같은 사이클이다.
    const cameBack = this.cyclePoured > 0.05 && atDig && this.load <= 0.1;
    if (this.cycleLoaded && (emptied || cameBack)) {
      this.cycleLoaded = false;
      const out = this.cycleDumped + this.cycleSpilled + this.cycleReturned;
      let fault: CycleFault = '';
      if (this.cycleDumped < 0.12) fault = this.cycleReturned > 0.5 * out ? 'returned' : 'none';
      else if (this.cycleDumped < 0.6 * (this.cycleDumped + this.cycleSpilled)) fault = 'spill';
      else if (this.cycleFromDig < 0.7 * this.cycleCaptured) fault = 'source';
      if (this.cycleCaptured < 0.05) {
        // 새로 판 흙이 없다(전에 남긴 흙을 쏟았을 뿐): 사이클로도 실패로도 치지 않는다
        this.resetCycle();
      } else if (fault !== '') {
        this.report(false, fault, 0);
        this.restartAtDig = true;
      } else if (cameBack) this.completeCycle();
      else this.awaitingReturn = true;
    }
    // 실패한 시도의 시간은 다음 사이클에 넣지 않는다: 굴착 구역으로 돌아온 순간부터 다시 잰다
    if (this.restartAtDig && tipZone === 'dig') {
      this.cycleStartTick = this.tick + 1;
      this.restartAtDig = false;
    }
    this.tick++;
  }

  /** 이번 사이클에서 흙을 쏟기 시작했는가 (안내 문구용) */
  get dumpingStarted(): boolean {
    return this.cyclePoured > 0.02;
  }

  private completeCycle(): void {
    this.cycles++;
    this.lastCycleTime = (this.tick + 1 - this.cycleStartTick) * DT;
    if (this.bestCycleTime === 0 || this.lastCycleTime < this.bestCycleTime) {
      this.bestCycleTime = this.lastCycleTime;
    }
    this.report(true, '', this.lastCycleTime);
    this.cycleStartTick = this.tick + 1;
    this.awaitingReturn = false;
  }

  private report(valid: boolean, fault: CycleFault, time: number): void {
    this.lastCycle = {
      valid,
      fault,
      time,
      captured: this.cycleCaptured,
      dumped: this.cycleDumped,
      spilled: this.cycleSpilled,
      returned: this.cycleReturned,
      leftover: this.load,
    };
    this.reportCount++;
    this.resetCycle();
  }

  private resetCycle(): void {
    this.cycleCaptured = 0;
    this.cycleFromDig = 0;
    this.cycleDumped = 0;
    this.cycleSpilled = 0;
    this.cycleReturned = 0;
    this.cyclePoured = 0;
  }

  /** 버킷에서 가장 낮은 점 기준으로, 진행 방향 앞쪽 흙이 얼마나 높이 있는지 */
  private computeBurial(p: Pose, swingSign: number): number {
    const sp = this.spec;
    const t = this.terrain;
    const sa = Math.sin(p.a3);
    const ca = Math.cos(p.a3);
    let lowR = p.tipR;
    let lowY = p.tipY;
    for (const [c, n] of BUCKET_PROFILE) {
      const yy = p.wristY + (c * sa + n * ca) * sp.bucketLen;
      if (yy < lowY) {
        lowY = yy;
        lowR = p.wristR + (c * ca - n * sa) * sp.bucketLen;
      }
    }
    const refY = p.baseY + lowY;
    // 입구가 향하는 쪽(대개 운전석 쪽)이 "앞"이다
    const dir = sa > 0.2 ? 1 : -1;
    let b = 0;
    for (const d of [0.3, 0.6]) {
      const r = lowR + dir * d;
      b = Math.max(b, t.heightAt(p.baseX + p.fwdX * r, p.baseZ + p.fwdZ * r) - refY);
    }
    if (swingSign !== 0) {
      const off = swingSign * (sp.bucketWidth / 2 + 0.3);
      const hx = p.baseX + p.fwdX * lowR + p.latX * off;
      const hz = p.baseZ + p.fwdZ * lowR + p.latZ * off;
      b = Math.max(b, t.heightAt(hx, hz) - refY);
    }
    return Math.max(0, b);
  }

  /**
   * 버킷 윤곽이 지나간 자리의 흙을 깎는다.
   * 입구 쪽으로 움직이면 버킷에 담기고, 등 쪽이나 옆으로 밀면 밀려난다.
   * 깎은 양(풀린 흙 기준 m³)을 돌려준다.
   */
  private interact(p: Pose, vx: number, vy: number, vz: number, maxHold: number): number {
    // 버킷이 멈춰 있으면 흙을 건드리지 않는다(주변 흙이 무너져 저절로 담기는 일을 막는다)
    const speed = Math.hypot(vx, vy, vz);
    if (speed < 0.02) return 0;
    const sp = this.spec;
    const t = this.terrain;
    const sa = Math.sin(p.a3);
    const ca = Math.cos(p.a3);
    const m = this.latCount;
    const col = this.colVol;
    col.fill(0);
    let total = 0;
    const samples = this.samples;
    for (let s = 0; s < samples.length; s += 2) {
      const c = samples[s];
      const n = samples[s + 1];
      const r = p.wristR + c * ca - n * sa;
      const y = p.baseY + p.wristY + c * sa + n * ca;
      const cx = p.baseX + p.fwdX * r;
      const cz = p.baseZ + p.fwdZ * r;
      for (let k = -m; k <= m; k++) {
        const off = k * this.latStep;
        const idx = t.nearestIndex(cx + p.latX * off, cz + p.latZ * off);
        if (idx < 0 || t.h[idx] <= y + 1e-6) continue;
        const vol = t.cut(idx, y);
        col[k + m] += vol;
        total += vol;
      }
    }
    if (total <= 0) return 0;

    // 입구 방향(세계 좌표)과 날 끝 속도로 "담기 / 밀기 / 옆으로 쓸기"를 가른다
    const ox = p.fwdX * sa;
    const oy = -ca;
    const oz = p.fwdZ * sa;
    const vLat = vx * p.latX + vz * p.latZ;
    const pvx = vx - p.latX * vLat;
    const pvz = vz - p.latZ * vLat;
    const vPlanar = Math.hypot(pvx, vy, pvz);
    const vo = vx * ox + vy * oy + vz * oz;
    const half = sp.bucketWidth / 2;
    const midR = p.wristR + this.midC * ca - this.midN * sa;

    if (Math.abs(vLat) > 1.5 * vPlanar + 0.05) {
      this.pushedThisTick = total;
      const side = Math.sign(vLat) * (half + 0.4);
      for (const r of [p.tipR, midR, p.wristR]) {
        t.deposit(p.baseX + p.fwdX * r + p.latX * side, p.baseZ + p.fwdZ * r + p.latZ * side, total / 3, 0.25);
      }
    } else if (vo > 0.25 * speed && oy > -0.5) {
      // 입구가 진행 방향을 향할 때만 흙이 버킷 안으로 들어온다.
      // 입구가 아래로 30° 넘게 엎어져 있으면 담기지 않고 밀어낼 뿐이다
      const take = Math.min(Math.max(0, maxHold - this.load), total);
      this.load += take;
      this.captured += take;
      this.cycleCaptured += take;
      const tx = p.baseX + p.fwdX * p.tipR;
      const tz = p.baseZ + p.fwdZ * p.tipR;
      if (zoneAt(this.site, tx, tz) === 'dig') this.cycleFromDig += take;
      else this.capturedOutside += take;
      const over = total - take;
      if (over > 0) {
        // 다 담지 못한 흙은 버킷 양옆으로 넘친다
        this.overflow += over;
        for (const sgn of [-1, 1]) {
          const side = sgn * (half + 0.3);
          t.deposit(
            p.baseX + p.fwdX * p.tipR + p.latX * side,
            p.baseZ + p.fwdZ * p.tipR + p.latZ * side,
            over / 2,
            0.25,
          );
        }
      }
    } else {
      this.pushedThisTick = total;
      let dx = pvx;
      let dz = pvz;
      const dl = Math.hypot(dx, dz);
      if (dl > 1e-3) {
        dx /= dl;
        dz /= dl;
      } else {
        dx = p.fwdX;
        dz = p.fwdZ;
      }
      for (let k = -m; k <= m; k++) {
        const vol = col[k + m];
        if (vol <= 0) continue;
        const off = k * this.latStep;
        t.deposit(
          p.baseX + p.fwdX * midR + p.latX * off + dx,
          p.baseZ + p.fwdZ * midR + p.latZ * off + dz,
          vol,
          0.25,
        );
      }
    }
    return total;
  }

  /** 버킷의 흙 vol을 (r, y) 아래 지면에 떨어뜨리고, 떨어진 곳에 따라 덤프/흘림으로 기록한다. */
  private drop(vol: number, r: number, y: number, p: Pose, cause: DropCause = 'slip'): void {
    if (vol <= 0) return;
    const cx = p.baseX + p.fwdX * r;
    const cz = p.baseZ + p.fwdZ * r;
    const kind = zoneAt(this.site, cx, cz);
    if (cause === 'pour') this.cyclePoured += vol;
    if (cause === 'dig') {
      // 파는 중에 넘친 흙은 그 자리에 남을 뿐, 흘리거나 떨어뜨린 것이 아니다
      this.overflow += vol;
    } else if (kind === 'dump') {
      this.dumped += vol;
      this.cycleDumped += vol;
    } else if (kind === 'dig') {
      this.returned += vol;
      this.cycleReturned += vol;
    } else {
      this.spilled += vol;
      this.cycleSpilled += vol;
    }
    this.load -= vol;
    const w = this.spec.bucketWidth * 0.3;
    for (const o of [-w, 0, w]) {
      this.terrain.deposit(cx + p.latX * o, cz + p.latZ * o, vol / 3, 0.3);
    }
    this.dropRate += vol / DT;
    this.dropX = cx;
    this.dropY = p.baseY + y;
    this.dropZ = cz;
  }

  private groundUnderTracks(): number {
    const sp = this.spec;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const lx = Math.cos(this.heading);
    const lz = -Math.sin(this.heading);
    const hw = sp.trackGauge / 2;
    const hl = sp.trackLength * 0.4;
    let sum = 0;
    for (const s of [-1, 1]) {
      for (const f of [-1, 0, 1]) {
        sum += this.terrain.heightAt(this.x + lx * hw * s + fx * hl * f, this.z + lz * hw * s + fz * hl * f);
      }
    }
    return sum / 6;
  }

  /** 부피 보존 오차(%). 깎은 양 대비, 지형 + 버킷의 총량이 처음과 얼마나 다른지. */
  conservationError(): number {
    const now = this.terrain.totalLooseEq() + this.load;
    return (Math.abs(now - this.total0) / Math.max(this.cutTotal, 1e-3)) * 100;
  }

  /** 상태 전체의 지문. 같은 입력을 재생했을 때 결과가 같은지 비교하는 데 쓴다. */
  hash(): string {
    const f64 = new Float64Array(1);
    const u8 = new Uint8Array(f64.buffer);
    let hsh = 0x811c9dc5;
    const mix = (v: number) => {
      f64[0] = v;
      for (let i = 0; i < 8; i++) {
        hsh ^= u8[i];
        hsh = Math.imul(hsh, 0x01000193);
      }
    };
    for (const v of [
      this.tick,
      this.x,
      this.z,
      this.y,
      this.heading,
      this.swing,
      this.swingVel,
      this.trackL,
      this.trackR,
      this.boom.length,
      this.arm.length,
      this.bucket.length,
      this.load,
      this.dumped,
      this.spilled,
      this.returned,
      this.overflow,
      this.cycles,
    ]) {
      mix(v);
    }
    const h = this.terrain.h;
    for (let k = 0; k < h.length; k++) if (h[k] !== 0) mix(k + h[k]);
    return (hsh >>> 0).toString(16).padStart(8, '0');
  }
}
