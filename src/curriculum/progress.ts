import type { Score } from '../core/scoring/score';
import type { TaskDef } from './task';

export interface TaskRecord {
  best: number;
  passed: boolean;
  attempts: number;
}

/** 저장소(브라우저의 localStorage 등). 테스트에서는 가짜를 넣는다 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Badge {
  tier: string;
  name: string;
}

const KEY = 'excavator-progress-v1';

/** 과제별 기록과 해금 상태. 기기 안에만 저장한다(계정·서버는 P2). */
export class Progress {
  private records: Record<string, TaskRecord> = {};

  constructor(
    private readonly tasks: readonly TaskDef[],
    private readonly store: KeyValueStore | null,
  ) {
    try {
      const raw = store?.getItem(KEY);
      if (raw) this.records = JSON.parse(raw) as Record<string, TaskRecord>;
    } catch {
      this.records = {};
    }
  }

  get(id: string): TaskRecord | null {
    return this.records[id] ?? null;
  }

  /** 과제 결과를 기록하고, 이번에 처음 합격했는지 돌려준다 */
  record(id: string, score: Score): boolean {
    const old = this.records[id];
    const firstPass = score.pass && !old?.passed;
    this.records[id] = {
      best: Math.max(old?.best ?? 0, score.total),
      passed: (old?.passed ?? false) || score.pass,
      attempts: (old?.attempts ?? 0) + 1,
    };
    this.save();
    return firstPass;
  }

  /** 앞 과제를 합격해야 다음 과제가 열린다. 첫 과제는 항상 열려 있다 */
  isUnlocked(id: string): boolean {
    const i = this.tasks.findIndex((t) => t.id === id);
    if (i <= 0) return i === 0;
    return this.records[this.tasks[i - 1].id]?.passed ?? false;
  }

  /** 아직 합격하지 못한 첫 과제(이어서 할 과제). 다 했으면 null */
  next(): TaskDef | null {
    return this.tasks.find((t) => !this.records[t.id]?.passed) ?? null;
  }

  levelPassed(level: number): boolean {
    const inLevel = this.tasks.filter((t) => t.level === level);
    return inLevel.length > 0 && inLevel.every((t) => this.records[t.id]?.passed);
  }

  /**
   * 지금까지 얻은 가장 높은 등급 (구현계획 §7.1).
   * 1등급: L0~L2 통과. 2등급은 L3~L4가 필요한데 L4는 아직 없으므로 줄 수 없다.
   */
  badge(): Badge | null {
    if ([0, 1, 2].every((l) => this.levelPassed(l))) return { tier: '브론즈', name: '입문 운전자' };
    return null;
  }

  reset(): void {
    this.records = {};
    this.save();
  }

  private save(): void {
    try {
      this.store?.setItem(KEY, JSON.stringify(this.records));
    } catch {
      // 저장하지 못해도(사생활 보호 모드 등) 훈련은 계속할 수 있다
    }
  }
}
