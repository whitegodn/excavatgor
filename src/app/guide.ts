import { type Fn, keyFor, type LeverPattern } from '../core/input/levers';
import { clamp, DEG, wrapAngle } from '../core/sim/math';
import type { ExcavatorSim } from '../equipment/excavator/excavatorSim';
import { type Zone, type ZoneKind, zoneAt } from '../sites/site';

/** 버킷 입구가 이 각도(도) 이상 위를 보면 "위"라고 부른다. 안내의 목표와 같은 값이다. */
export const FACING_UP = 68;

export type Facing = '위' | '비스듬히 위' | '옆' | '아래' | '뒤로 넘어감';

/** 교육생이 화면에서 읽어야 하는 버킷 상태를 한곳에 모은다. */
export interface BucketView {
  tipX: number;
  tipZ: number;
  /** 날 끝 높이: 처음(파기 전) 지면 기준. 음수면 그만큼 아래 */
  tipY: number;
  /** 날 끝 바로 아래 지금 지면의 높이 */
  ground: number;
  /** 날 끝이 지금 지면에서 떨어진 높이. 음수면 흙 속 */
  above: number;
  /** 버킷 핀(버킷이 달린 곳)이 지금 지면에서 떨어진 높이. 쏟을 때 필요한 여유를 본다 */
  pinAbove: number;
  zone: ZoneKind;
  /** 버킷 입구가 수평에서 위로 향한 각도(도). 90 = 똑바로 위 */
  openUp: number;
  facing: Facing;
  /** 너무 오므려서 입구가 운전석 쪽으로 넘어갔는가 */
  over: boolean;
  /** 흙에 닿아 있는가 */
  touching: boolean;
  fill: number;
}

export function bucketView(sim: ExcavatorSim): BucketView {
  const p = sim.pose();
  const tipX = p.baseX + p.fwdX * p.tipR;
  const tipZ = p.baseZ + p.fwdZ * p.tipR;
  const tipY = p.baseY + p.tipY;
  const ground = sim.terrain.heightAt(tipX, tipZ);
  const above = tipY - ground;
  const openUp = Math.asin(clamp(-Math.cos(p.a3), -1, 1)) / DEG;
  const over = p.a3 < -Math.PI && openUp < FACING_UP;
  return {
    tipX,
    tipZ,
    tipY,
    ground,
    above,
    pinAbove: p.baseY + p.wristY - ground,
    zone: zoneAt(sim.site, tipX, tipZ),
    openUp,
    facing: over ? '뒤로 넘어감' : openUp >= FACING_UP ? '위' : openUp > 35 ? '비스듬히 위' : openUp > -15 ? '옆' : '아래',
    over,
    touching: sim.burial > 0.03 || above < 0.03,
    fill: sim.load / sim.spec.bucketCapacity,
  };
}

export interface Turn {
  word: '왼쪽' | '오른쪽';
  fn: 'swingL' | 'swingR';
  /** 구역 중심 방향과 지금 버킷 방향의 차이(도, 절댓값) */
  off: number;
  /** 장비에서 구역 중심까지의 거리(m) */
  dist: number;
}

/** 구역 쪽으로 가려면 어느 방향으로 얼마나 선회해야 하는지 */
export function turnToward(sim: ExcavatorSim, zone: Zone): Turn {
  const cx = (zone.x0 + zone.x1) / 2 - sim.x;
  const cz = (zone.z0 + zone.z1) / 2 - sim.z;
  const diff = wrapAngle(Math.atan2(cx, cz) - (sim.heading + sim.swing));
  return {
    word: diff < 0 ? '왼쪽' : '오른쪽',
    fn: diff < 0 ? 'swingL' : 'swingR',
    off: Math.abs(diff) / DEG,
    dist: Math.hypot(cx, cz),
  };
}

export { type Fn, keyFor };

export interface GuideState {
  sim: ExcavatorSim;
  /** 안전벨트를 맸는가 */
  belt: boolean;
  engineOn: boolean;
  locked: boolean;
  pattern: LeverPattern;
  /** 단계별 안내를 켰는가 (C 키) */
  coach: boolean;
  /** 시범 운전 중이면 지금 단계 설명, 아니면 null */
  demo: string | null;
}

const kbd = (key: string) => `<kbd>${key}</kbd>`;
/** 쏟으려면 버킷 핀이 지면(흙더미)에서 이만큼은 떠 있어야 버킷을 다 펼 수 있다 */
const DUMP_CLEARANCE = 1.6;
/** 같은 자리를 이보다 깊이 팠으면 옆자리로 옮기라고 안내한다 */
const DEEP_SPOT = 0.45;

/**
 * 화면 가운데 위에 띄우는 "지금 할 일" 안내문(HTML).
 * 장비 상태를 보고 굴착 → 가두기 → 들기 → 선회 → 쏟기 → 복귀 중 어느 단계인지 판단한다.
 * 큰 글씨에는 지금 할 동작 하나만, 키는 동작 바로 뒤 괄호에 넣는다. 예: 암을 펴서(W)
 * 화면과 연습 도구(tools/trainee.ts)가 같은 문구를 쓴다.
 */
export function guideText(s: GuideState): string {
  if (s.demo) {
    return `시범 운전 중: ${s.demo}<small>아래 레버 표시를 보며 순서를 익히세요 · ${kbd('G')} 중지 · 시범은 엔진 다이얼을 10으로 올려 빠르게 보여 줍니다</small>`;
  }
  if (!s.belt && !s.engineOn) {
    return `${kbd('B')} 키를 눌러 안전벨트를 매세요<small>운전석에 앉으면 가장 먼저 할 일입니다</small>`;
  }
  if (!s.engineOn) return `${kbd('R')} 키를 눌러 시동을 거세요`;
  if (s.locked) {
    return `${kbd('F')} 키를 눌러 안전레버를 해제하세요<small>잠겨 있으면 레버를 움직여도 장비가 움직이지 않습니다</small>`;
  }
  if (!s.coach) return '';

  const sim = s.sim;
  const b = bucketView(sim);
  const p = sim.pose();
  /** "암을 펴서" + (W) */
  const act = (text: string, fn: Fn) => `${text}(${kbd(keyFor(fn, s.pattern))})`;
  const line = (main: string, small = '') => (small ? `${main}<small>${small}</small>` : main);
  const inDig = b.zone === 'dig';
  const inDump = b.zone === 'dump';
  // 절반 넘게 찼거나, 1/4 넘게 실은 채 굴착 구역을 떠났으면 "실어 나르는 중"으로 본다
  const loaded = b.fill > 0.5 || (b.fill > 0.25 && !inDig);
  // 버킷을 펴서 쏟기 시작했으면 버킷이 빌 때까지 "쏟기" 단계다
  const dumping = sim.dumpingStarted && b.fill > 0.03;
  const stuck = 1 - sim.soilResist >= 0.85 && b.touching;

  /** 구역 쪽으로 선회하거나, 방향이 맞으면 암으로 거리를 맞추게 한다 */
  const goTo = (zone: Zone, name: string, step: string, arrive: string): { text: string; reach: boolean } => {
    const t = turnToward(sim, zone);
    if (t.off > 12) return { text: `${step} ${act(`${t.word}으로 선회해`, t.fn)} ${name}${arrive}`, reach: false };
    const reach = p.tipR < t.dist ? act('암을 펴서', 'armOut') : act('암을 당겨서', 'armIn');
    return { text: `${step} 방향은 맞습니다. ${reach} 버킷을 ${name} 위로 옮기세요`, reach: true };
  };
  const reachNote = `암을 펴면 버킷이 내려가고 앞으로 기웁니다. ${act('붐을 올리면서', 'boomUp')} 하세요`;

  // ── ⑦ 복귀 ──
  if (!dumping && (sim.awaitingReturn || (!loaded && !inDig))) {
    if (inDig) return line('⑦ 노란 구역에 도착했습니다. 선회가 멈추면 다음 굴착을 시작하세요');
    const go = goTo(sim.site.digZone, '노란 구역', '⑦', '으로 돌아가세요');
    return line(
      go.text,
      go.reach ? '' : `돌면서 ${act('암을 펴고', 'armOut')} ${act('버킷을 펴 두면', 'open')} 다음 굴착이 빨라집니다`,
    );
  }

  // ── ⑥ 쏟기 ──
  if (dumping || (loaded && inDump)) {
    if (!inDump) {
      const go = goTo(sim.site.dumpZone, '파란 구역', '⑥', ' 위로 가서 남은 흙을 쏟으세요');
      return line(go.text, go.reach ? reachNote : '버킷에 흙이 남아 있습니다');
    }
    if (b.touching || b.pinAbove < DUMP_CLEARANCE) {
      return line(
        `④ ${act('붐을 더 올리세요', 'boomUp')}`,
        '쏟으려면 버킷이 흙더미보다 충분히 높아야 합니다. 낮으면 버킷을 펼 때 날이 땅에 닿아 다 펴지지 않습니다',
      );
    }
    if (sim.bucket.stroke < 0.03) {
      return line(
        `⑥ 버킷을 다 폈는데 흙이 남았습니다. ${act('암을 펴세요', 'armOut')}`,
        '암이 접혀 있으면 버킷 입구가 아래를 향하지 못합니다',
      );
    }
    return line(
      `⑥ ${act('버킷을 끝까지 펴서', 'open')} 흙을 다 쏟으세요`,
      '바닥의 원 표시가 흙이 떨어질 자리입니다. 버킷이 빌 때까지 계속 누르세요',
    );
  }

  // ── ①② 굴착 ──
  if (!loaded || (b.touching && b.fill < 0.9)) {
    if (!b.touching) {
      if (b.ground < -DEEP_SPOT && b.fill < 0.25) {
        return line(
          `① 이 자리는 이미 ${(-b.ground).toFixed(1)}m 팠습니다. 조금 선회해서(${kbd('A')} 또는 ${kbd('D')}) 옆자리를 파세요`,
          '10°쯤 옮기면 됩니다. 깊은 구덩이에서는 흙을 담기 어렵습니다',
        );
      }
      // 한 번에 한 동작씩: 끝낸 동작은 사라지고 다음 동작이 큰 글씨로 올라온다
      const steps: string[] = [];
      if (p.tipR < 6.2 || sim.arm.stroke > 0.55) steps.push(`${act('암을 펴서', 'armOut')} 버킷을 멀리 보내세요`);
      if (b.openUp > 35) steps.push(`${act('버킷을 펴서', 'open')} 입구가 '옆'이 되게 하세요`);
      else if (b.openUp < -25) steps.push(`${act('버킷을 조금 오므려', 'curl')} 입구가 '옆'이 되게 하세요`);
      steps.push(`${act('붐을 내려', 'boomDown')} 버킷 날을 땅에 대세요`);
      const little = b.fill > 0.04 ? ' 버킷에 흙이 절반도 안 찼으니 더 담으세요.' : '';
      const next = steps.length > 1 ? `다음: ${steps.slice(1).join(' → ')}.` : `${kbd('Shift')}를 누른 채 내리면 천천히 닿습니다.`;
      return line(`① ${steps[0]}`, `${next}${little} 버킷 입구 방향과 날 끝 높이는 왼쪽 "자세"에 나옵니다`);
    }
    if (b.fill < 0.25 && b.openUp > 40) {
      return line(
        `버킷 등이 땅에 닿았습니다. ${act('붐을 올리고', 'boomUp')} ${act('버킷을 펴서', 'open')} 날부터 넣으세요`,
        `입구가 '옆'을 볼 때 날이 땅을 파고듭니다 (지금: ${b.facing})`,
      );
    }
    if (b.openUp < -30) {
      return line(
        `버킷이 엎어져 있어 흙이 담기지 않습니다. ${act('붐을 올리고', 'boomUp')} ${act('버킷을 오므려', 'curl')} 입구가 '옆'이 되게 하세요`,
      );
    }
    if (stuck) {
      return line(
        `버킷이 흙에 막혔습니다. ${act('붐을 살짝 올리세요', 'boomUp')}`,
        '너무 깊이 박으면 움직이지 않습니다. 얕게 긁어야 합니다',
      );
    }
    return line(
      `② 날이 땅에 닿았습니다. ${act('암을 계속 당기면서', 'armIn')} ${act('버킷은 짧게 톡톡 오므리세요', 'curl')}`,
      `붐은 그만 내리세요. 버킷을 빨리 오므리면 흙을 담기 전에 땅에서 빠집니다. 버킷이 뜨면 ${act('붐을 조금 내리세요', 'boomDown')}`,
    );
  }

  // ── ③④⑤ 흙을 실은 상태 ──
  if (b.over) {
    return line(
      `버킷을 너무 오므려 뒤로 넘어갔습니다. ${act('조금 펴세요', 'open')}`,
      `입구가 '위'를 보면 멈추세요. 더 오므리면 흙이 운전석 쪽으로 떨어집니다`,
    );
  }
  if (b.above < 1.0 && b.openUp < FACING_UP && sim.bucket.stroke < 0.95) {
    return line(
      `③ ${act('버킷을 오므려', 'curl')} 입구가 '위'를 보면 멈추세요`,
      `지금: ${b.facing}. 덜 오므리면 들어 올릴 때 흘리고, 너무 오므리면 뒤로 넘어가 흘립니다`,
    );
  }
  if (b.above < 1.5) {
    return line(
      `④ ${act('붐을 올리세요', 'boomUp')}`,
      `붐을 올리면 버킷이 앞으로 기웁니다. 기울면 ${act('조금 더 오므리세요', 'curl')}`,
    );
  }
  const go = goTo(sim.site.dumpZone, '파란 구역', '⑤', ' 위로 가세요');
  return line(
    go.text,
    go.reach
      ? reachNote
      : `선회는 키를 놓아도 20°쯤 더 돕니다. 미리 놓고, 마지막은 ${kbd('Shift')}를 누른 채 맞추면 바로 멈춥니다`,
  );
}
