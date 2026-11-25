/** 채점표의 한 줄 */
export interface ScoreItem {
  id: string;
  label: string;
  /** 이 항목의 만점 */
  max: number;
  points: number;
  /** 왜 이 점수인지 한 줄 설명 */
  detail: string;
}

export interface Score {
  items: ScoreItem[];
  total: number;
  passScore: number;
  pass: boolean;
  /** 점수와 상관없이 불합격인 이유(실격). 없으면 null */
  fatal: string | null;
}

/** 합격선. 국가기술자격 실기와 같은 100점 만점 60점 */
export const PASS_SCORE = 60;

/**
 * 값을 0~1 비율로 바꾼다. full이면 1, zero이면 0, 그 사이는 직선.
 * full < zero 이면 작을수록 좋은 값(시간, 흘림), full > zero 이면 클수록 좋은 값(작업량)이다.
 */
export function ramp(value: number, full: number, zero: number): number {
  if (full === zero) return value >= full ? 1 : 0;
  const t = (value - zero) / (full - zero);
  return t <= 0 ? 0 : t > 1 ? 1 : t;
}

export function scoreItem(id: string, label: string, max: number, ratio: number, detail: string): ScoreItem {
  const r = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
  return { id, label, max, points: Math.round(max * r), detail };
}

export function finalize(items: ScoreItem[], fatal: string | null, passScore = PASS_SCORE): Score {
  const total = items.reduce((sum, it) => sum + it.points, 0);
  return { items, total, passScore, pass: fatal === null && total >= passScore, fatal };
}
