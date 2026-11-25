import { clamp, DEG } from '../sim/math';

export interface Rect {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/**
 * 높이맵 지형과 토사 부피 모델.
 *
 * 격자점마다 높이 h와, 그 위에 쌓인 "풀린 흙" 두께 loose를 가진다.
 * (h - loose)는 한 번도 건드리지 않은 원지반 높이다.
 * 원지반을 깎으면 부피가 swell배로 늘어난 풀린 흙이 된다.
 * 모든 부피는 "풀린 흙 기준 부피"로 주고받으므로 합계가 보존된다.
 */
export class Terrain {
  readonly n: number;
  readonly cellArea: number;
  readonly minX: number;
  readonly minZ: number;
  readonly h: Float64Array;
  readonly loose: Float64Array;
  readonly tanLoose: number;
  readonly tanBank: number;
  private renderDirty: Rect | null = null;
  private active: Rect | null = null;

  constructor(
    readonly size: number,
    readonly cell: number,
    readonly swell = 1.25,
    reposeLooseDeg = 35,
    reposeBankDeg = 75,
  ) {
    this.n = Math.round(size / cell) + 1;
    this.cellArea = cell * cell;
    this.minX = -size / 2;
    this.minZ = -size / 2;
    this.h = new Float64Array(this.n * this.n);
    this.loose = new Float64Array(this.n * this.n);
    this.tanLoose = Math.tan(reposeLooseDeg * DEG);
    this.tanBank = Math.tan(reposeBankDeg * DEG);
  }

  private mark(i: number, j: number): void {
    const r = this.renderDirty;
    if (!r) this.renderDirty = { i0: i, i1: i, j0: j, j1: j };
    else {
      if (i < r.i0) r.i0 = i;
      if (i > r.i1) r.i1 = i;
      if (j < r.j0) r.j0 = j;
      if (j > r.j1) r.j1 = j;
    }
    const a = this.active;
    if (!a) this.active = { i0: i, i1: i, j0: j, j1: j };
    else {
      if (i < a.i0) a.i0 = i;
      if (i > a.i1) a.i1 = i;
      if (j < a.j0) a.j0 = j;
      if (j > a.j1) a.j1 = j;
    }
  }

  private markIdx(idx: number): void {
    this.mark(idx % this.n, (idx / this.n) | 0);
  }

  /** 가장 가까운 격자점 번호. 지형 밖이면 -1. */
  nearestIndex(x: number, z: number): number {
    const i = Math.round((x - this.minX) / this.cell);
    const j = Math.round((z - this.minZ) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  /** 임의 위치의 지면 높이(이중 선형 보간). */
  heightAt(x: number, z: number): number {
    const n = this.n;
    const fx = clamp((x - this.minX) / this.cell, 0, n - 1.0001);
    const fz = clamp((z - this.minZ) / this.cell, 0, n - 1.0001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = j * n + i;
    const h = this.h;
    return (
      (h[a] * (1 - tx) + h[a + 1] * tx) * (1 - tz) + (h[a + n] * (1 - tx) + h[a + n + 1] * tx) * tz
    );
  }

  /** 격자점을 높이 y까지 깎는다. 깎인 양을 풀린 흙 기준 부피(m³)로 돌려준다. */
  cut(idx: number, y: number): number {
    const dh = this.h[idx] - y;
    if (dh <= 0) return 0;
    const fromLoose = Math.min(this.loose[idx], dh);
    const fromBank = dh - fromLoose;
    this.loose[idx] -= fromLoose;
    if (this.loose[idx] < 0) this.loose[idx] = 0;
    this.h[idx] = y;
    this.markIdx(idx);
    return (fromLoose + fromBank * this.swell) * this.cellArea;
  }

  /** (x, z) 주변에 풀린 흙 vol(m³)을 쌓는다. 지형 밖이면 가장자리 안쪽에 쌓아 부피를 잃지 않는다. */
  deposit(x: number, z: number, vol: number, radius: number): void {
    if (vol <= 0) return;
    const n = this.n;
    const cell = this.cell;
    const ci = clamp(Math.round((x - this.minX) / cell), 1, n - 2);
    const cj = clamp(Math.round((z - this.minZ) / cell), 1, n - 2);
    const rn = Math.max(1, Math.ceil(radius / cell));
    const i0 = Math.max(0, ci - rn);
    const i1 = Math.min(n - 1, ci + rn);
    const j0 = Math.max(0, cj - rn);
    const j1 = Math.min(n - 1, cj + rn);
    let wsum = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        wsum += this.weight(i - ci, j - cj, radius);
      }
    }
    const k = vol / wsum / this.cellArea;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w = this.weight(i - ci, j - cj, radius);
        if (w <= 0) continue;
        const add = w * k;
        const idx = j * n + i;
        this.h[idx] += add;
        this.loose[idx] += add;
        this.mark(i, j);
      }
    }
  }

  private weight(di: number, dj: number, radius: number): number {
    if (di === 0 && dj === 0) return 1;
    const d = Math.hypot(di, dj) * this.cell;
    const w = 1 - d / radius;
    return w > 0 ? w : 0;
  }

  /**
   * 안식각보다 가파른 곳의 흙을 낮은 쪽으로 흘려보낸다.
   * 풀린 흙은 약 35°, 원지반은 약 75°까지 버틴다. 변화가 있었으면 true.
   */
  relax(tick: number): boolean {
    const r = this.active;
    if (!r) return false;
    this.active = null;
    const n = this.n;
    const i0 = Math.max(0, r.i0 - 1);
    const i1 = Math.min(n - 1, r.i1 + 1);
    const j0 = Math.max(0, r.j0 - 1);
    const j1 = Math.min(n - 1, r.j1 + 1);
    const diag = this.cell * Math.SQRT2;
    const forward = (tick & 1) === 0;
    let changed = false;
    for (let jj = j0; jj <= j1; jj++) {
      const j = forward ? jj : j1 - (jj - j0);
      for (let ii = i0; ii <= i1; ii++) {
        const i = forward ? ii : i1 - (ii - i0);
        const idx = j * n + i;
        if (i < n - 1 && this.pair(idx, idx + 1, this.cell)) changed = true;
        if (j < n - 1) {
          if (this.pair(idx, idx + n, this.cell)) changed = true;
          if (i < n - 1 && this.pair(idx, idx + n + 1, diag)) changed = true;
          if (i > 0 && this.pair(idx, idx + n - 1, diag)) changed = true;
        }
      }
    }
    return changed;
  }

  private pair(a: number, b: number, dist: number): boolean {
    const h = this.h;
    const loose = this.loose;
    let hi = a;
    let lo = b;
    let diff = h[a] - h[b];
    if (diff < 0) {
      hi = b;
      lo = a;
      diff = -diff;
    }
    const lh = loose[hi];
    if (lh > 1e-6) {
      const lim = this.tanLoose * dist;
      if (diff <= lim) return false;
      let mv = 0.25 * (diff - lim);
      if (mv > lh) mv = lh;
      if (mv < 1e-5) return false;
      h[hi] -= mv;
      loose[hi] -= mv;
      h[lo] += mv;
      loose[lo] += mv;
      this.markIdx(hi);
      this.markIdx(lo);
      return true;
    }
    const limB = this.tanBank * dist;
    if (diff <= limB) return false;
    const mv = 0.25 * (diff - limB);
    if (mv < 1e-5) return false;
    const add = mv * this.swell;
    h[hi] -= mv;
    h[lo] += add;
    loose[lo] += add;
    this.markIdx(hi);
    this.markIdx(lo);
    return true;
  }

  /** 지형 전체의 흙 양(풀린 흙 기준 m³). 부피 보존 검사에 쓴다. */
  totalLooseEq(): number {
    const h = this.h;
    const loose = this.loose;
    let s = 0;
    for (let k = 0; k < h.length; k++) s += (h[k] - loose[k]) * this.swell + loose[k];
    return s * this.cellArea;
  }

  /** 화면 갱신이 필요한 영역을 꺼내고 비운다. */
  takeRenderDirty(): Rect | null {
    const r = this.renderDirty;
    this.renderDirty = null;
    return r;
  }
}
