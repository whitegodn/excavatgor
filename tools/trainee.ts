/**
 * 화면 없이 키보드 조작을 시험하는 연습 도구.
 * 실제 앱과 같은 경로(키 → 가상 레버 → 명령 → 시뮬레이션)를 쓴다.
 *
 * 사용법:
 *   npx tsx tools/trainee.ts "R; F; K 1.0; W+J 2.0; wait 0.5; Shift+I 0.8"
 *
 *   R, F, P, +, -      한 번 누르는 스위치 키 (시동, 안전레버, 패턴, RPM)
 *   W+J 2.0            W와 J를 2초 동안 누르고 있기 (Shift, Up, Down, Left, Right 가능)
 *   wait 0.5           아무것도 누르지 않고 0.5초 기다리기
 *
 * 매번 처음 상태에서 전체 순서를 다시 실행한다. 순서를 이어 붙여 가며 연습하면 된다.
 */
import { keysToTargets, type LeverPattern, LeverRamp, leversToCommand } from '../src/core/input/levers';
import { DT } from '../src/core/sim/command';
import { clamp, DEG } from '../src/core/sim/math';
import { Coach } from '../src/app/coach';
import { bucketView, guideText } from '../src/app/guide';
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

const site = TRAINING_YARD;
const sim = new ExcavatorSim(site);
const ramp = new LeverRamp();
const coach = new Coach();
const switches = { engineOn: false, locked: true, rpm: 8 };
let pattern: LeverPattern = 'ISO';
/** 한 단계 동안 화면에 떴던 알림과, 가장 컸던 동시 조작 감속 */
let notices: string[] = [];
let maxShareLoss = 0;

function run(keys: Set<string>, seconds: number): void {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    ramp.update(keysToTargets(keys), DT);
    const cmd = leversToCommand(ramp.axes, pattern, switches);
    sim.step(cmd);
    const before = coach.notice?.text;
    coach.update(sim, cmd, pattern);
    const now = coach.notice?.text;
    if (now && now !== before) notices.push(now);
    maxShareLoss = Math.max(maxShareLoss, 1 - sim.flowShare);
  }
}

function strip(html: string): string {
  return html
    .replace(/<small>/g, ' — ')
    .replace(/<[^>]+>/g, '')
    .trim();
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
  const swing = sim.swing / DEG;
  const side = (deg: number) => `${deg < 0 ? '왼쪽' : '오른쪽'} ${Math.abs(deg).toFixed(0)}°`;
  const heading = sim.heading / DEG;
  const swingText =
    (Math.abs(swing) < 0.5 ? '정면' : side(swing)) + (Math.abs(heading) < 0.5 ? '' : ` · 차체 ${side(heading)}`);
  const resist = 1 - sim.soilResist;
  const resistWord = resist < 0.05 ? '없음' : resist < 0.45 ? '적당' : resist < 0.85 ? '깊음' : '막힘';
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const guide = strip(
    guideText({ sim, engineOn: switches.engineOn, locked: switches.locked, pattern, coach: true, demo: null }),
  );
  const lines = [
    `  시간 ${sim.time.toFixed(1)}초 | 시동 ${switches.engineOn ? '켜짐' : '꺼짐'} | 안전레버 ${switches.locked ? '잠김' : '해제'} | 엔진 다이얼 ${switches.rpm}/10 | 레버 방식 ${pattern}`,
    `  [자세] 날 끝: ${height}, 장비에서 ${p.tipR.toFixed(1)}m 앞 | 버킷 입구: ${b.facing} | 선회: ${swingText} | 버킷 위치: ${zone}`,
    `  [자세] 붐 ${pct(sim.boom.stroke)}(0=내림,100=올림) | 암 ${pct(sim.arm.stroke)}(0=폄,100=당김) | 버킷 ${pct(sim.bucket.stroke)}(0=폄,100=오므림) | 장비 위치 x=${sim.x.toFixed(1)} z=${sim.z.toFixed(1)}`,
    `  [측정] 담긴 흙 ${sim.load.toFixed(2)}m³ (${pct(sim.load / cap)}) | 굴착 저항 ${resistWord}(${pct(resist)}) | 동시 조작으로 느려짐: 이 단계 중 최대 ${pct(maxShareLoss)}`,
    `  [측정] 파란 구역에 쏟음 ${sim.dumped.toFixed(2)}m³ | 구역 밖에 흘림 ${sim.spilled.toFixed(2)}m³ | 들다가 떨어뜨림 ${sim.returned.toFixed(2)}m³`,
    `  [측정] 완료 사이클 ${sim.cycles}회 | 이번 사이클 ${sim.cycleTime.toFixed(1)}초 | 직전 / 최단 ${sim.cycles === 0 ? '—' : `${sim.lastCycleTime.toFixed(1)} / ${sim.bestCycleTime.toFixed(1)}초`}`,
  ];
  if (guide) lines.push(`  [화면 안내] ${guide}`);
  for (const n of notices) lines.push(`  [알림] ${n}`);
  notices = [];
  maxShareLoss = 0;
  return lines.join('\n');
}

const script = process.argv.slice(2).join(' ').trim();
if (!script) {
  console.log('사용법: npx tsx tools/trainee.ts "R; F; K 1.0; W+J 2.0; wait 0.5"');
  process.exit(1);
}

console.log('[처음 상태]');
console.log(describe());
for (const raw of script.split(';')) {
  const step = raw.trim();
  if (!step) continue;
  const [head, arg] = step.split(/\s+/);
  const upper = head.toUpperCase();
  if (upper === 'WAIT') {
    run(new Set(), Number(arg ?? 0.5));
  } else if (arg === undefined) {
    if (upper === 'R') {
      switches.engineOn = !switches.engineOn;
      if (!switches.engineOn) switches.locked = true;
    } else if (upper === 'F') {
      // 앱과 같게: 시동을 걸기 전에는 안전레버가 풀리지 않는다
      if (switches.engineOn) switches.locked = !switches.locked;
      else notices.push('먼저 시동을 거세요 [R]. 안전레버는 시동을 건 뒤에 해제합니다');
    }
    else if (upper === 'P') pattern = pattern === 'ISO' ? 'SAE' : 'ISO';
    else if (head === '+') switches.rpm = clamp(switches.rpm + 1, 1, 10);
    else if (head === '-') switches.rpm = clamp(switches.rpm - 1, 1, 10);
    else {
      console.log(`알 수 없는 입력: "${step}" (키를 누르고 있으려면 시간을 붙이세요. 예: "${head} 1.0")`);
      continue;
    }
    run(new Set(), DT);
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
