import { describe, expect, it } from 'vitest';
import { DEG } from '../src/core/sim/math';
import { Terrain } from '../src/core/terrain/terrain';

function settle(t: Terrain, maxTicks = 5000): number {
  let ticks = 0;
  while (t.relax(ticks) && ticks < maxTicks) ticks++;
  return ticks;
}

describe('지형과 토사 부피', () => {
  it('원지반을 깎으면 부피가 팽창률만큼 늘어난다', () => {
    const t = new Terrain(8, 0.125);
    const idx = t.nearestIndex(0, 0);
    const vol = t.cut(idx, -0.4);
    expect(vol).toBeCloseTo(0.4 * t.cellArea * 1.25, 12);
  });

  it('풀린 흙을 다시 깎을 때는 부피가 늘지 않는다', () => {
    const t = new Terrain(8, 0.125);
    t.deposit(0, 0, 0.05, 0.3);
    const idx = t.nearestIndex(0, 0);
    const piled = t.loose[idx];
    expect(piled).toBeGreaterThan(0);
    const vol = t.cut(idx, 0);
    expect(vol).toBeCloseTo(piled * t.cellArea, 12);
  });

  it('깎고 쌓고 흘러내려도 총량이 보존된다', () => {
    const t = new Terrain(8, 0.125);
    const before = t.totalLooseEq();
    let moved = 0;
    for (let x = -0.5; x <= 0.5; x += 0.125) {
      for (let z = -0.5; z <= 0.5; z += 0.125) moved += t.cut(t.nearestIndex(x, z), -0.8);
    }
    t.deposit(2, 2, moved, 0.3);
    settle(t);
    expect(Math.abs(t.totalLooseEq() - before) / moved).toBeLessThan(1e-9);
  });

  it('지형 밖에 쏟아도 흙이 사라지지 않는다', () => {
    const t = new Terrain(8, 0.125);
    const before = t.totalLooseEq();
    t.deposit(100, -100, 0.3, 0.3);
    expect(t.totalLooseEq() - before).toBeCloseTo(0.3, 9);
  });

  it('쏟은 흙더미는 안식각(약 35°) 이하로 가라앉는다', () => {
    const t = new Terrain(8, 0.125);
    t.deposit(0, 0, 0.6, 0.2);
    const ticks = settle(t);
    expect(ticks).toBeLessThan(5000);
    const peak = t.heightAt(0, 0);
    expect(peak).toBeGreaterThan(0.2);
    // 꼭대기에서 1m 떨어진 곳까지의 평균 경사
    const slope = (peak - t.heightAt(1, 0)) / 1;
    expect(slope).toBeLessThanOrEqual(Math.tan(36 * DEG));
  });

  it('수직으로 깎은 원지반 벽은 약 75°까지 무너진다', () => {
    const t = new Terrain(8, 0.125);
    for (let x = -0.5; x <= 0.5; x += 0.125) {
      for (let z = -0.5; z <= 0.5; z += 0.125) t.cut(t.nearestIndex(x, z), -1.5);
    }
    settle(t);
    const n = t.n;
    let maxStep = 0;
    for (let k = 0; k < t.h.length - 1; k++) {
      if ((k + 1) % n === 0 || t.loose[k] > 1e-6 || t.loose[k + 1] > 1e-6) continue;
      maxStep = Math.max(maxStep, Math.abs(t.h[k] - t.h[k + 1]));
    }
    expect(maxStep).toBeLessThanOrEqual(t.tanBank * t.cell + 1e-3);
  });
});
