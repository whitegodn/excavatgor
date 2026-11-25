import type { LeverPattern } from '../core/input/levers';
import { clamp, DEG, wrapAngle } from '../core/sim/math';
import type { ExcavatorSim } from '../equipment/excavator/excavatorSim';
import { type Zone, type ZoneKind, zoneAt } from '../sites/site';

/** 장비 동작 하나. 레버 방식에 따라 누르는 키가 달라진다. */
export type Fn = 'armOut' | 'armIn' | 'boomDown' | 'boomUp' | 'curl' | 'open' | 'swingL' | 'swingR';

export function keyFor(fn: Fn, pattern: LeverPattern): string {
  const iso = pattern === 'ISO';
  switch (fn) {
    case 'armOut':
      return iso ? 'W' : 'I';
    case 'armIn':
      return iso ? 'S' : 'K';
    case 'boomDown':
      return iso ? 'I' : 'W';
    case 'boomUp':
      return iso ? 'K' : 'S';
    case 'curl':
      return 'J';
    case 'open':
      return 'L';
    case 'swingL':
      return 'A';
    case 'swingR':
      return 'D';
  }
}

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
  zone: ZoneKind;
  /** 버킷 입구가 수평에서 위로 향한 각도(도). 90 = 똑바로 위 */
  openUp: number;
  facing: '위' | '비스듬히 위' | '옆' | '아래';
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
  return {
    tipX,
    tipZ,
    tipY,
    ground,
    above,
    zone: zoneAt(sim.site, tipX, tipZ),
    openUp,
    facing: openUp > 50 ? '위' : openUp > 15 ? '비스듬히 위' : openUp > -15 ? '옆' : '아래',
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

export interface GuideState {
  sim: ExcavatorSim;
  engineOn: boolean;
  locked: boolean;
  pattern: LeverPattern;
  /** 단계별 안내를 켰는가 (C 키) */
  coach: boolean;
  /** 시범 운전 중이면 지금 단계 설명, 아니면 null */
  demo: string | null;
}

const kbd = (key: string) => `<kbd>${key}</kbd>`;

/**
 * 화면 가운데 위에 띄우는 "지금 할 일" 안내문(HTML).
 * 장비 상태를 보고 굴착 → 가두기 → 들기 → 선회 → 쏟기 → 복귀 중 어느 단계인지 판단한다.
 * 키는 항상 동작 바로 뒤 괄호에 넣는다. 예: 암을 펴서(W)
 * 화면과 연습 도구(tools/trainee.ts)가 같은 문구를 쓴다.
 */
export function guideText(s: GuideState): string {
  if (s.demo) {
    return `시범 운전 중: ${s.demo}<small>아래 레버 표시를 보며 순서를 익히세요 · ${kbd('G')} 중지 · 시범은 엔진 다이얼을 10으로 올려 빠르게 보여 줍니다</small>`;
  }
  if (!s.engineOn) return `${kbd('R')} 키를 눌러 시동을 거세요`;
  if (s.locked) {
    return `${kbd('F')} 키를 눌러 안전레버를 해제하세요<small>잠겨 있으면 레버를 움직여도 장비가 움직이지 않습니다</small>`;
  }
  if (!s.coach) return '';

  const sim = s.sim;
  const b = bucketView(sim);
  /** "암을 펴서" + (W) */
  const act = (text: string, fn: Fn) => `${text}(${kbd(keyFor(fn, s.pattern))})`;
  // 버킷의 1/4도 안 찼으면 아직 파는 중으로 본다
  const loaded = b.fill > 0.25;
  // 쏟기 시작했으면 버킷이 빌 때까지 "쏟기" 단계다
  const dumping = sim.dumpingStarted && b.fill > 0.03;
  const stuck = 1 - sim.soilResist >= 0.85 && b.touching;

  const toZone = (zone: Zone, name: string, step: string, after: string): string => {
    const t = turnToward(sim, zone);
    if (t.off > 12) return `${step} ${act(`${t.word}으로 선회해`, t.fn)} ${name} ${after}`;
    // 방향은 맞는데 버킷이 구역에 못 미치거나 지나친 경우
    const reach = sim.pose().tipR < t.dist ? act('암을 펴서', 'armOut') : act('암을 당겨서', 'armIn');
    return `${step} 방향은 맞습니다. ${reach} 버킷을 ${name} 위로 옮기세요`;
  };

  if (!dumping && (sim.awaitingReturn || (!loaded && b.zone !== 'dig'))) {
    const head = toZone(sim.site.digZone, '노란 구역으로', '⑦', '돌아가세요');
    return `${head}<small>돌면서 ${act('암을 펴고', 'armOut')} ${act('버킷을 펴 두면', 'open')} 다음 굴착이 빨라집니다</small>`;
  }

  if (dumping || (loaded && b.zone === 'dump' && b.above > 0.4)) {
    if (b.zone !== 'dump') {
      return `${toZone(sim.site.dumpZone, '파란 구역', '⑥', '위로 가서 남은 흙을 쏟으세요')}<small>버킷에 흙이 남아 있습니다</small>`;
    }
    if (sim.bucket.stroke < 0.03) {
      return `⑥ 버킷을 다 폈는데 흙이 남았습니다. ${act('암을 펴세요', 'armOut')}<small>암이 접혀 있으면 버킷 입구가 아래를 향하지 못합니다</small>`;
    }
    return `⑥ ${act('버킷을 끝까지 펴서', 'open')} 흙을 다 쏟으세요<small>바닥의 원 표시가 흙이 떨어질 자리입니다. 버킷이 빌 때까지 계속 누르세요</small>`;
  }

  if (!loaded || (b.touching && b.fill < 0.9)) {
    const deep = b.ground < -0.7 ? ` 이 자리는 이미 깊이 팠습니다. 조금 선회해서 옆자리를 파세요.` : '';
    if (!b.touching) {
      const parts: string[] = [];
      if (sim.pose().tipR < 6.2) parts.push(`${act('암을 펴서', 'armOut')} 버킷을 멀리 보내고`);
      if (b.openUp > 40) parts.push(act('버킷을 펴고', 'open'));
      else if (b.openUp < -25) parts.push(`${act('버킷을 조금 오므려', 'curl')} 날이 비스듬히 아래를 향하게 하고`);
      parts.push(`${act('붐을 내려', 'boomDown')} 버킷 날을 땅에 대세요`);
      const little = b.fill > 0.04 ? ' 버킷에 흙이 조금뿐이니 더 담으세요.' : '';
      return `① ${parts.join(', ')}<small>${kbd('Shift')}를 누른 채 내리면 천천히 닿습니다. 닿으면 왼쪽 "자세"의 날 끝 높이가 노랗게 바뀝니다.${little}${deep}</small>`;
    }
    if (stuck) {
      return `버킷이 흙에 막혔습니다. ${act('붐을 살짝 올리세요', 'boomUp')}<small>너무 깊이 박으면 움직이지 않습니다. 얕게 긁어야 합니다.${deep}</small>`;
    }
    return `② 날이 땅에 닿았습니다. ${act('암을 당기면서', 'armIn')} ${act('버킷을 조금씩 오므리세요', 'curl')}<small>붐은 그만 내리고 얕게 긁듯이. "굴착 저항"이 가득 차면 ${act('붐을 살짝 올리세요', 'boomUp')}.${deep}</small>`;
  }

  // 여기부터는 흙을 실은 상태
  if (b.above < 1.0 && b.openUp < 68 && sim.bucket.stroke < 0.95) {
    return `③ ${act('버킷을 끝까지 오므려', 'curl')} 흙을 가두세요<small>입구가 똑바로 위를 볼 때까지. 덜 오므리면 들어 올릴 때 흘립니다 (지금: ${b.facing})</small>`;
  }
  if (b.above < 1.5) {
    return `④ ${act('붐을 올리세요', 'boomUp')}<small>붐을 올리면 버킷이 앞으로 기웁니다. 기울면 ${act('조금 더 오므리세요', 'curl')}</small>`;
  }
  return `${toZone(sim.site.dumpZone, '파란 구역', '⑤', '위로 가세요')}<small>선회는 키를 놓아도 조금 더 돕니다. 도착하기 전에 미리 놓으세요</small>`;
}
