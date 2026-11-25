import { GamepadInput } from '../core/input/gamepad';
import { type KeyAction, KeyboardInput } from '../core/input/keyboard';
import {
  commandToLevers,
  keysToTargets,
  type LeverAxes,
  type LeverPattern,
  LeverRamp,
  leversToCommand,
  mergeAxes,
  zeroAxes,
} from '../core/input/levers';
import { finalize, type Score, scoreItem } from '../core/scoring/score';
import { type Command, DT, SIM_HZ } from '../core/sim/command';
import { clamp } from '../core/sim/math';
import { LEVELS, taskById, TASKS } from '../curriculum/excavatorLicense';
import { CycleObjective } from '../curriculum/objectives/cycleObjective';
import { Progress } from '../curriculum/progress';
import type { Objective, TaskDef } from '../curriculum/task';
import { Autopilot } from '../equipment/excavator/autopilot';
import { ExcavatorSim } from '../equipment/excavator/excavatorSim';
import { TRAINING_YARD } from '../sites/site';
import { Coach } from './coach';
import { Hud } from './hud';
import { promptFor } from './prompt';
import { type ResultExtra, type ScreenAction, Screens } from './screens';
import { World } from './view/world';

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const storage = safeStorage();
const canvas = document.getElementById('view') as HTMLCanvasElement;
let sim = new ExcavatorSim(TRAINING_YARD);
const world = new World(canvas, sim, TRAINING_YARD);
const hud = new Hud(document.getElementById('hud')!);
const screens = new Screens(document.getElementById('screen')!);
const coach = new Coach();
const progress = new Progress(TASKS, storage);

/** 지금까지 장비에 들어간 모든 명령. 이것만 있으면 훈련 전체를 다시 재생할 수 있다. */
let log: Command[] = [];

const switches = { engineOn: false, locked: true, rpm: 8, belt: false, horn: false };
let pattern: LeverPattern = storage?.getItem('excavator-pattern') === 'SAE' ? 'SAE' : 'ISO';
let demo: Autopilot | null = null;
let levers: LeverAxes = zeroAxes();
let verify = '—';
let gamepadUsed = false;
let coachOn = true;

/**
 * menu: 과정 메뉴 / brief: 과제 설명 / quiz: 퀴즈 / play: 조작 중 / paused: 일시 정지 / result: 결과.
 * 장비는 play일 때만 움직인다.
 */
type Mode = 'menu' | 'brief' | 'quiz' | 'play' | 'paused' | 'result';
let mode: Mode = 'menu';
/** 지금 하는 과제. 자유 연습이면 null */
let task: TaskDef | null = null;
let objective: Objective | null = null;
/** 설명 화면에 띄워 둔 과제 */
let chosen: TaskDef | null = null;
/** 과제가 끝난 뒤 결과 화면을 띄우기까지 남은 틱 (마지막 알림을 볼 시간) */
let finishIn = -1;

const keyboard = new KeyboardInput(window);
const ramp = new LeverRamp();
const gamepad = new GamepadInput();

// ── 화면 전환 ──

function openMenu(): void {
  mode = 'menu';
  demo = null;
  screens.menu(LEVELS, TASKS, progress, pattern);
}

function openBrief(t: TaskDef): void {
  mode = 'brief';
  chosen = t;
  screens.brief(t, progress.get(t.id));
}

/** 과제(또는 자유 연습)를 처음 상태에서 시작한다 */
function begin(t: TaskDef | null): void {
  task = t;
  demo = null;
  finishIn = -1;
  if (t?.quiz) {
    objective = null;
    mode = 'quiz';
    screens.startQuiz(t);
    return;
  }
  sim = new ExcavatorSim(t?.site ?? TRAINING_YARD, undefined, t?.start);
  objective = t?.create?.(sim) ?? null;
  // 매번 시동이 꺼지고 안전레버가 잠긴 상태에서 시작한다
  Object.assign(switches, { engineOn: false, locked: true, rpm: 8, belt: false, horn: false });
  log = [];
  verify = '—';
  coach.reset();
  // 도움 없는 과제(시험 방식)에서는 코치가 화면에 말하지 않고 기록만 한다. 기록은 결과 화면에 나온다
  coach.muted = t?.coach === 'none';
  world.setSim(sim);
  mode = 'play';
  screens.hide();
}

function showResult(score: Score, extra?: ResultExtra): void {
  const t = task!;
  const before = progress.badge();
  progress.record(t.id, score);
  const after = progress.badge();
  const i = TASKS.indexOf(t);
  const next = i + 1 < TASKS.length && progress.isUnlocked(TASKS[i + 1].id) ? TASKS[i + 1] : null;
  mode = 'result';
  screens.result(t, score, progress.get(t.id)!, next, !before && after ? `${after.tier} 등급 "${after.name}"을 얻었습니다` : null, extra);
}

function finishTask(): void {
  const t = task!;
  const o = objective!;
  showResult(finalize(t.score!(o.metrics(sim), o), o.fatal, t.passScore), {
    notes: [...coach.log].map(([text, n]) => (n > 1 ? `${text} (${n}번)` : text)),
    cycles: o instanceof CycleObjective ? o.reports : [],
  });
}

screens.onAction = (a: ScreenAction) => {
  switch (a.act) {
    case 'task': {
      const t = taskById(a.id);
      if (t && progress.isUnlocked(t.id)) openBrief(t);
      break;
    }
    case 'free':
      begin(null);
      break;
    case 'begin':
      if (chosen) begin(chosen);
      break;
    case 'menu':
      openMenu();
      break;
    case 'retry':
      begin(task);
      break;
    case 'next': {
      const i = task ? TASKS.indexOf(task) : -1;
      if (i >= 0 && i + 1 < TASKS.length) openBrief(TASKS[i + 1]);
      else openMenu();
      break;
    }
    case 'resume':
      mode = 'play';
      screens.hide();
      break;
    case 'pattern':
      pattern = pattern === 'ISO' ? 'SAE' : 'ISO';
      storage?.setItem('excavator-pattern', pattern);
      openMenu();
      break;
    case 'reset':
      if (window.confirm('모든 과제 기록과 등급을 지울까요?')) {
        progress.reset();
        openMenu();
      }
      break;
    case 'quizDone': {
      const t = task!;
      const item = scoreItem('quiz', '정답', 100, a.correct / a.total, `${a.total}문제 중 ${a.correct}문제 정답`);
      showResult(finalize([item], null, t.passScore));
      break;
    }
  }
};

// ── 키 입력 ──

keyboard.onAction = (action: KeyAction) => {
  if (mode !== 'play') {
    if (action === 'confirm') screens.confirm();
    else if (action === 'pause') screens.back();
    return;
  }
  switch (action) {
    case 'belt':
      if (!demo) switches.belt = !switches.belt;
      break;
    case 'engine':
      if (demo) break;
      switches.engineOn = !switches.engineOn;
      // 시동을 끄면 안전레버도 잠근 상태로 되돌린다
      if (!switches.engineOn) switches.locked = true;
      break;
    case 'lock':
      if (demo) break;
      if (!switches.engineOn) {
        coach.say(sim, 'lockFirst', '먼저 시동을 거세요 [R]. 안전레버는 시동을 건 뒤에 해제합니다');
        break;
      }
      switches.locked = !switches.locked;
      break;
    case 'rpmUp':
      switches.rpm = clamp(switches.rpm + 1, 1, 10);
      break;
    case 'rpmDown':
      switches.rpm = clamp(switches.rpm - 1, 1, 10);
      break;
    case 'camera':
      world.toggleCamera();
      break;
    case 'help':
      hud.toggleHelp();
      break;
    case 'dev':
      hud.toggleDev();
      break;
    case 'coach':
      coachOn = !coachOn;
      break;
    case 'levers':
      hud.toggleLevers();
      break;
    case 'pattern':
      pattern = pattern === 'ISO' ? 'SAE' : 'ISO';
      storage?.setItem('excavator-pattern', pattern);
      break;
    case 'demo':
      // 시범은 자유 연습에서만 본다
      if (task) coach.say(sim, 'noDemo', '시범 보기는 자유 연습에서만 됩니다', 'warn', 3);
      else if (demo) endDemo();
      else startDemo();
      break;
    case 'verify':
      verify = verifyReplay();
      break;
    case 'restart':
      begin(task);
      break;
    case 'pause':
      mode = 'paused';
      screens.pause(task ? `${task.id} ${task.title}` : '자유 연습');
      break;
    case 'confirm':
    case 'horn':
      break;
  }
};

// 퀴즈 보기는 숫자 키로도 고른다
window.addEventListener('keydown', (e) => {
  if (mode === 'quiz' && /^(Digit|Numpad)[1-4]$/.test(e.code)) screens.digit(Number(e.code.slice(-1)));
});

/** 시범은 항상 처음 상태에서 시작하고, 끝나면 다시 처음 상태로 되돌려 내 기록과 섞이지 않게 한다 */
function startDemo(): void {
  begin(null);
  demo = new Autopilot(1);
  Object.assign(switches, { engineOn: true, locked: false, belt: true });
}

function endDemo(): void {
  begin(null);
  coach.say(sim, 'demoEnd', '시범이 끝났습니다. 지형과 기록을 처음 상태로 되돌렸습니다. 이제 직접 해 보세요', 'good', 7);
}

/** 기록된 입력을 새 장비에 처음부터 다시 넣어, 지금 상태와 같은 결과가 나오는지 확인한다. */
function verifyReplay(): string {
  const fresh = new ExcavatorSim(task?.site ?? TRAINING_YARD, undefined, task?.start);
  for (const cmd of log) fresh.step(cmd);
  const same = fresh.hash() === sim.hash();
  return `${same ? '일치' : '불일치'} (${(log.length * DT).toFixed(0)}초 분량)`;
}

// ── 한 틱 ──

function tick(): void {
  if (mode !== 'play') return;
  switches.horn = keyboard.keys.has('Space');
  ramp.update(keysToTargets(keyboard.keys), DT);
  const pad = gamepad.read();
  if (gamepad.lastActive) gamepadUsed = true;
  else if (keyboard.keys.size > 0) gamepadUsed = false;
  const manual = mergeAxes(ramp.axes, pad);
  let cmd: Command;
  if (demo) {
    cmd = demo.next(sim);
    levers = commandToLevers(cmd, pattern);
  } else {
    cmd = leversToCommand(manual, pattern, switches);
    levers = manual;
  }
  log.push(cmd);
  sim.step(cmd);

  if (demo) {
    if (demo.done) endDemo();
    return;
  }
  // 굴착 코치는 자유 연습과 굴착 과제에서만 쓴다. 공중 조작·절차 과제에는 맞지 않는 조언이다
  if (!task || objective instanceof CycleObjective) coach.update(sim, cmd, pattern);
  else coach.expire(sim);
  if (objective) {
    objective.update(sim, cmd);
    for (const e of objective.events.splice(0)) coach.push(sim, e.text, e.kind);
    if (objective.done && finishIn < 0) finishIn = Math.round(1.2 * SIM_HZ);
  }
  if (finishIn > 0 && --finishIn === 0) finishTask();
}

/** 화면 가운데 위 "지금 할 일" */
function promptText(): string {
  return promptFor({
    sim,
    task,
    objective,
    belt: switches.belt,
    engineOn: switches.engineOn,
    locked: switches.locked,
    pattern,
    coachOn,
    demo: demo ? demo.phaseLabel : null,
  });
}

let last = performance.now();
let acc = 0;
let fps = 60;

function frame(): void {
  const now = performance.now();
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (elapsed > 0) fps += (1 / elapsed - fps) * 0.05;
  acc += elapsed;
  let steps = 0;
  while (acc >= DT && steps < 8) {
    tick();
    acc -= DT;
    steps++;
  }
  if (steps === 8) acc = 0;
  draw();
}

function draw(): void {
  world.sync(sim, { levers, locked: demo ? false : switches.locked, rpm: demo ? 10 : switches.rpm });
  world.syncMarkers(objective ? objective.markers(sim) : []);
  hud.update({
    sim,
    belt: demo ? true : switches.belt,
    engineOn: switches.engineOn,
    locked: switches.locked,
    rpm: demo ? 10 : switches.rpm,
    pattern,
    inputMode: gamepadUsed ? '조이스틱' : '키보드',
    camera: world.cameraMode,
    levers,
    fine: keyboard.fine && !demo,
    prompt: promptText(),
    notice: coach.notice,
    tags: world.cabTags(),
    task:
      task && objective
        ? {
            title: `${task.id} ${task.title}`,
            lines: objective.lines(sim),
            time: objective.time,
            limit: task.timeLimit,
          }
        : null,
    focus: objective ? objective.focus() : null,
    hurdle: objective instanceof CycleObjective ? objective.hurdle : null,
    fps,
    verify,
  });
  world.render();
}

openMenu();
world.engine.runRenderLoop(frame);

// 개발·자동 점검용 손잡이
Object.assign(window, {
  __dev: {
    get sim() {
      return sim;
    },
    get objective() {
      return objective;
    },
    world,
    switches,
    progress,
    /** 화면 갱신과 무관하게 n틱을 진행하고 한 번 그린다 */
    advance(n: number) {
      for (let i = 0; i < n; i++) tick();
      draw();
    },
    /** 과제를 바로 시작한다. id가 없으면 자유 연습 */
    start(id?: string) {
      begin(id ? (taskById(id) ?? null) : null);
    },
    startDemo: () => {
      if (!demo) startDemo();
    },
    verify: verifyReplay,
    state() {
      return {
        mode,
        task: task?.id ?? null,
        time: sim.time,
        load: sim.load,
        dumped: sim.dumped,
        spilled: sim.spilled,
        returned: sim.returned,
        cycles: sim.cycles,
        lastCycleTime: sim.lastCycleTime,
        error: sim.conservationError(),
        swingDeg: (sim.swing * 180) / Math.PI,
        engineOn: switches.engineOn,
        locked: switches.locked,
        belt: switches.belt,
        demo: demo ? demo.phaseLabel : null,
        notice: coach.notice?.text ?? null,
        objectiveDone: objective?.done ?? null,
        logTicks: log.length,
        fps,
      };
    },
  },
});
