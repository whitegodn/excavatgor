import { Color3, DynamicTexture, type Material, type Mesh, MeshBuilder, type Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import type { Site } from '../../sites/site';
import { photoMaterial, placeProps, planarUV, type PropSpot } from './assets';

/**
 * 현장의 배경: 도로, 건물, 가로등, 나무, 공사장 울타리와 자재, 작업자.
 * 보기만 하는 것들이다. 부딪히는 판정은 없으므로 주행 경로와 작업 반경에서 떨어뜨려 놓는다.
 * 같은 현장은 언제나 같은 모습이 되도록 정해진 씨앗의 난수를 쓴다.
 */

type Ground = (x: number, z: number) => number;
interface Pt {
  x: number;
  z: number;
}

const PREFIX = 'sc_';
/** 현장이 바뀔 때마다 올라간다. 늦게 읽힌 모델이 다른 현장에 놓이지 않게 한다 */
let generation = 0;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 점에서 꺾은선(경로)까지의 가장 가까운 거리 */
function distToPath(x: number, z: number, path: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}

/** 경로를 따라 step(m)마다 한 점씩: 위치와 진행 방향 */
function alongPath(path: readonly Pt[], step: number): { x: number; z: number; nx: number; nz: number; yaw: number }[] {
  const out = [];
  let carry = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    for (let d = carry; d < len; d += step) {
      out.push({ x: a.x + ux * d, z: a.z + uz * d, nx: uz, nz: -ux, yaw: Math.atan2(ux, uz) });
    }
    carry = (carry - len) % step;
    if (carry < 0) carry += step;
  }
  return out;
}

interface PropJob {
  spots: PropSpot[];
  part?: string;
  /** 모델을 읽지 못했을 때 코드로 대신 그리는 함수들 */
  fallback: (() => void)[];
}

class Kit {
  private readonly jobs = new Map<string, PropJob>();

  constructor(
    readonly scene: Scene,
    readonly ground: Ground,
  ) {}

  /** 사진 질감 재질. tint를 주면 그 색을 입힌다 */
  photo(name: string, asset: string, tile = 1, tint?: Color3): Material {
    return photoMaterial(this.scene, `${PREFIX}pm_${name}`, asset, tile, tint);
  }

  /**
   * 사진으로 만든 소품 모델을 땅 위에 놓는다. 모델은 나중에 한꺼번에 읽는다(flush).
   * 읽지 못하면 fallback으로 대신 그린다.
   */
  prop(asset: string, x: number, z: number, yaw: number, scale: number, fallback?: () => void, part?: string): void {
    const key = part ? `${asset}#${part}` : asset;
    let job = this.jobs.get(key);
    if (!job) {
      job = { spots: [], part, fallback: [] };
      this.jobs.set(key, job);
    }
    job.spots.push({ x, y: this.ground(x, z), z, yaw, scale });
    if (fallback) job.fallback.push(fallback);
  }

  /** 모아 둔 소품을 읽어서 놓는다 */
  flush(): void {
    const mine = generation;
    for (const [key, job] of this.jobs) {
      const asset = key.split('#')[0];
      placeProps(this.scene, asset, job.spots, PREFIX, () => mine === generation, job.part).catch(() => {
        if (mine === generation) for (const f of job.fallback) f();
      });
    }
    this.jobs.clear();
  }

  mat(name: string, r: number, g: number, b: number, glow = 0): StandardMaterial {
    const id = `${PREFIX}m_${name}`;
    const found = this.scene.getMaterialByName(id) as StandardMaterial | null;
    if (found) return found;
    const m = new StandardMaterial(id, this.scene);
    m.diffuseColor = new Color3(r, g, b);
    m.specularColor = Color3.Black();
    if (glow > 0) m.emissiveColor = new Color3(r * glow, g * glow, b * glow);
    return m;
  }

  /** 창문이 그려진 건물 벽 */
  wall(name: string, base: string, glass: string): StandardMaterial {
    const id = `${PREFIX}m_${name}`;
    const found = this.scene.getMaterialByName(id) as StandardMaterial | null;
    if (found) return found;
    const tex = new DynamicTexture(`${id}_t`, { width: 128, height: 256 }, this.scene, true);
    const ctx = tex.getContext();
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 256);
    ctx.fillStyle = glass;
    for (let row = 0; row < 7; row++) for (let col = 0; col < 3; col++) ctx.fillRect(14 + col * 38, 16 + row * 34, 24, 20);
    tex.update();
    const m = new StandardMaterial(id, this.scene);
    m.diffuseTexture = tex;
    m.specularColor = Color3.Black();
    return m;
  }

  /** 글씨가 적힌 판 */
  sign(text: string, bg: string, fg: string): StandardMaterial {
    const id = `${PREFIX}m_sign_${text}`;
    const found = this.scene.getMaterialByName(id) as StandardMaterial | null;
    if (found) return found;
    const tex = new DynamicTexture(`${id}_t`, { width: 512, height: 128 }, this.scene, true);
    tex.drawText(text, null, 88, "bold 64px 'Malgun Gothic', sans-serif", fg, bg, true);
    const m = new StandardMaterial(id, this.scene);
    m.diffuseTexture = tex;
    m.emissiveColor = new Color3(0.35, 0.35, 0.35);
    m.specularColor = Color3.Black();
    m.backFaceCulling = false;
    return m;
  }

  private place(m: Mesh, x: number, y: number, z: number, mat: Material, yaw: number): Mesh {
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.material = mat;
    m.isPickable = false;
    return m;
  }

  /** 땅 위에 놓는 상자. lift만큼 띄울 수 있다 */
  box(w: number, h: number, d: number, x: number, z: number, mat: Material, yaw = 0, lift = 0): Mesh {
    const m = MeshBuilder.CreateBox(`${PREFIX}box`, { width: w, height: h, depth: d }, this.scene);
    return this.place(m, x, this.ground(x, z) + h / 2 + lift, z, mat, yaw);
  }

  cyl(h: number, dTop: number, dBottom: number, x: number, z: number, mat: Material, lift = 0): Mesh {
    const m = MeshBuilder.CreateCylinder(`${PREFIX}cyl`, { height: h, diameterTop: dTop, diameterBottom: dBottom, tessellation: 10 }, this.scene);
    return this.place(m, x, this.ground(x, z) + h / 2 + lift, z, mat, 0);
  }

  ball(dia: number, x: number, z: number, mat: Material, lift: number): Mesh {
    const m = MeshBuilder.CreateSphere(`${PREFIX}ball`, { diameter: dia, segments: 8 }, this.scene);
    return this.place(m, x, this.ground(x, z) + lift, z, mat, 0);
  }
}

/** 경로를 따라 깔리는 길. 지형의 높낮이를 따라간다 */
function road(kit: Kit, path: readonly Pt[], width: number, surface: Material, dashes: Material | null): void {
  const pts = alongPath(path, 2);
  if (pts.length < 2) return;
  const left: Vector3[] = [];
  const right: Vector3[] = [];
  for (const p of pts) {
    const lx = p.x - p.nx * (width / 2);
    const lz = p.z - p.nz * (width / 2);
    const rx = p.x + p.nx * (width / 2);
    const rz = p.z + p.nz * (width / 2);
    left.push(new Vector3(lx, kit.ground(lx, lz) + 0.04, lz));
    right.push(new Vector3(rx, kit.ground(rx, rz) + 0.04, rz));
  }
  const ribbon = MeshBuilder.CreateRibbon(`${PREFIX}road`, { pathArray: [left, right], sideOrientation: 2 }, kit.scene);
  // 길이 꺾여도 무늬가 늘어나지 않게 위에서 본 좌표로 입힌다 (4m마다 되풀이)
  planarUV(ribbon, 4);
  ribbon.material = surface;
  ribbon.isPickable = false;
  ribbon.receiveShadows = true;
  if (dashes) {
    pts.forEach((p, i) => {
      if (i % 3 === 0) kit.box(0.16, 0.02, 1.6, p.x, p.z, dashes, p.yaw, 0.05);
    });
  }
}

function tree(kit: Kit, x: number, z: number, size: number): void {
  kit.cyl(1.6 * size, 0.22 * size, 0.3 * size, x, z, kit.mat('trunk', 0.36, 0.25, 0.16));
  kit.cyl(3.2 * size, 0.05, 2.2 * size, x, z, kit.mat('leaf', 0.2, 0.45, 0.22), 1.3 * size);
}

function lamp(kit: Kit, x: number, z: number, yaw: number): void {
  const pole = kit.mat('pole', 0.3, 0.32, 0.35);
  kit.cyl(5.5, 0.1, 0.16, x, z, pole);
  kit.box(0.12, 0.1, 1.5, x + Math.sin(yaw) * 0.7, z + Math.cos(yaw) * 0.7, pole, yaw, 5.4);
  kit.box(0.3, 0.1, 0.5, x + Math.sin(yaw) * 1.3, z + Math.cos(yaw) * 1.3, kit.mat('lampGlow', 1, 0.95, 0.7, 0.8), yaw, 5.32);
}

function car(kit: Kit, x: number, z: number, yaw: number, color: Material): void {
  kit.box(1.8, 0.7, 4.2, x, z, color, yaw, 0.35);
  kit.box(1.6, 0.6, 2.2, x - Math.sin(yaw) * 0.2, z - Math.cos(yaw) * 0.2, kit.mat('carGlass', 0.25, 0.32, 0.4), yaw, 1.05);
}

/** 작업자: 안전모와 조끼 */
function worker(kit: Kit, x: number, z: number): void {
  kit.cyl(0.85, 0.3, 0.26, x, z, kit.mat('pants', 0.18, 0.22, 0.32));
  kit.cyl(0.65, 0.38, 0.34, x, z, kit.mat('vest', 1, 0.5, 0.05, 0.25), 0.85);
  kit.ball(0.26, x, z, kit.mat('skin', 0.85, 0.68, 0.55), 1.64);
  kit.ball(0.3, x, z, kit.mat('helmet', 1, 0.85, 0.1, 0.2), 1.74);
}

/** 사진 모델은 삼각형이 많다(가로등 3만, 바위 6만 6천, 방호벽 6만 1천). 현장마다 이 개수까지만 놓는다 */
const MAX_PHOTO_LAMPS = 5;
const MAX_PHOTO_ROCKS = 4;

/** 길 양옆의 건물·가로등·가로수·세워 둔 차 */
function street(kit: Kit, path: readonly Pt[], rand: () => number, dense: boolean): void {
  const walls = [
    kit.wall('wallA', '#b9b2a5', '#5f7d96'),
    kit.wall('wallB', '#8f9aa6', '#33485c'),
    kit.wall('wallC', '#c79a78', '#6b5a4e'),
    kit.wall('wallD', '#d8d4cc', '#7fa3b8'),
  ];
  const cars = [kit.mat('carRed', 0.7, 0.16, 0.14), kit.mat('carWhite', 0.9, 0.9, 0.9), kit.mat('carBlue', 0.15, 0.3, 0.6), kit.mat('carGrey', 0.4, 0.42, 0.45)];
  const used: Pt[] = [];
  const free = (x: number, z: number, gap: number) => used.every((u) => Math.hypot(u.x - x, u.z - z) > gap);

  // 외부 시점의 카메라는 장비에서 19m쯤 떨어져 13m 높이에 있다.
  // 그 사이를 가리지 않게, 길 가까이에는 낮은 상가만 두고 높은 건물은 멀리 세운다
  const shop = [kit.mat('shopA', 0.78, 0.7, 0.58), kit.mat('shopB', 0.62, 0.68, 0.72), kit.mat('shopC', 0.72, 0.56, 0.5)];
  const awning = [kit.mat('awnA', 0.8, 0.2, 0.18), kit.mat('awnB', 0.15, 0.45, 0.35), kit.mat('awnC', 0.2, 0.3, 0.6)];
  alongPath(path, 11).forEach((p) => {
    for (const side of [-1, 1]) {
      if (rand() < 0.3) continue;
      const w = 5 + rand() * 4;
      const x = p.x + p.nx * side * 11.5;
      const z = p.z + p.nz * side * 11.5;
      if (distToPath(x, z, path) < 9.5 || !free(x, z, 7)) continue;
      used.push({ x, z });
      kit.box(w, 3 + rand() * 1.2, 5, x, z, shop[Math.floor(rand() * shop.length)], p.yaw);
      kit.box(w, 0.25, 1.2, x - p.nx * side * 3, z - p.nz * side * 3, awning[Math.floor(rand() * awning.length)], p.yaw, 2.4);
    }
  });
  alongPath(path, dense ? 8 : 15).forEach((p) => {
    for (const side of [-1, 1]) {
      const w = 7 + rand() * 6;
      const d = 7 + rand() * 5;
      const h = dense ? 9 + rand() * 20 : 5 + rand() * 6;
      const off = 23 + d / 2 + rand() * 9;
      const x = p.x + p.nx * side * off;
      const z = p.z + p.nz * side * off;
      // 길이 꺾이는 곳에서는 건물이 길 가까이 오지 않게 건너뛴다
      if (distToPath(x, z, path) < 21 || !free(x, z, 10)) continue;
      used.push({ x, z });
      kit.box(w, h, d, x, z, walls[Math.floor(rand() * walls.length)], p.yaw);
    }
  });
  let photoLamps = 0;
  alongPath(path, 14).forEach((p, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const lx = p.x + p.nx * side * 4.6;
    const lz = p.z + p.nz * side * 4.6;
    if (distToPath(lx, lz, path) > 4) {
      const yaw = Math.atan2(-p.nx * side, -p.nz * side);
      // 출발 지점 가까운 가로등 몇 개만 사진 모델로 세운다 (모델 하나가 삼각형 3만 개)
      if (photoLamps < MAX_PHOTO_LAMPS) {
        photoLamps++;
        kit.prop('street_lamp_01', lx, lz, yaw, 1.4, () => lamp(kit, lx, lz, yaw));
      } else lamp(kit, lx, lz, yaw);
    }
    const tx = p.x - p.nx * side * 5.4;
    const tz = p.z - p.nz * side * 5.4;
    if (distToPath(tx, tz, path) > 4.5) tree(kit, tx, tz, 0.5 + rand() * 0.2);
  });
  alongPath(path, 23).forEach((p, i) => {
    if (i === 0 || rand() < 0.35) return;
    const side = rand() < 0.5 ? 1 : -1;
    const x = p.x + p.nx * side * 6.6;
    const z = p.z + p.nz * side * 6.6;
    if (distToPath(x, z, path) > 5.5 && free(x, z, 4)) car(kit, x, z, p.yaw, cars[Math.floor(rand() * cars.length)]);
  });
}

/** 공사 현장: 가설 울타리, 현장 사무실, 자재, 안내판, 작업자, 멀리 타워크레인 */
function construction(kit: Kit, site: Site): void {
  const half = site.terrainSize / 2 - 0.6;
  // 가설 울타리: 골함석 사진에 주황·흰색을 입힌다
  const panelA = kit.photo('fenceA', 'corrugated_iron', 1, new Color3(1.9, 0.95, 0.25));
  const panelB = kit.photo('fenceB', 'corrugated_iron', 1, new Color3(1.8, 1.8, 1.75));
  let n = 0;
  for (let t = -half + 1; t < half; t += 2) {
    const m = n++ % 2 === 0 ? panelA : panelB;
    kit.box(1.9, 1.8, 0.08, t, half, m);
    kit.box(1.9, 1.8, 0.08, t, -half, m);
    kit.box(0.08, 1.8, 1.9, half, t, m);
    kit.box(0.08, 1.8, 1.9, -half, t, m);
  }
  // 현장 사무실(2층 컨테이너)과 간이 화장실: 오른쪽 앞 구석.
  // 외부 시점의 카메라가 오른쪽 뒤에 있으므로 그쪽 구석은 비워 둔다
  const office = kit.mat('office', 0.85, 0.86, 0.82);
  const ox = half - 5;
  const oz = half - 4;
  kit.box(6, 2.6, 2.6, ox, oz, office);
  kit.box(6, 2.6, 2.6, ox, oz, kit.mat('office2', 0.3, 0.5, 0.7), 0, 2.6);
  kit.box(1.2, 2.3, 1.2, ox - 5, oz, kit.mat('toilet', 0.2, 0.55, 0.5));
  // 자재: 관 더미, 철근 다발, 흙 포대
  const pipe = kit.photo('pipe', 'rust_coarse_01', 2, new Color3(1.5, 1.45, 1.4));
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const p = MeshBuilder.CreateCylinder(`${PREFIX}pipe`, { height: 5, diameter: 0.7, tessellation: 12 }, kit.scene);
      p.rotation.x = Math.PI / 2;
      p.position.set(-half + 4 + i * 0.72 + row * 0.36, 0.36 + row * 0.62, -half + 5);
      p.material = pipe;
      p.isPickable = false;
    }
  }
  kit.box(0.5, 0.3, 6, -half + 9, -half + 4, kit.photo('rebar', 'rust_coarse_01', 1));
  // 드럼통 몇 개와 콘크리트 방호벽 (사진 모델)
  const barrels: [number, number][] = [[11, 6], [11.8, 6.3], [11.3, 7], [12.4, 5.6], [13.2, 6.6]];
  barrels.forEach(([dx, dz], i) => kit.prop('barrel_03', -half + dx, -half + dz, i * 1.3, 1));
  for (let i = 0; i < 3; i++) kit.prop('concrete_road_barrier', -1.6 + i * 1.6, half - 3.2, 0, 1);
  for (let i = 0; i < 5; i++) kit.box(0.9, 0.5, 0.6, -half + 3 + (i % 3), -half + 9 + Math.floor(i / 3) * 0.7, kit.mat('sack', 0.8, 0.76, 0.62), 0, Math.floor(i / 3) * 0.02);
  // 안내판
  const board = MeshBuilder.CreatePlane(`${PREFIX}sign`, { width: 6, height: 1.5 }, kit.scene);
  board.position.set(0, 2.6, half - 0.2);
  board.material = kit.sign('공사중 · 안전제일', '#ffc531', '#1a1a1a');
  board.isPickable = false;
  kit.cyl(2, 0.1, 0.1, -2.7, half - 0.2, kit.mat('pole', 0.3, 0.32, 0.35));
  kit.cyl(2, 0.1, 0.1, 2.7, half - 0.2, kit.mat('pole', 0.3, 0.32, 0.35));
  // 작업자: 선회 반경 밖에서 지켜본다
  worker(kit, half - 3, half - 9);
  worker(kit, half - 3.8, half - 10);
  worker(kit, -half + 7, half - 3);
  // 멀리 보이는 타워크레인과 짓는 중인 건물
  const steel = kit.mat('crane', 0.95, 0.75, 0.1);
  kit.box(1.2, 34, 1.2, half + 26, half + 30, steel);
  kit.box(26, 1, 1, half + 20, half + 30, steel, 0, 32);
  kit.box(16, 14, 12, half + 6, half + 34, kit.wall('wallB', '#8f9aa6', '#33485c'));
  kit.box(14, 9, 12, -half - 12, half + 30, kit.mat('frame', 0.6, 0.6, 0.58));
}

/** 언덕: 나무와 바위, 흙길 */
function hills(kit: Kit, site: Site, path: readonly Pt[], rand: () => number): void {
  road(kit, path, 4.5, kit.mat('dirt', 0.55, 0.45, 0.32), null);
  const half = site.terrainSize / 2 - 3;
  const rock = kit.mat('rock', 0.5, 0.5, 0.48);
  let photoRocks = 0;
  for (let i = 0; i < 170; i++) {
    const x = (rand() * 2 - 1) * half;
    const z = (rand() * 2 - 1) * half;
    const near = distToPath(x, z, path);
    if (near < 4) continue;
    const pick = rand();
    if (near < 14) {
      // 길 가까이는 시야를 가리지 않는 덤불과 바위만
      if (pick < 0.6) kit.ball(1.1 + rand() * 0.8, x, z, kit.mat('bush', 0.25, 0.45, 0.22), 0.25);
      else {
        const dia = 0.7 + rand() * 0.8;
        if (photoRocks < MAX_PHOTO_ROCKS && near < 9) {
          photoRocks++;
          kit.prop('boulder_01', x, z, rand() * 6.28, dia * 0.8, () => kit.ball(dia, x, z, rock, 0.1));
        } else kit.ball(dia, x, z, rock, 0.1);
      }
    } else if (pick < 0.8) tree(kit, x, z, 0.8 + rand() * 0.9);
    else kit.ball(0.9 + rand() * 1.4, x, z, rock, 0.1);
  }
}

export function disposeScenery(scene: Scene): void {
  generation++;
  for (const m of scene.meshes.filter((x) => x.name.startsWith(PREFIX))) m.dispose();
  for (const n of scene.transformNodes.filter((x) => x.name.startsWith(PREFIX))) n.dispose();
}

/** 현장에 정해진 배경을 만든다. 먼저 있던 배경은 치운다 */
export function buildScenery(scene: Scene, site: Site, ground: Ground): void {
  disposeScenery(scene);
  if (!site.scenery) return;
  const kit = new Kit(scene, ground);
  const rand = rng(site.terrainSize * 131 + site.name.length * 17);
  const path: Pt[] = [{ x: site.start.x, z: site.start.z }, ...(site.route ?? [])];
  if (site.scenery === 'construction') construction(kit, site);
  else if (site.scenery === 'hills') hills(kit, site, path, rand);
  else {
    road(kit, path, 7, kit.photo('asphalt', 'asphalt_02', 1, new Color3(1.5, 1.5, 1.55)), kit.mat('paint', 0.95, 0.95, 0.9, 0.3));
    street(kit, path, rand, site.scenery === 'city');
    // 출발선
    const s = alongPath(path, 2)[0];
    if (s) kit.box(7, 0.02, 0.6, s.x, s.z, kit.mat('paint', 0.95, 0.95, 0.9, 0.3), s.yaw, 0.06);
  }
  kit.flush();
}
