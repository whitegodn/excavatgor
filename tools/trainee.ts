/**
 * 화면 없이 키보드 조작을 시험하는 연습 도구.
 * 실제 앱과 같은 경로(키 → 가상 레버 → 명령 → 시뮬레이션 → 과제 심판)를 쓴다.
 *
 * 사용법:
 *   npx tsx tools/trainee.ts "B; R; F; K 1.0; W+J 2.0; wait 0.5"        자유 연습
 *   npx tsx tools/trainee.ts --task L1-1 "B; R; F; K 0.5"                과제
 *   npx tsx tools/trainee.ts --list                                      과제 목록
 *
 *   B, R, F, P, +, -   한 번 누르는 스위치 키 (안전벨트, 시동, 안전레버, 레버 방식, 엔진 다이얼)
 *   Space              경음기를 잠깐 울리기
 *   W+J 2.0            W와 J를 2초 동안 누르고 있기 (Shift, Up, Down, Left, Right 가능)
 *   wait 0.5           아무것도 누르지 않고 0.5초 기다리기
 *
 * 매번 처음 상태에서 전체 순서를 다시 실행한다. 순서를 이어 붙여 가며 연습하면 된다.
 * 과제가 끝나면 채점표를 보여 준다.
 */
import { Coach } from '../src/app/coach';
import { bucketView } from '../src/app/guide';
import { promptFor } from '../src/app/prompt';
import { keysToTargets, type LeverPattern, LeverRamp, leversToCommand } from '../src/core/input/levers';
import { finalize } from '../src/core/scoring/score';
import { DT } from '../src/core/sim/command';
import { clamp, DEG } from '../src/core/sim/math';
import { LEVELS, taskById, TASKS } from '../src/curriculum/excavatorLicense';
import { CycleObjective } from '../src/curriculum/objectives/cycleObjective';
import { ExcavatorSim } from '../src/equipment/excavator/excavatorSim';
import { TRAINING_YARD } from '../src/sites/site';

const KEY_CODES: Record<string, string> = {
  W: 'KeyW',
  A: 'KeyA',
  S: 'KeyS',
  D: 'KeyD',
  I: 'KeyI',
  J: 'KeyJ',
  K: 'KeyK',
  L: 'KeyL',
  SHIFT: 'ShiftLeft',
  UP: 'ArrowUp',
  DOWN: 'ArrowDown',
  LEFT: 'ArrowLeft',
  RIGHT: 'ArrowRight',
};

function strip(html: string): string {
  return html
    .replace(/<small>/g, ' — ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

const args = process.argv.slice(2);
if (args[0] === '--list') {
  for (const lv of LEVELS) {
    console.log(`레벨 ${lv.level} · ${lv.name}: ${lv.summary}${lv.comingSoon ? ` (준비 중)` : ''}`);
    for (const t of TASKS.filter((x) => x.level === lv.level)) {
      console.log(`  ${t.id}  ${t.title}${t.quiz ? ' (퀴즈: 이 도구로는 할 수 없음)' : ''} — ${t.summary}`);
    }
  }
  process.exit(0);
}
let taskId: string | null = null;
if (args[0] === '--task') {
  taskId = args[1] ?? null;
  args.splice(0, 2);
}
const task = taskId ? (taskById(taskId) ?? null) : null;
if (taskId && (!task || task.quiz)) {
  console.log(`"${taskId}"는 이 도구로 할 수 있는 과제가 아닙니다. --list로 목록을 보세요.`);
  process.exit(1);
}
const script = args.join(' ').trim();
if (!script && !task) {
  console.log('사용법: npx tsx tools/trainee.ts [--task L1-1] "B; R; F; K 1.0; W+J 2.0; wait 0.5"   (--list: 과제 목록)');
  process.exit(1);
}

const sim = new ExcavatorSim(task?.site ?? TRAINING_YARD, undefined, task?.start);
const objective = task?.create?.(sim) ?? null;
const ramp = new LeverRamp();
const coach = new Coach();
// 앱과 같게: 도움 없는 과제에서는 코치가 화면에 말하지 않고 기록만 한다
coach.muted = task?.coach === 'none';
const switches = { engineOn: false, locked: true, rpm: 8, belt: false, horn: false };
let pattern: LeverPattern = 'ISO';
/** 한 단계 동안 화면에 떴던 알림과, 가장 컸던 동시 조작 감속 */
let notices: string[] = [];
let maxShareLoss = 0;

function run(keys: Set<string>, seconds: number, horn = false): void {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    if (objective?.done) return;
    switches.horn = horn;
    ramp.update(keysToTargets(keys), DT);
    const cmd = leversToCommand(ramp.axes, pattern, switches);
    sim.step(cmd);
    const before = coach.notice?.text;
    // 앱과 같게: 굴착 코치는 자유 연습과 굴착 과제에서만 쓴다
    if (!task || objective instanceof CycleObjective) coach.update(sim, cmd, pattern);
    else coach.expire(sim);
    const now = coach.notice?.text;
    if (now && now !== before) notices.push(now);
    if (objective) {
      objective.update(sim, cmd);
      for (const e of objective.events.splice(0)) notices.push(e.text);
    }
    maxShareLoss = Math.max(maxShareLoss, 1 - sim.flowShare);
  }
  switches.horn = false;
}

/** 교육생이 화면에서 눈으로 알 수 있는 것을 글로 옮긴다. */
function describe(): string {
  const p = sim.pose();
  const b = bucketView(sim);
  const zone = { dig: '노란 구역(굴착) 위', dump: '파란 구역(덤프) 위', none: '구역 밖' }[b.zone];
  const cap = sim.spec.bucketCapacity;
  const height = b.touching
    ? b.tipY < -0.03
      ? `땅에 닿음 · 처음 지면보다 ${(-b.tipY).toFixed(2)}m 아래`
      : '땅에 닿음'
    : `지면 위 ${Math.max(0, b.above).toFixed(2)}m`;
  const side = (deg: number) => `${deg < 0 ? '왼쪽' : '오른쪽'} ${Math.abs(deg).toFixed(0)}°`;
  const swing = sim.swing / DEG;
  const heading = sim.heading / DEG;
  const swingText =
    (Math.abs(swing) < 0.5 ? '정면' : side(swing)) + (Math.abs(heading) < 0.5 ? '' : ` · 차체 ${side(heading)}`);
  const resist = 1 - sim.soilResist;
  const resistWord = resist < 0.05 ? '없음' : resist < 0.45 ? '적당' : resist < 0.85 ? '깊음' : '막힘';
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const guide = strip(
    promptFor({
      sim,
      task,
      objective,
      belt: switches.belt,
      engineOn: switches.engineOn,
      locked: switches.locked,
      pattern,
      coachOn: true,
      demo: null,
    }),
  );
  const lines = [
    `  시간 ${sim.time.toFixed(1)}초 | 안전벨트 ${switches.belt ? '맴' : '안 맴'} | 시동 ${switches.engineOn ? '켜짐' : '꺼짐'} | 안전레버 ${switches.locked ? '잠김' : '해제'} | 엔진 다이얼 ${switches.rpm}/10 | 레버 방식 ${pattern}`,
    `  [자세] 날 끝: ${height}, 장비에서 ${p.tipR.toFixed(1)}m 앞 | 버킷 입구: ${b.facing} | 선회: ${swingText} | 버킷 위치: ${zone}`,
    `  [자세] 붐 ${pct(sim.boom.stroke)}(0=내림,100=올림) | 암 ${pct(sim.arm.stroke)}(0=폄,100=당김) | 버킷 ${pct(sim.bucket.stroke)}(0=폄,100=오므림) | 장비 위치 x=${sim.x.toFixed(1)} z=${sim.z.toFixed(1)}`,
  ];
  if (task && objective) {
    const limit = task.timeLimit === null ? '' : ` | 남은 시간 ${Math.max(0, task.timeLimit - objective.time).toFixed(0)}초`;
    lines.push(`  [과제 ${task.id}] ${objective.lines(sim).map((l) => `${l.label} ${l.value}`).join(' | ')} | 걸린 시간 ${objective.time.toFixed(1)}초${limit}`);
  }
  lines.push(
    `  [측정] 담긴 흙 ${sim.load.toFixed(2)}m³ (${pct(sim.load / cap)}) | 굴착 저항 ${resistWord}(${pct(resist)}) | 동시 조작으로 느려짐: 이 단계 중 최대 ${pct(maxShareLoss)}`,
    `  [측정] 파란 구역에 쏟음 ${sim.dumped.toFixed(2)}m³ | 구역 밖에 흘림 ${sim.spilled.toFixed(2)}m³ | 들다가 떨어뜨림 ${sim.returned.toFixed(2)}m³`,
    `  [측정] 완료 사이클 ${sim.cycles}회 | 이번 사이클 ${sim.cycleTime.toFixed(1)}초 | 직전 / 최단 ${sim.cycles === 0 ? '—' : `${sim.lastCycleTime.toFixed(1)} / ${sim.bestCycleTime.toFixed(1)}초`}`,
  );
  if (guide) lines.push(`  [화면 안내] ${guide}`);
  for (const n of notices) lines.push(`  [알림] ${n}`);
  notices = [];
  maxShareLoss = 0;
  return lines.join('\n');
}

if (task) {
  console.log(`[과제 ${task.id}] ${task.title}`);
  for (const b of task.brief) console.log(`  · ${b}`);
  console.log(`  합격 기준: ${task.passText}`);
  const help = { full: '단계 안내와 실수 알림', notices: '실수 알림만', none: '없음 (시험 방식)' }[task.coach];
  console.log(`  제한 시간: ${task.timeLimit === null ? '없음' : `${task.timeLimit}초`} | 화면 도움: ${help}\n`);
}
console.log('[처음 상태]');
console.log(describe());
for (const raw of script.split(';')) {
  const step = raw.trim();
  if (!step) continue;
  if (objective?.done) {
    console.log(`\n(과제가 이미 끝나 "${step}" 부터는 실행하지 않았습니다)`);
    break;
  }
  const [head, arg] = step.split(/\s+/);
  const upper = head.toUpperCase();
  if (upper === 'WAIT') {
    run(new Set(), Number(arg ?? 0.5));
  } else if (upper === 'SPACE') {
    run(new Set(), Number(arg ?? 0.3), true);
  } else if (arg === undefined) {
    if (upper === 'B') switches.belt = !switches.belt;
    else if (upper === 'R') {
      switches.engineOn = !switches.engineOn;
      if (!switches.engineOn) switches.locked = true;
    } else if (upper === 'F') {
      // 앱과 같게: 시동을 걸기 전에는 안전레버가 풀리지 않는다
      if (switches.engineOn) switches.locked = !switches.locked;
      else notices.push('먼저 시동을 거세요 [R]. 안전레버는 시동을 건 뒤에 해제합니다');
    } else if (upper === 'P') pattern = pattern === 'ISO' ? 'SAE' : 'ISO';
    else if (head === '+') switches.rpm = clamp(switches.rpm + 1, 1, 10);
    else if (head === '-') switches.rpm = clamp(switches.rpm - 1, 1, 10);
    else {
      console.log(`알 수 없는 입력: "${step}" (키를 누르고 있으려면 시간을 붙이세요. 예: "${head} 1.0")`);
      continue;
    }
    run(new Set(), DT * 2);
  } else {
    const keys = new Set<string>();
    let bad = false;
    for (const name of upper.split('+')) {
      const code = KEY_CODES[name];
      if (!code) {
        console.log(`알 수 없는 키: "${name}"`);
        bad = true;
      } else keys.add(code);
    }
    if (bad) continue;
    run(keys, Number(arg));
    // 키를 뗀 뒤 레버가 중립으로 돌아오는 시간
    run(new Set(), 0.3);
  }
  console.log(`\n[${step}]`);
  console.log(describe());
}

if (task && objective) {
  if (objective.done) {
    const score = finalize(task.score!(objective.metrics(sim), objective), objective.fatal, task.passScore);
    console.log(`\n===== 결과: ${score.pass ? '합격' : score.fatal ? '실격' : '불합격'} · ${score.total}점 / 100 (합격선 ${score.passScore}점) =====`);
    if (score.fatal) console.log(`  실격 사유: ${score.fatal}`);
    for (const it of score.items) console.log(`  ${it.label}: ${it.points} / ${it.max} — ${it.detail}`);
    if (objective instanceof CycleObjective && objective.reports.length) {
      console.log('  [사이클별 기록]');
      objective.reports.forEach((c, i) =>
        console.log(`    ${i + 1}. ${c.valid ? `인정 ${c.time.toFixed(1)}초` : `세지 않음(${c.fault})`} · 쏟음 ${c.dumped.toFixed(2)} · 구역 밖 ${c.spilled.toFixed(2)} · 떨어뜨림 ${c.returned.toFixed(2)}`),
      );
    }
    if (coach.log.size) {
      console.log('  [과제 중 나온 실수 알림]');
      for (const [text, n] of coach.log) console.log(`    - ${text}${n > 1 ? ` (${n}번)` : ''}`);
    }
  } else {
    console.log('\n(과제가 아직 끝나지 않았습니다. 순서를 이어 붙여 계속하세요)');
  }
}
