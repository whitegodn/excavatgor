import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  FreeCamera,
  type Mesh,
  HemisphericLight,
  Matrix,
  MeshBuilder,
  ParticleSystem,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector2,
  Vector3,
} from '@babylonjs/core';
import type { Marker } from '../../curriculum/task';
import type { ExcavatorSim } from '../../equipment/excavator/excavatorSim';
import { type Site, type Zone, zoneAt } from '../../sites/site';
import { type CabControls, type CabPart, ExcavatorView } from './excavatorView';
import { TerrainView } from './terrainView';

export type CameraMode = 'cab' | 'ext';

/** 화면에 보이는 모든 것: 조명, 지형, 굴착기, 구역 표시, 카메라. */
export class World {
  readonly engine: Engine;
  readonly scene: Scene;
  cameraMode: CameraMode = 'ext';
  private terrainView: TerrainView;
  private readonly dropMarker: Mesh;
  private readonly dropMat: StandardMaterial;
  private readonly excavatorView: ExcavatorView;
  private readonly cabCam: FreeCamera;
  private readonly extCam: ArcRotateCamera;
  private readonly dust: ParticleSystem;
  private readonly dustEmitter = new Vector3();
  private markerMeshes: Mesh[] = [];
  private truckSoil: Mesh | null = null;
  private markerKey = '';
  private markerMats: Record<string, StandardMaterial> | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    sim: ExcavatorSim,
    private site: Site,
  ) {
    this.engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false });
    const scene = new Scene(this.engine);
    this.scene = scene;
    const sky = new Color3(0.66, 0.8, 0.93);
    scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = sky;
    scene.fogStart = 70;
    scene.fogEnd = 260;

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    // 두 조명의 합이 1을 넘으면 색이 하얗게 날아가고 그림자가 안 보인다
    hemi.intensity = 0.5;
    hemi.groundColor = new Color3(0.45, 0.42, 0.38);
    const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.35).normalize(), scene);
    sun.position = new Vector3(18, 40, -14);
    sun.intensity = 0.6;
    sun.autoCalcShadowZBounds = true;
    const shadows = new ShadowGenerator(2048, sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.bias = 0.002;
    shadows.normalBias = 0.02;
    shadows.darkness = 0.25;

    // 변형되는 지형과, 그 바깥의 넓은 바닥
    this.terrainView = new TerrainView(scene, sim.terrain);
    const outer = MeshBuilder.CreateGround('outer', { width: 600, height: 600 }, scene);
    outer.position.y = -0.03;
    const outerMat = new StandardMaterial('outerMat', scene);
    outerMat.diffuseColor = new Color3(0.8, 0.73, 0.56);
    outerMat.specularColor = Color3.Black();
    outer.material = outerMat;
    outer.isPickable = false;

    this.addScenery();
    this.buildSite();

    this.excavatorView = new ExcavatorView(scene, sim.spec, shadows);

    // 운전석 시점: 상부 선회체에 붙어 함께 돈다. 마우스로 둘러볼 수 있다
    // 앉은 눈높이. 아래쪽에 조종 레버가, 정면 아래에 주행 레버가 보이도록 조금 내려다본다
    this.cabCam = new FreeCamera('cab', new Vector3(-0.72, 2.3, 0.5), scene);
    this.cabCam.parent = this.excavatorView.upper;
    this.cabCam.rotation.set(0.33, 0.05, 0);
    this.cabCam.minZ = 0.05;
    this.cabCam.maxZ = 400;
    this.cabCam.fov = 1.2;
    this.cabCam.inputs.clear();
    this.cabCam.inputs.addMouse();

    // 외부 시점: 마우스로 돌리고 휠로 확대한다
    // 장비 오른쪽 뒤에서 본다. 정면의 굴착 구역과 왼쪽의 덤프 구역이 함께 보인다
    this.extCam = new ArcRotateCamera('ext', -Math.PI / 2 + 0.62, 0.95, 23, new Vector3(0, 1.2, 2), scene);
    // 아래쪽 레버 표시에 가리지 않게 장면을 화면 위쪽으로 올린다
    this.extCam.targetScreenOffset = new Vector2(0, 3.2);
    this.extCam.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    this.extCam.lowerRadiusLimit = 6;
    this.extCam.upperRadiusLimit = 45;
    this.extCam.upperBetaLimit = 1.5;
    this.extCam.wheelPrecision = 12;
    this.extCam.panningSensibility = 0;
    this.extCam.minZ = 0.2;
    this.extCam.maxZ = 500;
    scene.activeCamera = this.extCam;
    this.extCam.attachControl(canvas, true);

    // 흙이 떨어질 자리를 바닥에 표시한다. 버킷 높이를 가늠하는 데도 쓴다
    this.dropMat = new StandardMaterial('dropMat', scene);
    this.dropMat.disableLighting = true;
    this.dropMat.emissiveColor = Color3.White();
    this.dropMat.alpha = 0.75;
    this.dropMarker = MeshBuilder.CreateTorus('dropMarker', { diameter: 1.1, thickness: 0.09, tessellation: 28 }, scene);
    this.dropMarker.material = this.dropMat;
    this.dropMarker.isPickable = false;

    this.dust = this.createDust();
    window.addEventListener('resize', () => this.engine.resize());
    this.sync(sim);
  }

  private addZone(zone: Zone, color: Color3, name: string): void {
    const y = 0.04;
    const pts = [
      new Vector3(zone.x0, y, zone.z0),
      new Vector3(zone.x1, y, zone.z0),
      new Vector3(zone.x1, y, zone.z1),
      new Vector3(zone.x0, y, zone.z1),
      new Vector3(zone.x0, y, zone.z0),
    ];
    const lines = MeshBuilder.CreateLines(`${name}Lines`, { points: pts }, this.scene);
    lines.color = color;
    lines.isPickable = false;
    const mat = new StandardMaterial(`${name}PostMat`, this.scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.35);
    for (const p of pts.slice(0, 4)) {
      const post = MeshBuilder.CreateCylinder(`${name}Post`, { height: 1.1, diameter: 0.1 }, this.scene);
      post.position.set(p.x, 0.55, p.z);
      post.material = mat;
      post.isPickable = false;
    }
  }

  /** 선회·주행할 때 방향을 알 수 있게 주변에 기준이 되는 물체를 둔다. */
  private addScenery(): void {
    const scene = this.scene;
    const mk = (name: string, r: number, g: number, b: number) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = new Color3(r, g, b);
      m.specularColor = Color3.Black();
      return m;
    };
    const blue = mk('contBlue', 0.16, 0.36, 0.6);
    const red = mk('contRed', 0.62, 0.2, 0.16);
    const grey = mk('office', 0.82, 0.82, 0.78);
    const orange = mk('cone', 0.95, 0.4, 0.08);
    const place = (w: number, h: number, d: number, x: number, z: number, rot: number, mat: StandardMaterial) => {
      const b = MeshBuilder.CreateBox('prop', { width: w, height: h, depth: d }, scene);
      b.position.set(x, h / 2, z);
      b.rotation.y = rot;
      b.material = mat;
      b.isPickable = false;
    };
    place(2.4, 2.6, 6, 13, 22, 0.3, blue);
    place(2.4, 2.6, 6, -20, 14, 1.2, red);
    place(6, 2.8, 3, 22, -8, 0, grey);
    place(2.4, 2.6, 6, -6, -24, 1.57, blue);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const cone = MeshBuilder.CreateCylinder('cone', { height: 0.7, diameterTop: 0.05, diameterBottom: 0.36 }, scene);
      cone.position.set(Math.sin(a) * 14, 0.35, Math.cos(a) * 14);
      cone.material = orange;
      cone.isPickable = false;
    }
  }

  private createDust(): ParticleSystem {
    const tex = new DynamicTexture('dustTex', 32, this.scene, false);
    const ctx = tex.getContext();
    const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    tex.update();
    tex.hasAlpha = true;
    const ps = new ParticleSystem('dust', 900, this.scene);
    ps.particleTexture = tex;
    ps.emitter = this.dustEmitter;
    ps.minEmitBox = new Vector3(-0.45, -0.05, -0.2);
    ps.maxEmitBox = new Vector3(0.45, 0.05, 0.2);
    ps.color1 = new Color4(0.42, 0.3, 0.19, 1);
    ps.color2 = new Color4(0.5, 0.37, 0.24, 1);
    ps.colorDead = new Color4(0.45, 0.33, 0.22, 0);
    ps.minSize = 0.07;
    ps.maxSize = 0.2;
    ps.minLifeTime = 0.35;
    ps.maxLifeTime = 0.8;
    ps.gravity = new Vector3(0, -9.8, 0);
    ps.direction1 = new Vector3(-0.3, -0.4, -0.3);
    ps.direction2 = new Vector3(0.3, -1.2, 0.3);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 1.2;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 0;
    ps.start();
    return ps;
  }

  toggleCamera(): CameraMode {
    const next: CameraMode = this.cameraMode === 'ext' ? 'cab' : 'ext';
    const from = next === 'cab' ? this.extCam : this.cabCam;
    const to = next === 'cab' ? this.cabCam : this.extCam;
    from.detachControl();
    this.scene.activeCamera = to;
    to.attachControl(this.canvas, true);
    this.cameraMode = next;
    return next;
  }

  /** 현장마다 다른 것들: 구역 표시, 덤프트럭. 현장이 바뀌면 다시 만든다 */
  private buildSite(): void {
    const scene = this.scene;
    for (const m of scene.meshes.filter((x) => /^(dig|dump)(Lines|Post)$|^truck/.test(x.name))) m.dispose();
    this.truckSoil = null;
    const site = this.site;
    // 연습장의 컨테이너와 고깔은 넓은 코스에서는 치운다
    const yard = !site.shape && site.terrainSize <= 40;
    for (const m of scene.meshes) if (m.name === 'prop' || m.name === 'cone') m.setEnabled(yard);
    if (!site.hideZones) {
      this.addZone(site.digZone, new Color3(1, 0.85, 0.1), 'dig');
      if (!site.truck) this.addZone(site.dumpZone, new Color3(0.2, 0.55, 1), 'dump');
    }
    if (site.truck) {
      const z = site.dumpZone;
      const cx = (z.x0 + z.x1) / 2;
      const cz = (z.z0 + z.z1) / 2;
      const w = z.x1 - z.x0;
      const d = z.z1 - z.z0;
      const top = site.truck.bedTop;
      const floor = 1.0;
      const mat = (name: string, r: number, g: number, b: number) => {
        const m = new StandardMaterial(name, scene);
        m.diffuseColor = new Color3(r, g, b);
        m.specularColor = Color3.Black();
        return m;
      };
      const body = mat('truckBody', 0.2, 0.42, 0.75);
      const dark = mat('truckDark', 0.13, 0.13, 0.14);
      const part = (name: string, bw: number, bh: number, bd: number, x: number, y: number, zz: number, m: StandardMaterial) => {
        const mesh = MeshBuilder.CreateBox(name, { width: bw, height: bh, depth: bd }, scene);
        mesh.position.set(x, y, zz);
        mesh.material = m;
        mesh.isPickable = false;
        return mesh;
      };
      // 적재함: 바닥과 네 벽. 운전실은 적재함 뒤쪽(-Z)에 둔다
      part('truckFloor', w, 0.15, d, cx, floor, cz, body);
      part('truckWallL', 0.12, top - floor, d, z.x0, (top + floor) / 2, cz, body);
      part('truckWallR', 0.12, top - floor, d, z.x1, (top + floor) / 2, cz, body);
      part('truckWallF', w, top - floor, 0.12, cx, (top + floor) / 2, z.z1, body);
      part('truckWallB', w, top - floor, 0.12, cx, (top + floor) / 2, z.z0, body);
      part('truckCab', w * 0.95, 1.9, 1.6, cx, 1.55, z.z0 - 1.0, body);
      part('truckChassis', w * 0.7, 0.35, d + 2.2, cx, 0.75, cz - 0.9, dark);
      for (const wz of [z.z0 - 1.0, cz + d * 0.15, cz + d * 0.4]) {
        for (const wx of [z.x0 + 0.15, z.x1 - 0.15]) {
          const wheel = MeshBuilder.CreateCylinder('truckWheel', { height: 0.35, diameter: 1.0 }, scene);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(wx, 0.5, wz);
          wheel.material = dark;
          wheel.isPickable = false;
        }
      }
      // 실린 흙: 실을수록 높아진다
      const soil = part('truckSoil', w - 0.3, 1, d - 0.3, cx, floor + 0.08, cz, mat('truckSoilMat', 0.6, 0.42, 0.26));
      soil.setEnabled(false);
      this.truckSoil = soil;
    }
  }

  private markerMaterial(state: string): StandardMaterial {
    if (!this.markerMats) {
      const make = (name: string, r: number, g: number, b: number, alpha: number) => {
        const m = new StandardMaterial(name, this.scene);
        m.disableLighting = true;
        m.emissiveColor = new Color3(r, g, b);
        m.alpha = alpha;
        m.backFaceCulling = false;
        return m;
      };
      this.markerMats = {
        active: make('mkActive', 1, 0.82, 0.15, 0.5),
        todo: make('mkTodo', 1, 1, 1, 0.16),
        done: make('mkDone', 0.3, 0.9, 0.45, 0.12),
        pole: make('mkPole', 1, 0.1, 0.55, 1),
        rope: make('mkRope', 1, 0.1, 0.55, 1),
      };
    }
    return this.markerMats[state];
  }

  /**
   * 과제의 표지를 3D 화면에 놓는다: 목표 공(지금 것은 노랑), 장애물 줄.
   * 표지의 구성이 바뀔 때만 다시 만들고, 평소에는 색만 바꾼다.
   */
  syncMarkers(markers: readonly Marker[]): void {
    const key = markers
      .map((m) => (m.kind === 'target' ? `t${m.x.toFixed(2)},${m.y.toFixed(2)},${m.z.toFixed(2)}` : `b${m.x1},${m.z1},${m.x2},${m.z2}`))
      .join('|');
    if (key !== this.markerKey) {
      for (const mesh of this.markerMeshes) mesh.dispose();
      this.markerMeshes = [];
      this.markerKey = key;
      for (const m of markers) {
        if (m.kind === 'target') {
          const ball = MeshBuilder.CreateSphere('target', { diameter: m.radius * 2, segments: 16 }, this.scene);
          ball.position.set(m.x, m.y, m.z);
          ball.isPickable = false;
          // 공이 얼마나 높이 있는지 알 수 있게 바닥까지 가는 기둥을 세운다
          const stem = MeshBuilder.CreateCylinder('targetStem', { height: 1, diameter: 0.05 }, this.scene);
          stem.scaling.y = m.y;
          stem.position.set(m.x, m.y / 2, m.z);
          stem.isPickable = false;
          this.markerMeshes.push(ball, stem);
        } else {
          for (const [x, z] of [
            [m.x1, m.z1],
            [m.x2, m.z2],
          ]) {
            const pole = MeshBuilder.CreateCylinder('pole', { height: m.height + 0.3, diameter: 0.22 }, this.scene);
            pole.position.set(x, (m.height + 0.3) / 2, z);
            pole.material = this.markerMaterial('pole');
            pole.isPickable = false;
            this.markerMeshes.push(pole);
          }
          const rope = MeshBuilder.CreateTube(
            'rope',
            { path: [new Vector3(m.x1, m.height, m.z1), new Vector3(m.x2, m.height, m.z2)], radius: 0.1 },
            this.scene,
          );
          rope.material = this.markerMaterial('rope');
          rope.isPickable = false;
          this.markerMeshes.push(rope);
        }
      }
    }
    let i = 0;
    for (const m of markers) {
      if (m.kind === 'target') {
        const mat = this.markerMaterial(m.state);
        this.markerMeshes[i].material = mat;
        this.markerMeshes[i + 1].material = mat;
        this.markerMeshes[i + 1].setEnabled(m.state === 'active');
        i += 2;
      } else {
        i += 3;
      }
    }
  }

  /** 새 훈련을 시작할 때: 지형을 새 시뮬레이션의 것으로 바꾼다 */
  setSim(sim: ExcavatorSim): void {
    this.terrainView.mesh.dispose();
    this.terrainView = new TerrainView(this.scene, sim.terrain);
    if (sim.site !== this.site) {
      this.site = sim.site;
      this.buildSite();
    }
    this.sync(sim);
  }

  /** 운전석 시점일 때 조종 장치들이 화면 어디에 보이는지(CSS 픽셀). 다른 시점이면 빈 목록 */
  cabTags(): { id: CabPart; x: number; y: number }[] {
    if (this.cameraMode !== 'cab') return [];
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const scale = this.canvas.clientWidth / w;
    const viewport = this.cabCam.viewport.toGlobal(w, h);
    const transform = this.scene.getTransformMatrix();
    const out: { id: CabPart; x: number; y: number }[] = [];
    for (const id of Object.keys(this.excavatorView.anchors) as CabPart[]) {
      const pos = this.excavatorView.anchors[id].getAbsolutePosition();
      const p = Vector3.Project(pos, Matrix.IdentityReadOnly, transform, viewport);
      if (p.z < 0 || p.z > 1) continue;
      out.push({ id, x: p.x * scale, y: p.y * scale });
    }
    return out;
  }

  /** 시뮬레이션 상태를 화면에 반영한다. */
  sync(sim: ExcavatorSim, controls?: CabControls): void {
    this.terrainView.sync();
    this.excavatorView.sync(sim, controls);
    const p = sim.pose();
    const tipX = p.baseX + p.fwdX * p.tipR;
    const tipZ = p.baseZ + p.fwdZ * p.tipR;
    const zone = zoneAt(this.site, tipX, tipZ);
    const truck = this.site.truck;
    // 덤프트럭 위에서는 낙하 지점을 적재함 윗면에 표시한다
    const markY = truck && zone === 'dump' ? truck.bedTop : sim.terrain.heightAt(tipX, tipZ);
    this.dropMarker.position.set(tipX, markY + 0.06, tipZ);
    if (this.truckSoil && truck) {
      const fill = Math.min(1, sim.truckLoad / truck.capacity);
      this.truckSoil.setEnabled(fill > 0.005);
      const h = Math.max(0.02, fill * 1.4);
      this.truckSoil.scaling.y = h;
      this.truckSoil.position.y = 1.08 + h / 2;
    }
    // 흰색: 빈 버킷, 초록: 여기에 쏟으면 됨, 빨강: 여기에 쏟으면 흘림
    if (sim.load < 0.03) this.dropMat.emissiveColor.set(1, 1, 1);
    else if (zone === 'dump') this.dropMat.emissiveColor.set(0.25, 1, 0.45);
    else if (zone === 'dig') this.dropMat.emissiveColor.set(1, 0.85, 0.2);
    else this.dropMat.emissiveColor.set(1, 0.25, 0.2);
    // 외부 카메라는 장비를 따라간다
    const fx = Math.sin(sim.heading + sim.swing);
    const fz = Math.cos(sim.heading + sim.swing);
    this.extCam.target.set(sim.x + fx * 2.5, sim.y + 1.2, sim.z + fz * 2.5);
    if (sim.dropRate > 0) {
      this.dustEmitter.set(sim.dropX, sim.dropY, sim.dropZ);
      this.dust.emitRate = Math.min(700, 250 + sim.dropRate * 900);
    } else {
      this.dust.emitRate = 0;
    }
  }

  render(): void {
    this.scene.render();
  }
}
