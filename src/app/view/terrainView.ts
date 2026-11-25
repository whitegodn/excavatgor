import { Mesh, type Scene, StandardMaterial, Color3, VertexBuffer, VertexData } from '@babylonjs/core';
import type { Terrain } from '../../core/terrain/terrain';
import { applySoil } from './atmosphere';

/** 격자점 번호로 만드는 고정 잡음(0..1). 땅 색에 얼룩을 넣어 움직임이 보이게 한다. */
function noise(i: number, j: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** 높이맵 지형을 그리는 메시. 바뀐 부분만 다시 계산한다. */
export class TerrainView {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly colors: Float32Array;

  constructor(
    scene: Scene,
    private readonly terrain: Terrain,
  ) {
    const n = terrain.n;
    this.positions = new Float32Array(n * n * 3);
    this.normals = new Float32Array(n * n * 3);
    this.colors = new Float32Array(n * n * 4);
    const indices = new Uint32Array((n - 1) * (n - 1) * 6);
    let q = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        indices[q++] = a;
        indices[q++] = a + 1;
        indices[q++] = a + n;
        indices[q++] = a + 1;
        indices[q++] = a + n + 1;
        indices[q++] = a + n;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = (j * n + i) * 3;
        this.positions[k] = terrain.minX + i * terrain.cell;
        this.positions[k + 2] = terrain.minZ + j * terrain.cell;
      }
    }
    // 흙 무늬는 3m마다 되풀이된다
    const uvs = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        uvs[(j * n + i) * 2] = (i * terrain.cell) / 3;
        uvs[(j * n + i) * 2 + 1] = (j * terrain.cell) / 3;
      }
    }
    this.refresh(0, n - 1, 0, n - 1);

    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.colors = this.colors;
    vd.uvs = uvs;
    vd.indices = indices;
    this.mesh = new Mesh('terrain', scene);
    vd.applyToMesh(this.mesh, true);
    const mat = new StandardMaterial('terrainMat', scene);
    mat.specularColor = Color3.Black();
    applySoil(mat, scene, 1);
    mat.backFaceCulling = false;
    mat.twoSidedLighting = true;
    this.mesh.material = mat;
    this.mesh.receiveShadows = true;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
  }

  private refresh(i0: number, i1: number, j0: number, j1: number): void {
    const t = this.terrain;
    const n = t.n;
    const h = t.h;
    const inv = 1 / (2 * t.cell);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const idx = j * n + i;
        const k = idx * 3;
        const y = h[idx];
        this.positions[k + 1] = y;
        const hl = h[i > 0 ? idx - 1 : idx];
        const hr = h[i < n - 1 ? idx + 1 : idx];
        const hd = h[j > 0 ? idx - n : idx];
        const hu = h[j < n - 1 ? idx + n : idx];
        const nx = -(hr - hl) * inv;
        const nz = -(hu - hd) * inv;
        const len = Math.hypot(nx, 1, nz);
        this.normals[k] = nx / len;
        this.normals[k + 1] = 1 / len;
        this.normals[k + 2] = nz / len;

        // 색: 원지반(다진 흙) / 깎인 면(짙은 흙) / 풀린 흙(붉은 갈색)
        const loose = t.loose[idx];
        let r = 0.8;
        let g = 0.73;
        let b = 0.56;
        if (loose > 0.004) {
          const w = Math.min(1, loose / 0.04);
          r += (0.6 - r) * w;
          g += (0.42 - g) * w;
          b += (0.26 - b) * w;
        } else if (y < -0.015) {
          const w = Math.min(1, -y / 1.2);
          r = 0.66 - 0.18 * w;
          g = 0.51 - 0.15 * w;
          b = 0.35 - 0.1 * w;
        }
        const shade = 0.9 + 0.2 * noise(i, j);
        const c = idx * 4;
        this.colors[c] = r * shade;
        this.colors[c + 1] = g * shade;
        this.colors[c + 2] = b * shade;
        this.colors[c + 3] = 1;
      }
    }
  }

  /** 시뮬레이션에서 바뀐 영역을 화면에 반영한다. */
  sync(): void {
    const r = this.terrain.takeRenderDirty();
    if (!r) return;
    const n = this.terrain.n;
    this.refresh(Math.max(0, r.i0 - 1), Math.min(n - 1, r.i1 + 1), Math.max(0, r.j0 - 1), Math.min(n - 1, r.j1 + 1));
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, false, false);
    this.mesh.updateVerticesData(VertexBuffer.NormalKind, this.normals, false, false);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors, false, false);
  }
}
