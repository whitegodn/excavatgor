import type { LeverPattern } from '../core/input/levers';
import { ProcedureObjective } from '../curriculum/objectives/procedureObjective';
import type { Objective, TaskDef } from '../curriculum/task';
import type { ExcavatorSim } from '../equipment/excavator/excavatorSim';
import { guideText } from './guide';

export interface PromptState {
  sim: ExcavatorSim;
  /** 지금 하는 과제. 자유 연습이면 null */
  task: TaskDef | null;
  objective: Objective | null;
  belt: boolean;
  engineOn: boolean;
  locked: boolean;
  pattern: LeverPattern;
  /** 단계별 안내를 켰는가 (C 키) */
  coachOn: boolean;
  /** 시범 운전 중이면 지금 단계 설명 */
  demo: string | null;
}

/**
 * 화면 가운데 위 "지금 할 일" 안내문(HTML)을 정한다.
 * 화면과 연습 도구(tools/trainee.ts)가 같이 쓴다.
 */
export function promptFor(s: PromptState): string {
  const base = {
    sim: s.sim,
    belt: s.belt,
    engineOn: s.engineOn,
    locked: s.locked,
    pattern: s.pattern,
    coach: s.coachOn,
    demo: s.demo,
  };
  const { task, objective } = s;
  if (!task || !objective) return guideText(base);
  // 절차 과제는 준비 단계 자체가 과제다
  if (objective instanceof ProcedureObjective) return objective.goal(s.sim, s.pattern) ?? '';
  // 준비(안전벨트 → 시동 → 안전레버)는 모든 과제에서 알려 준다
  if (!s.engineOn || s.locked) return guideText({ ...base, coach: false });
  if (task.coach === 'none' || !s.coachOn) return objective.brief(s.sim);
  const own = objective.goal(s.sim, s.pattern);
  if (own !== null) return own;
  return task.coach === 'full' ? guideText(base) : objective.brief(s.sim);
}
