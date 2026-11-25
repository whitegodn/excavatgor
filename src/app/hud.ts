import { type LeverAxes, type LeverPattern, leverLabels } from '../core/input/levers';
import { DEG } from '../core/sim/math';
import { BUCKET_PROFILE } from '../equipment/excavator/bucketProfile';
import type { ExcavatorSim } from '../equipment/excavator/excavatorSim';
import type { Notice } from './coach';
import type { ProgressLine } from '../curriculum/task';
import { bucketView } from './guide';
import type { CameraMode } from './view/world';

export interface HudState {
  sim: ExcavatorSim;
  belt: boolean;
  engineOn: boolean;
  locked: boolean;
  rpm: number;
  pattern: LeverPattern;
  inputMode: string;
  /** 주행 고속 단 */
  fast: boolean;
  camera: CameraMode;
  levers: LeverAxes;
  fine: boolean;
  /** 가운데 위 "지금 할 일" 안내문(HTML). 없으면 빈 문자열 */
  prompt: string;
  notice: Notice | null;
  /** 지금 현장의 이름 */
  siteName: string;
  /** 굴착 측정(담긴 흙, 굴착 저항, 사이클)을 보여 줄 것인가. 주행 과제에서는 숨긴다 */
  showDig: boolean;
  /** 과제 중이면 과제 이름과 진행 상황, 자유 연습이면 null */
  task: { title: string; lines: ProgressLine[]; time: number; limit: number | null } | null;
  /** 지금 향해야 할 목표 지점 */
  focus: { x: number; y: number; z: number; radius: number } | null;
  /** 선회 경로의 장애물 줄 */
  hurdle: { x1: number; z1: number; x2: number; z2: number; height: number } | null;
  /** 운전석 시점에서 조종 장치 이름표를 붙일 화면 위치 */
  tags: { id: string; x: number; y: number }[];
  fps: number;
  verify: string;
}

// 옆모습 그림: 1m = SV 픽셀, 왼쪽 끝이 장비 뒤 3m, 위 끝이 지면 위 6.8m
const SV = 21;
const SV_R0 = -3;
const SV_Y1 = 6.8;
const SV_W = 13.6 * SV;
const SV_H = 9.6 * SV;
const sx = (r: number) => (r - SV_R0) * SV;
const sy = (y: number) => (SV_Y1 - y) * SV;
// 위에서 본 그림: 장비가 가운데, 1m = TV 픽셀
const TV = 6.4;
const TV_SIZE = 150;

const TEMPLATE = `
<div id="left">
  <div id="status" class="box">
    <h1>굴착기 시뮬레이터 <small id="siteName">평지 연습장</small></h1>
    <div class="chips">
      <span class="chip" id="chipBelt"></span>
      <span class="chip" id="chipEngine"></span>
      <span class="chip" id="chipLock"></span>
      <span class="chip">엔진 다이얼 <b id="chipRpm"></b></span>
      <span class="chip">레버 방식 <b id="chipPattern"></b></span>
      <span class="chip">입력 <b id="chipInput"></b></span>
      <span class="chip">시점 <b id="chipCam"></b></span>
      <span class="chip">주행 <b id="chipFast"></b></span>
    </div>
  </div>
  <div id="pose" class="box">
    <h2>자세 <small>옆에서 본 모습</small></h2>
    <svg id="side" viewBox="0 0 ${SV_W} ${SV_H}">
      <path id="svSoil" class="soil"></path>
      <line class="datum" x1="0" x2="${SV_W}" y1="${sy(0)}" y2="${sy(0)}"></line>
      <rect class="body" x="${sx(-1.8)}" y="${sy(0.75)}" width="${3.6 * SV}" height="${0.75 * SV}" rx="5"></rect>
      <rect class="body" x="${sx(-2.6)}" y="${sy(2.1)}" width="${3.5 * SV}" height="${1.2 * SV}" rx="3"></rect>
      <rect class="cabin" x="${sx(-0.15)}" y="${sy(2.65)}" width="${1.4 * SV}" height="${1.6 * SV}" rx="3"></rect>
      <line id="svBoom" class="part boom"></line>
      <line id="svArm" class="part arm"></line>
      <polygon id="svBucket" class="part bucket"></polygon>
      <text id="svBoomT" class="lbl boom">붐</text>
      <text id="svArmT" class="lbl arm">암</text>
      <text id="svBucketT" class="lbl bucket">버킷</text>
      <line id="svDrop" class="dropline"></line>
      <circle id="svTarget" class="target"></circle>
      <g id="svHurdle"><line class="hurdle" x1="0" x2="${SV_W}"></line><text class="hurdleT" x="4"></text></g>
      <text class="note" x="${SV_W - 4}" y="${sy(0) - 4}" text-anchor="end">처음 지면</text>
    </svg>
    <div class="poseRow">
      <svg id="top" viewBox="0 0 ${TV_SIZE} ${TV_SIZE}">
        <rect id="tvDig" class="zone dig"></rect>
        <rect id="tvDump" class="zone dump"></rect>
        <g id="tvMachine"><rect class="body" x="-8.5" y="-11.5" width="17" height="23" rx="2"></rect><path class="nose" d="M0 -16 L4 -11.5 L-4 -11.5 Z"></path></g>
        <line id="tvArm" class="reach"></line>
        <line id="tvHurdle" class="hurdle"></line>
        <circle id="tvTarget" class="target" r="6"></circle>
        <circle id="tvTip" r="5"></circle>
      </svg>
      <div class="readouts">
        <div class="ro"><span>날 끝 높이</span><b id="roHeight"></b></div>
        <div class="ro"><span>버킷 입구</span><b id="roFacing"></b></div>
        <div class="ro"><span>선회</span><b id="roSwing"></b></div>
        <div class="ro"><span>버킷 위치</span><b id="roZone"></b></div>
      </div>
    </div>
    <div class="strokes">
      <div class="st"><span class="boom">붐</span><i>내림</i><div class="sbar"><u id="stBoom"></u></div><i>올림</i></div>
      <div class="st"><span class="arm">암</span><i>폄</i><div class="sbar"><u id="stArm"></u></div><i>당김</i></div>
      <div class="st"><span class="bucket">버킷</span><i>폄</i><div class="sbar"><u id="stBucket"></u></div><i>오므림</i></div>
    </div>
  </div>
</div>
<div id="center">
  <div id="prompt"></div>
  <div id="notice" class="hidden"></div>
</div>
<div id="metrics" class="box">
  <div id="taskBox" class="hidden">
    <h2 id="taskTitle"></h2>
    <div id="taskLines"></div>
    <div class="sep"></div>
  </div>
  <div id="digMetrics">
  <h2>측정</h2>
  <div class="row"><span>버킷에 담긴 흙</span><span id="mLoad"></span></div>
  <div class="bar"><i id="barLoad"></i></div>
  <div class="row"><span>굴착 저항 <small>(흙이 버티는 힘)</small></span><span id="mResist"></span></div>
  <div class="bar warn"><i id="barResist"></i></div>
  <div class="row"><span>동시 조작으로 느려짐</span><span id="mShare"></span></div>
  <div class="sep"></div>
  <div class="row"><span>이번 사이클 시간</span><span id="mCycle"></span></div>
  <div class="row"><span>직전 / 최단</span><span id="mLast"></span></div>
  <div class="row"><span>완료한 사이클</span><span id="mCount"></span></div>
  <div class="sep"></div>
  <div class="row"><span id="lDumped">파란 구역에 쏟음</span><span id="mDumped"></span></div>
  <div class="row"><span>구역 밖에 흘림</span><span id="mSpilled"></span></div>
  <div class="row"><span>들다가 떨어뜨림</span><span id="mReturned"></span></div>
  </div>
  <div id="dev" class="hidden">
    <div class="sep"></div>
    <div class="row"><span>부피 보존 오차</span><span id="mError"></span></div>
    <div class="row"><span>재생 검증 <kbd>T</kbd></span><span id="mVerify"></span></div>
    <div class="row"><span>화면 갱신</span><span id="mFps"></span></div>
  </div>
</div>
<div id="levers">
  <div id="fine" class="hidden">미세 조작 (속도 1/4)</div>
  <div class="leverRow">
    <div class="grp">
      <div class="aux" id="auxLock">
        <div class="title">안전레버</div>
        <svg viewBox="0 0 44 64">
          <rect class="base" x="6" y="52" width="32" height="8" rx="3"></rect>
          <g id="lockArm"><line class="rod" x1="22" y1="54" x2="22" y2="18"></line><circle class="lockKnob" cx="22" cy="14" r="8"></circle></g>
        </svg>
        <div class="state" id="lockState"></div>
        <kbd>F</kbd>
      </div>
      <div class="lever" id="leverL">
        <div class="title">좌 레버</div>
        <div class="lab up"></div>
        <div class="lab left"></div><svg class="pad" viewBox="0 0 84 84">
        <circle class="plate" cx="42" cy="42" r="40"></circle>
        <path class="cross" d="M42 6 V78 M6 42 H78"></path>
        <circle class="boot" cx="42" cy="42" r="15"></circle>
        <line class="stick" x1="42" y1="42" x2="42" y2="42"></line>
        <circle class="knob" cx="42" cy="42" r="12"></circle>
        <circle class="shine" cx="38" cy="38" r="4"></circle>
      </svg><div class="lab right"></div>
        <div class="lab down"></div>
      </div>
    </div>
    <div class="travel">
      <div class="title">주행 레버·페달</div>
      <div class="bars" id="travelBars">
        <svg class="tlever" viewBox="0 0 40 84">
          <rect class="pedal" x="7" y="56" width="26" height="22" rx="4"></rect>
          <path class="tread" d="M11 62 H29 M11 67 H29 M11 72 H29"></path>
          <line class="rod" x1="20" y1="66" x2="20" y2="28"></line>
          <rect class="grip" x="10" y="16" width="20" height="13" rx="5"></rect>
        </svg>
        <svg class="tlever" viewBox="0 0 40 84">
          <rect class="pedal" x="7" y="56" width="26" height="22" rx="4"></rect>
          <path class="tread" d="M11 62 H29 M11 67 H29 M11 72 H29"></path>
          <line class="rod" x1="20" y1="66" x2="20" y2="28"></line>
          <rect class="grip" x="10" y="16" width="20" height="13" rx="5"></rect>
        </svg>
      </div>
      <div class="tkeys"><kbd>↑</kbd><kbd>↓</kbd> 전진·후진<br><kbd>←</kbd><kbd>→</kbd> 제자리 회전</div>
    </div>
    <div class="grp">
      <div class="lever" id="leverR">
        <div class="title">우 레버</div>
        <div class="lab up"></div>
        <div class="lab left"></div><svg class="pad" viewBox="0 0 84 84">
        <circle class="plate" cx="42" cy="42" r="40"></circle>
        <path class="cross" d="M42 6 V78 M6 42 H78"></path>
        <circle class="boot" cx="42" cy="42" r="15"></circle>
        <line class="stick" x1="42" y1="42" x2="42" y2="42"></line>
        <circle class="knob" cx="42" cy="42" r="12"></circle>
        <circle class="shine" cx="38" cy="38" r="4"></circle>
      </svg><div class="lab right"></div>
        <div class="lab down"></div>
      </div>
      <div class="aux" id="auxDial">
        <div class="title">엔진 다이얼</div>
        <svg viewBox="0 0 64 64">
          <circle class="dialRing" cx="32" cy="32" r="27"></circle>
          <path class="dialArc" d="M12.9 51.1 A27 27 0 1 1 51.1 51.1"></path>
          <g id="dialHand"><line class="hand" x1="32" y1="32" x2="32" y2="10"></line></g>
          <circle class="dialHub" cx="32" cy="32" r="11"></circle>
          <text id="dialNum" x="32" y="37" text-anchor="middle"></text>
        </svg>
        <div class="state">느림 ↔ 빠름</div>
        <span><kbd>−</kbd><kbd>+</kbd></span>
      </div>
    </div>
  </div>
  <div class="keys">
    <span><kbd>B</kbd> 안전벨트</span><span><kbd>R</kbd> 시동</span><span><kbd>Shift</kbd> 미세 조작</span>
    <span><kbd>Q</kbd> 주행 고속·저속</span><span><kbd>V</kbd> 운전석·외부 시점</span><span><kbd>G</kbd> 시범 보기</span><span><kbd>C</kbd> 안내 켜고 끄기</span><span><kbd>X</kbd> 레버 표시 접기</span><span><kbd>H</kbd> 도움말</span><span><kbd>Backspace</kbd> 다시 시작</span><span><kbd>Esc</kbd> 일시 정지·메뉴</span>
  </div>
</div>
<div id="tags">
  <div class="tag" data-id="joyL">좌 레버 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div>
  <div class="tag" data-id="joyR">우 레버 <kbd>I</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd></div>
  <div class="tag" data-id="travel">주행 레버·페달 <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></div>
  <div class="tag" data-id="lock">안전레버 <kbd>F</kbd></div>
  <div class="tag" data-id="dial">엔진 다이얼 <kbd>−</kbd><kbd>+</kbd></div>
</div>
<div id="help" class="box hidden">
  <h2>도움말 <small><kbd>H</kbd> 로 닫기</small></h2>
  <div class="cols">
    <div>
      <h3>장비 부위</h3>
      <p><b class="boom">붐</b> 차체에 붙은 굵은 팔. 올리고 내린다.</p>
      <p><b class="arm">암</b> 붐 끝에 달린 가는 팔. 펴고 당긴다.</p>
      <p><b class="bucket">버킷</b> 흙을 담는 바가지. 오므리면 담고, 펴면 쏟는다.</p>
      <p><b class="swing">선회</b> 차체 윗부분 전체가 좌우로 도는 것.</p>
      <h3>말뜻</h3>
      <p><b>사이클</b> 흙을 파서 → 쏟고 → 다시 팔 자리로 돌아오는 한 바퀴.</p>
      <p><b>덤프</b> 버킷의 흙을 쏟는 것.</p>
      <p><b>굴착 저항</b> 흙이 버티는 힘. 깊이 박을수록 커지고, 가득 차면 장비가 멈춘다.</p>
      <p><b>레버 방식</b> 레버와 동작의 짝. ISO가 표준이고 SAE는 붐과 암이 서로 바뀐다.</p>
      <p><b>엔진 다이얼</b> 1~10. 높을수록 모든 동작이 빠르다.</p>
    </div>
    <div>
      <h3>조작 키</h3>
      <div class="k"><span>안전벨트 / 경음기</span><span><kbd>B</kbd> / <kbd>Space</kbd></span></div>
      <div class="k"><span>시동 / 안전레버</span><span><kbd>R</kbd> / <kbd>F</kbd></span></div>
      <div class="k"><span>좌 레버</span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></div>
      <div class="k"><span>우 레버</span><span><kbd>I</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd></span></div>
      <div class="k"><span>주행</span><span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></span></div>
      <div class="k"><span>미세 조작 (누른 채)</span><span><kbd>Shift</kbd></span></div>
      <div class="k"><span>주행 고속 단 / 저속 단</span><span><kbd>Q</kbd></span></div>
      <div class="k"><span>엔진 다이얼</span><span><kbd>+</kbd> / <kbd>−</kbd></span></div>
      <div class="k"><span>시점 전환 (운전석·외부)</span><span><kbd>V</kbd></span></div>
      <div class="k"><span>레버 방식 바꾸기</span><span><kbd>P</kbd></span></div>
      <div class="k"><span>시범 보기</span><span><kbd>G</kbd></span></div>
      <div class="k"><span>단계 안내 켜고 끄기</span><span><kbd>C</kbd></span></div>
      <div class="k"><span>아래 레버 표시 접기</span><span><kbd>X</kbd></span></div>
      <div class="k"><span>처음부터 다시</span><span><kbd>Backspace</kbd></span></div>
      <div class="k"><span>일시 정지 · 메뉴</span><span><kbd>Esc</kbd></span></div>
      <div class="k"><span>소리 켜고 끄기</span><span><kbd>N</kbd></span></div>
      <div class="k"><span>그래픽 품질 (낮음·보통·높음)</span><span><kbd>Z</kbd></span></div>
      <div class="k"><span>개발자용 측정 표시</span><span><kbd>M</kbd></span></div>
      <h3>알아 두기</h3>
      <p>키 배치는 실제 레버와 같습니다. 레버를 앞으로 밀면(<kbd>I</kbd>) 붐이 내려가고, 당기면(<kbd>K</kbd>) 올라갑니다.</p>
      <p>키를 누르고 있으면 레버가 서서히 끝까지 기웁니다. 조금만 움직이려면 짧게 톡톡 누르세요.</p>
      <p>이 굴착기(크롤러식)에는 자동차 같은 가속 페달이 없습니다. 엔진 회전은 <b>엔진 다이얼</b>로 맞춰 두고, 발밑의 페달은 주행 레버와 함께 움직이는 <b>주행 페달</b>입니다.</p>
      <p>운전석 시점(<kbd>V</kbd>)에서는 실제 조종 레버가 보이고, 마우스로 끌어 발밑의 페달까지 둘러볼 수 있습니다.</p>
      <p>외부 시점에서는 마우스로 끌어 둘러보고 휠로 확대합니다. 컨테이너와 고깔은 방향을 알기 위한 표지입니다.</p>
    </div>
  </div>
</div>
`;

/** 운전석 이름표가 장치에서 어느 쪽으로 붙는지 */
const TAG_OFFSET: Record<string, string> = {
  joyL: 'translate(-50%, -160%)',
  joyR: 'translate(-50%, -160%)',
  travel: 'translate(-50%, -190%)',
  lock: 'translate(-108%, -30%)',
  dial: 'translate(12%, -60%)',
};

const LEFT_KEYS = { up: 'W', down: 'S', left: 'A', right: 'D' };
const RIGHT_KEYS = { up: 'I', down: 'K', left: 'J', right: 'L' };

/** 화면 위에 겹쳐 보여 주는 계기·안내 표시. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private pattern: LeverPattern | null = null;
  private slow = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = TEMPLATE;
    root.querySelectorAll<HTMLElement>('[id]').forEach((e) => (this.el[e.id] = e));
  }

  toggleHelp(): void {
    this.el.help.classList.toggle('hidden');
  }

  toggleDev(): void {
    this.el.dev.classList.toggle('hidden');
  }

  /** 익숙해진 뒤에는 아래 레버 설명을 접어 화면을 넓게 쓴다 */
  toggleLevers(): void {
    this.root.classList.toggle('nolevers');
  }

  private setLabels(pattern: LeverPattern): void {
    const labels = leverLabels(pattern);
    const iso = pattern === 'ISO';
    const part = {
      leverL: { up: iso ? 'arm' : 'boom', down: iso ? 'arm' : 'boom', left: 'swing', right: 'swing' },
      leverR: { up: iso ? 'boom' : 'arm', down: iso ? 'boom' : 'arm', left: 'bucket', right: 'bucket' },
    } as const;
    const fill = (id: 'leverL' | 'leverR', lab: Record<string, string>, keys: Record<string, string>) => {
      for (const side of ['up', 'down', 'left', 'right'] as const) {
        const node = this.el[id].querySelector<HTMLElement>(`.${side}`)!;
        node.innerHTML = `<span class="${part[id][side]}">${lab[side]}</span><kbd>${keys[side]}</kbd>`;
      }
    };
    fill('leverL', labels.left, LEFT_KEYS);
    fill('leverR', labels.right, RIGHT_KEYS);
  }

  /** 위에서 내려다본 조종 레버: 손잡이가 기울인 쪽으로 움직인다 */
  private setLever(id: string, x: number, y: number): void {
    const root = this.el[id];
    const kx = 42 + x * 27;
    const ky = 42 - y * 27;
    const stick = root.querySelector('.stick')!;
    stick.setAttribute('x2', kx.toFixed(1));
    stick.setAttribute('y2', ky.toFixed(1));
    const knob = root.querySelector('.knob')!;
    knob.setAttribute('cx', kx.toFixed(1));
    knob.setAttribute('cy', ky.toFixed(1));
    const shine = root.querySelector('.shine')!;
    shine.setAttribute('cx', (kx - 4).toFixed(1));
    shine.setAttribute('cy', (ky - 4).toFixed(1));
    root.querySelector('.pad')!.classList.toggle('moved', Math.abs(x) > 0.05 || Math.abs(y) > 0.05);
    root.querySelector('.up')!.classList.toggle('act', y > 0.05);
    root.querySelector('.down')!.classList.toggle('act', y < -0.05);
    root.querySelector('.left')!.classList.toggle('act', x < -0.05);
    root.querySelector('.right')!.classList.toggle('act', x > 0.05);
  }

  /** 주행 레버와 페달: 앞으로 밀면 손잡이가 위로, 페달 앞쪽이 눌린다 */
  private setTravel(svg: Element, v: number): void {
    const top = 28 - v * 12;
    svg.querySelector('.rod')!.setAttribute('y2', top.toFixed(1));
    svg.querySelector('.grip')!.setAttribute('y', (top - 12).toFixed(1));
    const pedal = svg.querySelector('.pedal')!;
    pedal.setAttribute('y', (56 - v * 4).toFixed(1));
    pedal.setAttribute('height', (22 + v * 3).toFixed(1));
    svg.classList.toggle('moved', Math.abs(v) > 0.05);
  }

  /** 옆모습·윗모습 그림과 자세 수치 */
  private updatePose(sim: ExcavatorSim, focus: HudState['focus'], hurdle: HudState['hurdle']): void {
    const el = this.el;
    const p = sim.pose();
    const sp = sim.spec;
    const attr = (node: Element, values: Record<string, number>) => {
      for (const key in values) node.setAttribute(key, values[key].toFixed(1));
    };
    // 지금 지면의 단면: 버킷이 향한 방향으로 0.4m마다 잰다
    let d = `M0 ${SV_H}`;
    for (let i = 0; i <= 34; i++) {
      const r = SV_R0 + i * 0.4;
      const h = sim.terrain.heightAt(p.baseX + p.fwdX * r, p.baseZ + p.fwdZ * r) - p.baseY;
      d += ` L${sx(r).toFixed(1)} ${sy(h).toFixed(1)}`;
    }
    el.svSoil.setAttribute('d', `${d} L${SV_W} ${SV_H} Z`);

    attr(el.svBoom, { x1: sx(p.pivotR), y1: sy(p.pivotY), x2: sx(p.elbowR), y2: sy(p.elbowY) });
    attr(el.svArm, { x1: sx(p.elbowR), y1: sy(p.elbowY), x2: sx(p.wristR), y2: sy(p.wristY) });
    const ca = Math.cos(p.a3);
    const sa = Math.sin(p.a3);
    let pts = '';
    for (const [c, n] of BUCKET_PROFILE) {
      const r = p.wristR + (c * ca - n * sa) * sp.bucketLen;
      const y = p.wristY + (c * sa + n * ca) * sp.bucketLen;
      pts += `${sx(r).toFixed(1)},${sy(y).toFixed(1)} `;
    }
    el.svBucket.setAttribute('points', pts);
    attr(el.svBoomT, { x: sx((p.pivotR + p.elbowR) / 2) - 6, y: sy((p.pivotY + p.elbowY) / 2) - 9 });
    attr(el.svArmT, { x: sx((p.elbowR + p.wristR) / 2) + 9, y: sy((p.elbowY + p.wristY) / 2) });
    attr(el.svBucketT, { x: sx(p.tipR) + 8, y: sy(p.tipY) + 4 });
    const S = sim.spool;
    el.svBoom.classList.toggle('act', S.boom !== 0);
    el.svArm.classList.toggle('act', S.arm !== 0);
    el.svBucket.classList.toggle('act', S.bucket !== 0);

    const b = bucketView(sim);
    attr(el.svDrop, { x1: sx(p.tipR), y1: sy(p.tipY), x2: sx(p.tipR), y2: sy(b.ground - p.baseY) });
    el.svDrop.style.display = b.above > 0.05 ? '' : 'none';

    // 위에서 본 모습: 장비가 가운데, 화면 위쪽이 처음 정면
    const c = TV_SIZE / 2;
    const tx = (x: number) => c + (x - sim.x) * TV;
    const tz = (z: number) => c - (z - sim.z) * TV;
    const zoneRect = (node: Element, zn: { x0: number; x1: number; z0: number; z1: number }) =>
      attr(node, { x: tx(zn.x0), y: tz(zn.z1), width: (zn.x1 - zn.x0) * TV, height: (zn.z1 - zn.z0) * TV });
    zoneRect(el.tvDig, sim.site.digZone);
    zoneRect(el.tvDump, sim.site.dumpZone);
    el.tvMachine.setAttribute('transform', `translate(${c} ${c}) rotate(${(sim.heading / DEG).toFixed(1)})`);
    attr(el.tvArm, { x1: c, y1: c, x2: tx(b.tipX), y2: tz(b.tipZ) });
    attr(el.tvTip, { cx: tx(b.tipX), cy: tz(b.tipZ) });
    el.tvTip.setAttribute('class', `tip ${b.zone}`);

    // 장애물 줄: 옆모습에는 넘어야 할 높이선으로, 윗모습에는 줄의 위치로
    el.svHurdle.style.display = hurdle ? '' : 'none';
    el.tvHurdle.style.display = hurdle ? '' : 'none';
    if (hurdle) {
      const y = sy(hurdle.height);
      const hl = el.svHurdle.querySelector('line')!;
      hl.setAttribute('y1', y.toFixed(1));
      hl.setAttribute('y2', y.toFixed(1));
      const ht = el.svHurdle.querySelector('text')!;
      ht.setAttribute('y', (y - 4).toFixed(1));
      ht.textContent = `장애물 줄 ${hurdle.height.toFixed(1)}m`;
      attr(el.tvHurdle, { x1: tx(hurdle.x1), y1: tz(hurdle.z1), x2: tx(hurdle.x2), y2: tz(hurdle.z2) });
    }

    // 과제의 목표 지점: 옆모습에는 "장비에서의 거리와 높이"로, 윗모습에는 방향으로 나타낸다
    el.svTarget.style.display = focus ? '' : 'none';
    el.tvTarget.style.display = focus ? '' : 'none';
    if (focus) {
      const reach = Math.hypot(focus.x - sim.x, focus.z - sim.z);
      attr(el.svTarget, { cx: sx(reach), cy: sy(focus.y - p.baseY), r: focus.radius * SV });
      attr(el.tvTarget, { cx: tx(focus.x), cy: tz(focus.z) });
    }

    // 수치
    const h = b.tipY;
    el.roHeight.textContent = b.touching
      ? h < -0.03
        ? `땅에 닿음 · 처음 지면보다 ${(-h).toFixed(2)} m 아래`
        : '땅에 닿음'
      : `지면 위 ${Math.max(0, b.above).toFixed(2)} m`;
    el.roHeight.className = b.touching ? 'hot' : '';
    el.roFacing.textContent = b.facing;
    el.roFacing.className = b.fill > 0.08 && b.facing !== '위' ? 'hot' : b.facing === '위' ? 'fine' : '';
    const swing = sim.swing / DEG;
    const side = (deg: number) => `${deg < 0 ? '왼쪽' : '오른쪽'} ${Math.abs(deg).toFixed(0)}°`;
    const heading = sim.heading / DEG;
    // 주행으로 차체를 돌렸으면 차체 방향도 함께 보여 준다
    el.roSwing.textContent =
      (Math.abs(swing) < 0.5 ? '정면' : side(swing)) + (Math.abs(heading) < 0.5 ? '' : ` · 차체 ${side(heading)}`);
    el.roZone.textContent = b.zone === 'dig' ? '노란 구역 위' : b.zone === 'dump' ? (sim.site.truck ? '트럭 적재함 위' : '파란 구역 위') : '구역 밖';
    el.lDumped.textContent = sim.site.truck ? '트럭에 실음' : '파란 구역에 쏟음';
    el.roZone.className = b.zone;

    const stroke = (node: HTMLElement, v: number) => {
      node.style.width = `${(v * 100).toFixed(0)}%`;
      node.parentElement!.classList.toggle('end', v < 0.015 || v > 0.985);
    };
    stroke(el.stBoom, sim.boom.stroke);
    stroke(el.stArm, sim.arm.stroke);
    stroke(el.stBucket, sim.bucket.stroke);
  }

  update(s: HudState): void {
    const el = this.el;
    const sim = s.sim;
    if (this.pattern !== s.pattern) {
      this.pattern = s.pattern;
      this.setLabels(s.pattern);
    }
    this.root.classList.toggle('cab', s.camera === 'cab');
    el.chipBelt.textContent = s.belt ? '안전벨트 맴' : '안전벨트 안 맴';
    el.chipBelt.className = `chip ${s.belt ? 'on' : 'off'}`;
    el.chipEngine.textContent = s.engineOn ? '시동 켜짐' : '시동 꺼짐';
    el.chipEngine.className = `chip ${s.engineOn ? 'on' : 'off'}`;
    el.chipLock.textContent = s.locked ? '안전레버 잠김' : '안전레버 해제';
    el.chipLock.className = `chip ${s.locked ? 'off' : 'on'}`;
    el.chipRpm.textContent = `${s.rpm}/10`;
    el.chipPattern.textContent = s.pattern;
    el.chipInput.textContent = s.inputMode;
    el.chipCam.textContent = s.camera === 'cab' ? '운전석' : '외부';
    el.chipFast.textContent = s.fast ? '고속' : '저속';

    const prompt = s.prompt;
    el.prompt.classList.toggle('hidden', prompt === '');
    if (prompt !== '' && el.prompt.innerHTML !== prompt) el.prompt.innerHTML = prompt;
    el.notice.classList.toggle('hidden', !s.notice);
    if (s.notice) {
      if (el.notice.textContent !== s.notice.text) el.notice.textContent = s.notice.text;
      el.notice.className = s.notice.kind;
    }

    this.setLever('leverL', s.levers.lx, s.levers.ly);
    this.setLever('leverR', s.levers.rx, s.levers.ry);
    const tracks = el.travelBars.querySelectorAll('.tlever');
    this.setTravel(tracks[0], s.levers.tl);
    this.setTravel(tracks[1], s.levers.tr);
    // 안전레버: 세워져 있으면 잠김, 눕히면 해제
    el.lockArm.setAttribute('transform', `rotate(${s.locked ? -8 : 62} 22 54)`);
    el.auxLock.classList.toggle('locked', s.locked);
    el.lockState.textContent = s.locked ? '잠김' : '해제';
    el.dialHand.setAttribute('transform', `rotate(${-135 + ((s.rpm - 1) / 9) * 270} 32 32)`);
    el.dialNum.textContent = String(s.rpm);
    el.auxDial.classList.toggle('off', !s.engineOn);
    // 운전석 시점: 실제 조종 장치 위에 이름표를 붙인다
    el.tags.querySelectorAll<HTMLElement>('.tag').forEach((tag) => {
      const at = s.tags.find((t) => t.id === tag.dataset.id);
      tag.style.display = at ? '' : 'none';
      if (at) tag.style.transform = `translate(${at.x.toFixed(0)}px, ${at.y.toFixed(0)}px) ${TAG_OFFSET[at.id] ?? 'translate(-50%, -150%)'}`;
    });
    el.fine.classList.toggle('hidden', !s.fine);

    this.updatePose(sim, s.focus, s.hurdle);

    el.siteName.textContent = s.siteName;
    el.digMetrics.classList.toggle('hidden', !s.showDig);
    el.taskBox.classList.toggle('hidden', !s.task);
    if (s.task) {
      const t = s.task;
      const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
      const left = t.limit === null ? null : Math.max(0, t.limit - t.time);
      const rows = [
        ...t.lines,
        left === null
          ? { label: '걸린 시간', value: clock(t.time) }
          : { label: '남은 시간', value: clock(left), tone: left < 20 ? ('warn' as const) : undefined },
      ];
      el.taskTitle.textContent = t.title;
      el.taskLines.innerHTML = rows
        .map((r) => `<div class="row"><span>${r.label}</span><span class="${r.tone === 'warn' ? 'warnText' : r.tone === 'good' ? 'ok' : ''}">${r.value}</span></div>`)
        .join('');
    }

    const cap = sim.spec.bucketCapacity;
    const fill = sim.load / cap;
    el.mLoad.textContent = `${sim.load.toFixed(2)} m³ (${Math.round(fill * 100)}%)`;
    el.barLoad.style.width = `${Math.min(100, fill * 100).toFixed(0)}%`;
    // 암·버킷으로 긁을 때 흙이 버티는 정도 (붐으로 누르는 힘의 한계는 알림으로 따로 알려 준다)
    const resist = 1 - sim.soilResist;
    el.mResist.textContent = resist < 0.05 ? '없음' : resist < 0.45 ? '적당' : resist < 0.85 ? '깊음' : '막힘';
    el.mResist.className = resist >= 0.85 ? 'warnText' : '';
    el.barResist.style.width = `${(resist * 100).toFixed(0)}%`;
    el.mShare.textContent = sim.flowShare > 0.99 ? '없음' : `${Math.round((1 - sim.flowShare) * 100)}%`;
    el.mCycle.textContent = `${sim.cycleTime.toFixed(1)} 초`;
    el.mLast.textContent =
      sim.cycles === 0 ? '—' : `${sim.lastCycleTime.toFixed(1)} / ${sim.bestCycleTime.toFixed(1)} 초`;
    el.mCount.textContent = `${sim.cycles} 회`;
    el.mDumped.textContent = `${sim.dumped.toFixed(2)} m³`;
    el.mSpilled.textContent = `${sim.spilled.toFixed(2)} m³`;
    el.mSpilled.className = sim.spilled > 0.05 ? 'warnText' : '';
    el.mReturned.textContent = `${sim.returned.toFixed(2)} m³`;

    // 지형 전체를 더하는 계산이라 가끔만 한다
    if (--this.slow <= 0) {
      this.slow = 30;
      const err = sim.conservationError();
      el.mError.textContent = `${err.toFixed(3)} %`;
      el.mError.className = err < 1 ? 'ok' : 'warnText';
      el.mFps.textContent = `${Math.round(s.fps)} fps · 계산 60 Hz`;
    }
    el.mVerify.textContent = s.verify;
    el.mVerify.className = s.verify.startsWith('일치') ? 'ok' : s.verify.startsWith('불일치') ? 'warnText' : '';
  }
}
