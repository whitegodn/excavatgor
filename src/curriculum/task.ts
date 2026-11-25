import type { LeverPattern } from '../core/input/levers';
import { type Command, SIM_HZ } from '../core/sim/command';
import type { ScoreItem } from '../core/scoring/score';
import type { ExcavatorSim } from '../equipment/excavator/excavatorSim';
import type { Site } from '../sites/site';

/**
 * 과제 중 화면이 얼마나 도와주는가.
 * full: 단계별 안내와 실수 알림 / notices: 실수 알림만 / none: 도움 없음(시험 방식)
 */
export type CoachLevel = 'full' | 'notices' | 'none';

/** 3D 화면에 놓는 표지 */
export type Marker =
  | { kind: 'target'; x: number; y: number; z: number; radius: number; state: 'active' | 'todo' | 'done' }
  | { kind: 'bar'; x1: number; z1: number; x2: number; z2: number; height: number };

export interface ProgressLine {
  label: string;
  value: string;
  tone?: 'good' | 'warn';
}

export type Metrics = Record<string, number>;

export interface TaskEvent {
  text: string;
  kind: 'good' | 'warn';
}

function anyLever(cmd: Command): boolean {
  return (
    Math.abs(cmd.arm) + Math.abs(cmd.boom) + Math.abs(cmd.bucket) + Math.abs(cmd.swing) > 0.2 ||
    Math.abs(cmd.travelL) + Math.abs(cmd.travelR) > 0.2
  );
}

/**
 * 과제 하나의 목표를 지켜보는 심판.
 * 매 틱 장비 상태를 보고 진행 상황, 완료 여부, 채점에 쓸 측정값을 기록한다.
 * 화면과 브라우저에 의존하지 않는다.
 */
export abstract class Objective {
  done = false;
  /** 점수와 상관없이 불합격인 이유(실격) */
  fatal: string | null = null;
  timedOut = false;
  /** 화면에 한 줄로 띄울 알림. 앱이 꺼내 간다 */
  readonly events: TaskEvent[] = [];
  ticks = 0;
  /** 시동을 걸고 안전레버를 푼 상태로 보낸 시간(틱). 과제 시간은 이것으로 잰다 */
  activeTicks = 0;
  beltViolations = 0;
  /** 벨트 없이 장비를 움직이면 실격인가. 절차 과제는 실격 대신 순서 실수로 센다 */
  protected beltIsFatal = true;

  constructor(readonly timeLimit: number | null) {}

  /** 과제에 쓴 시간(초) */
  get time(): number {
    return this.activeTicks / SIM_HZ;
  }

  update(sim: ExcavatorSim, cmd: Command): void {
    if (this.done) return;
    this.ticks++;
    if (cmd.engineOn && !cmd.locked) {
      this.activeTicks++;
      if (!cmd.belt && anyLever(cmd) && this.beltViolations === 0) {
        this.beltViolations = 1;
        if (this.beltIsFatal) {
          this.fatal = '안전벨트를 매지 않고 장비를 움직였습니다';
          this.say('안전벨트를 매지 않고 장비를 움직였습니다. 이 시도는 실격입니다 (Backspace로 다시 시작)', 'warn');
        } else {
          this.say('안전벨트를 매지 않고 장비를 움직였습니다 (감점)', 'warn');
        }
      }
    }
    this.step(sim, cmd);
    if (!this.done && this.timeLimit !== null && this.time >= this.timeLimit) {
      this.done = true;
      this.timedOut = true;
      this.say('제한 시간이 끝났습니다', 'warn');
    }
  }

  protected say(text: string, kind: TaskEvent['kind'] = 'good'): void {
    this.events.push({ text, kind });
  }

  protected abstract step(sim: ExcavatorSim, cmd: Command): void;

  /**
   * "지금 할 일" 안내문(HTML). null이면 과제 고유의 안내가 없다는 뜻이고,
   * 앱이 일반 굴착 안내(guideText)나 brief()를 대신 쓴다.
   */
  abstract goal(sim: ExcavatorSim, pattern: LeverPattern): string | null;
  /** 도움 없이 하는 과제에서 보여 줄 한 줄 목표 */
  abstract brief(sim: ExcavatorSim): string;
  /** 측정 패널에 보여 줄 진행 상황 */
  abstract lines(sim: ExcavatorSim): ProgressLine[];
  /** 채점에 쓸 측정값 */
  abstract metrics(sim: ExcavatorSim): Metrics;

  markers(_sim: ExcavatorSim): Marker[] {
    return [];
  }
  /** 지금 향해야 할 목표 지점(자세 그림에 표시). 없으면 null */
  focus(): { x: number; y: number; z: number; radius: number } | null {
    return null;
  }
}

export interface QuizQuestion {
  q: string;
  choices: string[];
  /** 정답의 번호(0부터) */
  answer: number;
  why: string;
}

export interface TaskDef {
  id: string;
  level: number;
  title: string;
  /** 메뉴에 보이는 한 줄 설명 */
  summary: string;
  /** 시작 전 설명 화면의 목표·방법 */
  brief: string[];
  /** 합격 기준 설명 */
  passText: string;
  coach: CoachLevel;
  /** 제한 시간(초). 시동을 걸고 안전레버를 푼 뒤부터 잰다 */
  timeLimit: number | null;
  passScore: number;
  /** 임시 수치로 만든 과제인가 (공식 규격 확인 전) */
  provisional?: boolean;
  site: Site;
  /** 시작 자세(라디안) */
  start?: { boom: number; arm: number; bucket: number };
  /** 퀴즈 과제면 문제 목록 */
  quiz?: QuizQuestion[];
  /** 조작 과제면 심판을 만든다 */
  create?: (sim: ExcavatorSim) => Objective;
  score?: (m: Metrics, o: Objective) => ScoreItem[];
}

export interface LevelDef {
  level: number;
  name: string;
  summary: string;
  /** 아직 만들지 않은 레벨이면 그 이유 */
  comingSoon?: string;
}
