import {
  Color3,
  Mesh,
  MeshBuilder,
  type Scene,
  type ShadowGenerator,
  StandardMaterial,
  TransformNode,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import type { LeverAxes } from '../../core/input/levers';
import { DEG } from '../../core/sim/math';
import { BUCKET_PROFILE } from '../../equipment/excavator/bucketProfile';
import type { ExcavatorSim } from '../../equipment/excavator/excavatorSim';
import type { ExcavatorSpec } from '../../equipment/excavator/params';

function material(scene: Scene, name: string, r: number, g: number, b: number, alpha = 1): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(r, g, b);
  m.specularColor = new Color3(0.12, 0.12, 0.12);
  m.alpha = alpha;
  return m;
}

/** 운전실 조종 장치를 움직이는 데 필요한 값 */
export interface CabControls {
  levers: LeverAxes;
  locked: boolean;
  rpm: number;
}

/** 운전석 화면에서 이름표를 붙일 조종 장치 */
export type CabPart = 'joyL' | 'joyR' | 'travel' | 'lock' | 'dial';

/**
 * 단순한 도형(박스·원기둥)으로 만든 굴착기.
 * 좌표: 상부 선회체 기준으로 +Z가 앞, +Y가 위, +X가 오른쪽이다.
 * 작업 장치의 위치와 각도는 시뮬레이션의 자세 값을 그대로 쓴다.
 */
export class ExcavatorView {
  readonly chassis: TransformNode;
  readonly upper: TransformNode;
  private readonly boomNode: TransformNode;
  private readonly armNode: TransformNode;
  private readonly bucketNode: TransformNode;
  private readonly boomCyl: Mesh;
  private readonly armCyl: Mesh;
  private readonly bucketCyl: Mesh;
  private readonly soil: Mesh;
  private readonly soilPos: Float32Array;
  private readonly soilNormals: Float32Array;
  private readonly soilIdx: number[];
  private lastFill = -1;
  // 운전실 조종 장치
  private joyL!: TransformNode;
  private joyR!: TransformNode;
  private travelL!: TransformNode;
  private travelR!: TransformNode;
  private lockLever!: TransformNode;
  private dial!: Mesh;
  private lockKnob!: Mesh;
  private gripOn!: StandardMaterial;
  private gripOff!: StandardMaterial;
  private lockRed!: StandardMaterial;
  private lockGreen!: StandardMaterial;
  private readonly grips: Record<string, Mesh> = {};
  /** 이름표를 붙일 위치 */
  readonly anchors = {} as Record<CabPart, TransformNode>;

  constructor(
    scene: Scene,
    private readonly spec: ExcavatorSpec,
    shadows: ShadowGenerator,
  ) {
    const yellow = material(scene, 'yellow', 0.93, 0.66, 0.08);
    const dark = material(scene, 'dark', 0.14, 0.14, 0.15);
    const steel = material(scene, 'steel', 0.33, 0.34, 0.36);
    const rod = material(scene, 'rod', 0.78, 0.8, 0.82);
    const glass = material(scene, 'glass', 0.55, 0.75, 0.85, 0.3);
    const soilMat = material(scene, 'soil', 0.6, 0.42, 0.26);
    soilMat.specularColor = Color3.Black();
    soilMat.backFaceCulling = false;
    soilMat.twoSidedLighting = true;

    const cast = (m: Mesh) => {
      shadows.addShadowCaster(m);
      m.isPickable = false;
      return m;
    };
    const box = (
      name: string,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      mat: StandardMaterial,
      parent: TransformNode,
    ) => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z);
      m.material = mat;
      m.parent = parent;
      return cast(m);
    };

    // 하부 주행체
    this.chassis = new TransformNode('chassis', scene);
    const half = spec.trackGauge / 2;
    box('trackL', 0.55, 0.75, spec.trackLength, -half, 0.375, 0, dark, this.chassis);
    box('trackR', 0.55, 0.75, spec.trackLength, half, 0.375, 0, dark, this.chassis);
    box('carBody', spec.trackGauge - 0.5, 0.4, 2.0, 0, 0.6, 0, steel, this.chassis);
    // 앞쪽을 알 수 있게 궤도 앞에 표시를 둔다
    box('frontMark', spec.trackGauge + 0.3, 0.12, 0.12, 0, 0.3, spec.trackLength / 2 + 0.05, yellow, this.chassis);

    // 상부 선회체
    this.upper = new TransformNode('upper', scene);
    this.upper.parent = this.chassis;
    box('deck', 2.4, 0.15, 3.65, 0, 0.93, -0.58, steel, this.upper);
    box('engine', 2.4, 1.1, 2.25, 0, 1.55, -1.28, yellow, this.upper);
    box('counterweight', 2.4, 0.9, 0.5, 0, 1.45, -2.6, dark, this.upper);
    box('tank', 0.62, 0.6, 1.35, 0.89, 1.3, 0.52, yellow, this.upper);
    // 운전실: 왼쪽 앞. 유리는 반투명, 네 귀퉁이에 기둥
    const cabX = -0.72;
    const cabZ = 0.55;
    const cab = box('cab', 0.95, 1.6, 1.4, cabX, 1.8, cabZ, glass, this.upper);
    cab.visibility = 1;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box('pillar', 0.05, 1.6, 0.05, cabX + sx * 0.44, 1.8, cabZ + sz * 0.67, dark, this.upper);
      }
    }
    box('cabRoof', 1.0, 0.06, 1.45, cabX, 2.62, cabZ, dark, this.upper);
    box('cabBase', 0.95, 0.25, 1.4, cabX, 1.075, cabZ, yellow, this.upper);
    this.buildCabInterior(scene, cabX, steel, dark);

    // 붐
    this.boomNode = new TransformNode('boomNode', scene);
    this.boomNode.parent = this.upper;
    box('boom', 0.36, 0.5, spec.boomLen, 0, 0, spec.boomLen / 2, yellow, this.boomNode);

    // 암 (팔꿈치 뒤로 조금 튀어나온다)
    this.armNode = new TransformNode('armNode', scene);
    this.armNode.parent = this.upper;
    const tail = 0.75;
    box('arm', 0.3, 0.4, spec.armLen + tail, 0, 0, (spec.armLen - tail) / 2, yellow, this.armNode);

    // 버킷
    this.bucketNode = new TransformNode('bucketNode', scene);
    this.bucketNode.parent = this.upper;
    const bucketMat = material(scene, 'bucket', 0.22, 0.22, 0.24);
    bucketMat.backFaceCulling = false;
    bucketMat.twoSidedLighting = true;
    const bucket = this.buildBucket(scene);
    bucket.material = bucketMat;
    bucket.parent = this.bucketNode;
    cast(bucket);
    // 날(이빨) 줄
    const teeth = MeshBuilder.CreateBox('teeth', { width: spec.bucketWidth, height: 0.05, depth: 0.14 }, scene);
    teeth.position.set(0, 0.01, spec.bucketLen - 0.02);
    teeth.material = rod;
    teeth.parent = this.bucketNode;
    cast(teeth);

    // 버킷 안의 흙 (적재량에 따라 모양이 바뀐다)
    const np = BUCKET_PROFILE.length;
    this.soilPos = new Float32Array(np * 2 * 3);
    this.soilNormals = new Float32Array(np * 2 * 3);
    this.soilIdx = [];
    for (let i = 0; i < np - 1; i++) {
      const a = i * 2;
      this.soilIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.soil = new Mesh('bucketSoil', scene);
    const svd = new VertexData();
    svd.positions = this.soilPos;
    svd.normals = this.soilNormals;
    svd.indices = this.soilIdx;
    svd.applyToMesh(this.soil, true);
    this.soil.material = soilMat;
    this.soil.parent = this.bucketNode;
    this.soil.isPickable = false;
    this.soil.alwaysSelectAsActiveMesh = true;

    // 유압 실린더
    const strut = (name: string, dia: number) => {
      const m = MeshBuilder.CreateCylinder(name, { height: 1, diameter: dia, tessellation: 10 }, scene);
      m.material = rod;
      m.parent = this.upper;
      return cast(m);
    };
    this.boomCyl = strut('boomCyl', 0.16);
    this.armCyl = strut('armCyl', 0.14);
    this.bucketCyl = strut('bucketCyl', 0.12);
  }

  /**
   * 운전실 안: 좌석, 좌·우 조종 레버, 주행 레버와 페달, 안전레버, 계기판과 엔진 다이얼.
   * 크롤러 굴착기에는 자동차 같은 가속 페달이 없다. 엔진 회전은 다이얼로 맞춰 두고,
   * 발 페달은 주행 레버와 한 몸으로 움직이는 주행 페달이다.
   */
  private buildCabInterior(scene: Scene, cabX: number, steel: StandardMaterial, dark: StandardMaterial): void {
    const consoleMat = material(scene, 'console', 0.2, 0.21, 0.23);
    const seatMat = material(scene, 'seat', 0.12, 0.13, 0.16);
    this.gripOff = material(scene, 'grip', 0.06, 0.06, 0.07);
    this.gripOn = material(scene, 'gripOn', 1.0, 0.77, 0.19);
    this.gripOn.emissiveColor = new Color3(0.55, 0.4, 0.06);
    this.lockRed = material(scene, 'lockRed', 0.9, 0.16, 0.12);
    this.lockRed.emissiveColor = new Color3(0.4, 0.05, 0.04);
    this.lockGreen = material(scene, 'lockGreen', 0.2, 0.85, 0.4);
    this.lockGreen.emissiveColor = new Color3(0.05, 0.35, 0.12);
    const screenMat = material(scene, 'screen', 0.1, 0.2, 0.3);
    screenMat.emissiveColor = new Color3(0.08, 0.22, 0.32);
    const white = material(scene, 'pointer', 0.95, 0.95, 0.95);
    white.emissiveColor = new Color3(0.6, 0.6, 0.6);

    const part = (
      name: string,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      mat: StandardMaterial,
      parent: TransformNode,
    ) => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z);
      m.material = mat;
      m.parent = parent;
      m.isPickable = false;
      return m;
    };
    const cyl = (name: string, h: number, dTop: number, dBottom: number, mat: StandardMaterial, parent: TransformNode) => {
      const m = MeshBuilder.CreateCylinder(name, { height: h, diameterTop: dTop, diameterBottom: dBottom, tessellation: 12 }, scene);
      m.material = mat;
      m.parent = parent;
      m.isPickable = false;
      return m;
    };
    /** 밑동을 축으로 기울어지는 레버: 막대 + 손잡이 */
    const lever = (name: string, x: number, y: number, z: number, rodLen: number, rodDia: number, gripDia: number) => {
      const node = new TransformNode(name, scene);
      node.parent = this.upper;
      node.position.set(x, y, z);
      const rod = cyl(`${name}Rod`, rodLen, rodDia, rodDia, steel, node);
      rod.position.y = rodLen / 2;
      const grip = cyl(`${name}Grip`, 0.12, gripDia, gripDia * 0.85, this.gripOff, node);
      grip.position.y = rodLen + 0.04;
      this.grips[name] = grip;
      return node;
    };

    const floorY = 1.2;
    part('cabFloor', 0.9, 0.04, 1.36, cabX, floorY, 0.55, dark, this.upper);
    part('seat', 0.5, 0.12, 0.5, cabX, 1.6, 0.25, seatMat, this.upper);
    part('seatBack', 0.5, 0.62, 0.1, cabX, 1.95, -0.02, seatMat, this.upper);

    // 좌·우 조종대와 조종 레버
    const consoleTop = 1.62;
    for (const side of [-1, 1]) {
      part('console', 0.16, consoleTop - floorY, 0.62, cabX + side * 0.27, (consoleTop + floorY) / 2, 0.72, consoleMat, this.upper);
      const boot = cyl('boot', 0.07, 0.045, 0.11, dark, this.upper);
      boot.position.set(cabX + side * 0.25, consoleTop + 0.035, 0.98);
    }
    this.joyL = lever('joyL', cabX - 0.25, consoleTop + 0.03, 0.98, 0.2, 0.03, 0.062);
    this.joyR = lever('joyR', cabX + 0.25, consoleTop + 0.03, 0.98, 0.2, 0.03, 0.062);

    // 주행 레버와 페달 (좌·우 궤도). 레버와 페달은 한 몸으로 움직인다
    this.travelL = lever('travelL', cabX - 0.085, floorY + 0.02, 1.08, 0.56, 0.026, 0.046);
    this.travelR = lever('travelR', cabX + 0.085, floorY + 0.02, 1.08, 0.56, 0.026, 0.046);
    for (const [node, side] of [
      [this.travelL, -1],
      [this.travelR, 1],
    ] as const) {
      const pedal = part('pedal', 0.12, 0.02, 0.22, side * 0.07, 0.1, 0.0, steel, node);
      pedal.rotation.x = -0.6;
    }
    const mid = new TransformNode('travelMid', scene);
    mid.parent = this.upper;
    mid.position.set(cabX, floorY + 0.66, 1.08);

    // 안전레버: 세워져 있으면 잠김(빨강), 앞으로 눕히면 해제(초록)
    this.lockLever = new TransformNode('lockLever', scene);
    this.lockLever.parent = this.upper;
    this.lockLever.position.set(cabX - 0.38, consoleTop - 0.04, 1.0);
    const lockRod = cyl('lockRod', 0.2, 0.024, 0.024, steel, this.lockLever);
    lockRod.position.y = 0.1;
    this.lockKnob = MeshBuilder.CreateSphere('lockKnob', { diameter: 0.07, segments: 10 }, scene);
    this.lockKnob.position.y = 0.22;
    this.lockKnob.parent = this.lockLever;
    this.lockKnob.isPickable = false;

    // 오른쪽 앞 계기판: 화면과 엔진 다이얼
    const panel = new TransformNode('panel', scene);
    panel.parent = this.upper;
    panel.position.set(cabX + 0.37, 1.84, 1.14);
    panel.rotation.x = -0.9;
    part('panelBody', 0.2, 0.02, 0.28, 0, 0, 0, consoleMat, panel);
    part('monitor', 0.17, 0.012, 0.12, 0, 0.014, 0.065, screenMat, panel);
    this.dial = cyl('dial', 0.025, 0.075, 0.075, dark, panel);
    this.dial.position.set(0, 0.022, -0.075);
    part('dialPointer', 0.01, 0.008, 0.034, 0, 0.016, 0.016, white, this.dial);

    this.anchors.joyL = this.grips.joyL;
    this.anchors.joyR = this.grips.joyR;
    this.anchors.travel = mid;
    this.anchors.lock = this.lockKnob;
    this.anchors.dial = this.dial;
  }

  /** 레버 기울기, 안전레버, 엔진 다이얼을 운전실 조종 장치에 반영한다 */
  private syncControls(c: CabControls): void {
    const tilt = 0.32;
    const set = (node: TransformNode, name: string, x: number, y: number) => {
      node.rotation.x = y * tilt;
      node.rotation.z = -x * tilt;
      this.grips[name].material = Math.abs(x) > 0.05 || Math.abs(y) > 0.05 ? this.gripOn : this.gripOff;
    };
    set(this.joyL, 'joyL', c.levers.lx, c.levers.ly);
    set(this.joyR, 'joyR', c.levers.rx, c.levers.ry);
    set(this.travelL, 'travelL', 0, c.levers.tl * 0.8);
    set(this.travelR, 'travelR', 0, c.levers.tr * 0.8);
    this.lockLever.rotation.x = c.locked ? -0.45 : 1.05;
    this.lockKnob.material = c.locked ? this.lockRed : this.lockGreen;
    this.dial.rotation.y = (-135 + ((c.rpm - 1) / 9) * 270) * DEG;
  }

  /** 버킷 옆모습을 폭 방향으로 늘려 만든 껍데기. 지형을 깎는 윤곽과 같은 데이터다. */
  private buildBucket(scene: Scene): Mesh {
    const L = this.spec.bucketLen;
    const hw = this.spec.bucketWidth / 2;
    const pos: number[] = [];
    const idx: number[] = [];
    const np = BUCKET_PROFILE.length;
    // 바닥판
    for (const [c, n] of BUCKET_PROFILE) {
      pos.push(-hw, n * L, c * L, hw, n * L, c * L);
    }
    for (let i = 0; i < np - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    // 양쪽 옆판 (핀을 기준으로 부채꼴)
    for (const x of [-hw, hw]) {
      const base = pos.length / 3;
      for (const [c, n] of BUCKET_PROFILE) pos.push(x, n * L, c * L);
      const pivot = base + np - 1;
      for (let i = 0; i < np - 2; i++) idx.push(pivot, base + i, base + i + 1);
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, idx, normals);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.normals = normals;
    const mesh = new Mesh('bucket', scene);
    vd.applyToMesh(mesh);
    mesh.convertToFlatShadedMesh();
    return mesh;
  }

  private updateSoil(fill: number): void {
    if (Math.abs(fill - this.lastFill) < 0.004) return;
    this.lastFill = fill;
    this.soil.setEnabled(fill > 0.01);
    if (fill <= 0.01) return;
    const L = this.spec.bucketLen;
    const hw = this.spec.bucketWidth / 2 - 0.02;
    const level = Math.min(1, fill / 0.85);
    const heap = Math.max(0, (fill - 0.85) / 0.15);
    const np = BUCKET_PROFILE.length;
    for (let i = 0; i < np; i++) {
      const [c, n] = BUCKET_PROFILE[i];
      // 흙 표면: 바닥판에서 입구 쪽으로 차오르고, 가득 차면 입구 밖으로 수북해진다
      let y = n * (1 - level);
      if (i > 0 && i < np - 1) y -= 0.16 * heap;
      const k = i * 6;
      this.soilPos[k] = -hw;
      this.soilPos[k + 1] = y * L;
      this.soilPos[k + 2] = c * L;
      this.soilPos[k + 3] = hw;
      this.soilPos[k + 4] = y * L;
      this.soilPos[k + 5] = c * L;
    }
    VertexData.ComputeNormals(this.soilPos, this.soilIdx, this.soilNormals);
    this.soil.updateVerticesData(VertexBuffer.PositionKind, this.soilPos, false, false);
    this.soil.updateVerticesData(VertexBuffer.NormalKind, this.soilNormals, false, false);
  }

  /** (r0,y0) → (r1,y1)을 잇는 실린더를 놓는다. r은 앞 방향(+Z)이다. */
  private placeStrut(m: Mesh, x: number, r0: number, y0: number, r1: number, y1: number): void {
    const dr = r1 - r0;
    const dy = y1 - y0;
    m.position.set(x, (y0 + y1) / 2, (r0 + r1) / 2);
    m.scaling.y = Math.hypot(dr, dy);
    m.rotation.x = Math.PI / 2 - Math.atan2(dy, dr);
  }

  sync(sim: ExcavatorSim, controls?: CabControls): void {
    if (controls) this.syncControls(controls);
    const sp = this.spec;
    const p = sim.pose();
    const x = sp.latOffset;
    this.chassis.position.set(sim.x, sim.y, sim.z);
    this.chassis.rotation.y = sim.heading;
    // 경사진 현장에서는 차체를 지형에 맞춰 기울여 보여 준다 (계산에는 넣지 않고 보이는 것만)
    if (sim.site.shape) {
      const fx = Math.sin(sim.heading);
      const fz = Math.cos(sim.heading);
      const t = sim.terrain;
      const hf = t.heightAt(sim.x + fx * 1.6, sim.z + fz * 1.6);
      const hb = t.heightAt(sim.x - fx * 1.6, sim.z - fz * 1.6);
      const hr = t.heightAt(sim.x + fz * 1.1, sim.z - fx * 1.1);
      const hl = t.heightAt(sim.x - fz * 1.1, sim.z + fx * 1.1);
      this.chassis.rotation.x = -Math.atan2(hf - hb, 3.2);
      this.chassis.rotation.z = Math.atan2(hr - hl, 2.2);
    } else {
      this.chassis.rotation.x = 0;
      this.chassis.rotation.z = 0;
    }
    this.upper.rotation.y = sim.swing;

    this.boomNode.position.set(x, p.pivotY, p.pivotR);
    this.boomNode.rotation.x = -p.a1;
    this.armNode.position.set(x, p.elbowY, p.elbowR);
    this.armNode.rotation.x = -p.a2;
    this.bucketNode.position.set(x, p.wristY, p.wristR);
    this.bucketNode.rotation.x = -p.a3;
    this.updateSoil(sim.load / sp.bucketCapacity);

    const dir = (a: number, len: number): [number, number] => [Math.cos(a) * len, Math.sin(a) * len];

    // 붐 실린더: 차체 앞 아래 ↔ 붐 중간
    const [bbR, bbY] = dir(-sp.boom.phiC, sp.boom.b);
    const [baR, baY] = dir(p.a1, sp.boom.a);
    this.placeStrut(this.boomCyl, x, p.pivotR + bbR, p.pivotY + bbY, p.pivotR + baR, p.pivotY + baY);

    // 암 실린더: 붐 위쪽 ↔ 암 꼬리. 붐 윗면으로 살짝 띄운다
    const upR = -Math.sin(p.a1) * 0.34;
    const upY = Math.cos(p.a1) * 0.34;
    const [abR, abY] = dir(p.a1 + Math.PI, sp.arm.a);
    const [aaR, aaY] = dir(p.a2 + Math.PI - sp.arm.phiC, sp.arm.b);
    this.placeStrut(
      this.armCyl,
      x,
      p.elbowR + abR + upR,
      p.elbowY + abY + upY,
      p.elbowR + aaR + upR * 0.3,
      p.elbowY + aaY + upY * 0.3,
    );

    // 버킷 실린더: 암 바깥쪽 ↔ 버킷 링크
    const outR = -Math.sin(p.a2) * 0.27;
    const outY = Math.cos(p.a2) * 0.27;
    const [kbR, kbY] = dir(p.a2 + Math.PI, sp.bucket.a);
    const [kaR, kaY] = dir(p.a2 + Math.PI - sim.bucket.phi, sp.bucket.b);
    this.placeStrut(
      this.bucketCyl,
      x,
      p.wristR + kbR + outR,
      p.wristY + kbY + outY,
      p.wristR + kaR,
      p.wristY + kaY,
    );
  }
}
