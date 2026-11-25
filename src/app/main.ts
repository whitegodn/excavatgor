import { GamepadInput } from '../core/input/gamepad';
import { KeyboardInput } from '../core/input/keyboard';
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
import { type Command, DT } from '../core/sim/command';
import { clamp } from '../core/sim/math';
import { Autopilot } from '../equipment/excavator/autopilot';
import { ExcavatorSim } from '../equipment/excavator/excavatorSim';
import { TRAINING_YARD } from '../sites/site';
import { Coach } from './coach';
import { Hud } from './hud';
import { World } from './view/world';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const site = TRAINING_YARD;
let sim = new ExcavatorSim(site);
const world = new World(canvas, sim, site);
const hud = new Hud(document.getElementById('hud')!);
const coach = new Coach();

/** 지금까지 장비에 들어간 모든 명령. 이것만 있으면 훈련 전체를 다시 재생할 수 있다. */
let log: Command[] = [];

const switches = { engineOn: false, locked: true, rpm: 8 };
let pattern: LeverPattern = 'ISO';
let demo: Autopilot | null = null;
let levers: LeverAxes = zeroAxes();
let verify = '—';
let gamepadUsed = false;
let coachOn = true;

const keyboard = new KeyboardInput(window);
const ramp = new LeverRamp();
const gamepad = new GamepadInput();

/** 지형과 기록을 처음 상태로 되돌린다. 시동과 안전레버 상태는 그대로 둔다. */
function resetSession(): void {
  sim = new ExcavatorSim(site);
  log = [];
  verify = '—';
  coach.reset();
  world.setSim(sim);
}

keyboard.onAction = (action) => {
  switch (action) {
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
      break;
    case 'demo':
      if (demo) endDemo();
      else startDemo();
      break;
    case 'verify':
      verify = verifyReplay();
      break;
    case 'restart':
      demo = null;
      resetSession();
      break;
    case 'horn':
      break;
  }
};

/** 시범은 항상 처음 상태에서 시작하고, 끝나면 다시 처음 상태로 되돌려 내 기록과 섞이지 않게 한다 */
function startDemo(): void {
  resetSession();
  demo = new Autopilot(1);
  switches.engineOn = true;
  switches.locked = false;
}

function endDemo(): void {
  demo = null;
  resetSession();
  coach.say(sim, 'demoEnd', '시범이 끝났습니다. 지형과 기록을 처음 상태로 되돌렸습니다. 이제 직접 해 보세요', 'good', 7);
}

/** 기록된 입력을 새 장비에 처음부터 다시 넣어, 지금 상태와 같은 결과가 나오는지 확인한다. */
function verifyReplay(): string {
  const fresh = new ExcavatorSim(site);
  for (const cmd of log) fresh.step(cmd);
  const same = fresh.hash() === sim.hash();
  return `${same ? '일치' : '불일치'} (${(log.length * DT).toFixed(0)}초 분량)`;
}

function tick(): void {
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
  } else {
    coach.update(sim, cmd, pattern);
  }
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
  hud.update({
    sim,
    engineOn: switches.engineOn,
    locked: switches.locked,
    rpm: demo ? 10 : switches.rpm,
    pattern,
    inputMode: gamepadUsed ? '조이스틱' : '키보드',
    camera: world.cameraMode,
    levers,
    fine: keyboard.fine && !demo,
    coach: coachOn,
    demo: demo ? demo.phaseLabel : null,
    notice: coach.notice,
    tags: world.cabTags(),
    fps,
    verify,
  });
  world.render();
}

world.engine.runRenderLoop(frame);

// 개발·자동 점검용 손잡이
Object.assign(window, {
  __dev: {
    get sim() {
      return sim;
    },
    world,
    switches,
    /** 화면 갱신과 무관하게 n틱을 진행하고 한 번 그린다 */
    advance(n: number) {
      for (let i = 0; i < n; i++) tick();
      draw();
    },
    startDemo: () => {
      if (!demo) startDemo();
    },
    verify: verifyReplay,
    state() {
      return {
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
        demo: demo ? demo.phaseLabel : null,
        notice: coach.notice?.text ?? null,
        logTicks: log.length,
        fps,
      };
    },
  },
});
