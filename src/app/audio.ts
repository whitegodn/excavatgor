import type { ExcavatorSim } from '../equipment/excavator/excavatorSim';

export interface AudioState {
  sim: ExcavatorSim;
  /** 장비 소리를 낼 상황인가 (조작 화면이고 시동이 켜져 있음) */
  engineOn: boolean;
  /** 엔진 다이얼 1..10 */
  rpm: number;
  horn: boolean;
}

/**
 * 장비 소리. 녹음 파일 없이 브라우저의 소리 합성(Web Audio)으로 만든다.
 * 엔진음은 엔진 다이얼과 부하에 따라 높낮이와 크기가 변하고,
 * 유압·선회·궤도·굴착·쏟기 소리는 장비의 실제 움직임에서 값을 받아 온다.
 */
export class SimAudio {
  muted = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private p: Record<string, AudioParam> = {};
  private wasOn = false;
  private lastStroke = [0.5, 0.5, 0.5];
  private beepUntil = 0;

  /** 브라우저는 사용자가 키나 마우스를 누른 뒤에만 소리를 허용한다 */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // 엔진: 낮은 톱니파 셋 + 디젤 특유의 덜덜거림
    const engine = this.gain('engine', 0, this.master);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    lp.Q.value = 1.2;
    lp.connect(engine);
    this.p.engineCut = lp.frequency;
    for (const [id, type, level] of [
      ['f1', 'sawtooth', 0.5],
      ['f2', 'square', 0.28],
      ['f3', 'sawtooth', 0.2],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 40;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(lp);
      o.start();
      this.p[id] = o.frequency;
    }
    const rattle = this.noiseBand('rattle', 110, 1.5, engine, 'bandpass');
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 20;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.25;
    lfo.connect(lfoGain).connect(rattle.gain);
    lfo.start();
    this.p.rattleRate = lfo.frequency;

    // 유압: 쉬익 하는 바람 소리 + 가는 울음
    this.noiseBand('hyd', 2400, 0.7, this.master, 'bandpass');
    this.tone('whine', 'triangle', 520, this.master);
    // 선회 모터, 궤도, 굴착, 쏟기
    this.tone('swing', 'sine', 200, this.master);
    this.noiseBand('track', 170, 0.8, this.master, 'lowpass');
    this.noiseBand('clank', 950, 3, this.master, 'bandpass');
    this.noiseBand('dig', 520, 0.8, this.master, 'bandpass');
    this.noiseBand('pour', 1100, 0.6, this.master, 'lowpass');
    // 경음기, 후진 경고음
    const horn = this.gain('horn', 0, this.master);
    for (const f of [311, 392]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.16;
      o.connect(g).connect(horn);
      o.start();
    }
    this.tone('beep', 'sine', 1180, this.master);
  }

  private gain(id: string, value: number, out: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = value;
    g.connect(out);
    this.p[id] = g.gain;
    return g;
  }

  /** 걸러 낸 잡음 한 줄기. 크기는 this.p[id]로 조절한다 */
  private noiseBand(id: string, freq: number, q: number, out: AudioNode, type: BiquadFilterType): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.gain(id, 0, out);
    src.connect(f).connect(g);
    src.start();
    this.p[`${id}Freq`] = f.frequency;
    return g;
  }

  private tone(id: string, type: OscillatorType, freq: number, out: AudioNode): void {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(this.gain(id, 0, out));
    o.start();
    this.p[`${id}Freq`] = o.frequency;
  }

  private set(id: string, value: number, smooth = 0.06): void {
    this.p[id]?.setTargetAtTime(value, this.ctx!.currentTime, smooth);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** 짧은 알림음: 잘했을 때는 올라가는 두 음, 실수했을 때는 낮은 한 음 */
  blip(kind: 'good' | 'warn'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = kind === 'good' ? [880, 1320] : [196];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = kind === 'good' ? 'sine' : 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(kind === 'good' ? 0.16 : 0.1, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + (kind === 'good' ? 0.25 : 0.32));
      o.connect(g).connect(this.master);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.4);
    });
  }

  /** 실린더가 끝까지 가서 멈출 때의 둔탁한 소리 */
  private clunk(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** 매 화면마다 장비 상태를 소리에 반영한다 */
  update(s: AudioState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const sim = s.sim;
    const sp = sim.spool;
    const on = s.engineOn;
    const work = Math.abs(sp.boom) + Math.abs(sp.arm) + Math.abs(sp.bucket);
    const swing = Math.abs(sim.swingVel) / sim.spec.swingMax;
    const travel = (Math.abs(sim.trackL) + Math.abs(sim.trackR)) / (2 * sim.spec.travelMax);
    // 부하: 여러 동작을 함께 할수록, 흙이 버틸수록 엔진이 힘들어한다
    const strain = work > 0.05 || Math.abs(sp.swing) > 0.05 ? 1 - sim.digResist : 0;
    const load = on ? Math.min(1, work * 0.3 + Math.abs(sp.swing) * 0.25 + travel * 0.35 + strain * 0.45) : 0;

    // 시동을 걸면 낮은 데서 올라오고, 끄면 내려가며 멎는다
    const base = on ? (27 + s.rpm * 3.3) * (1 - 0.08 * load) : 9;
    const glide = on !== this.wasOn ? 0.35 : 0.08;
    this.wasOn = on;
    this.set('f1', base, glide);
    this.set('f2', base * 0.5, glide);
    this.set('f3', base * 2.02, glide);
    this.set('rattleRate', base * 0.5, glide);
    this.set('engine', on ? 0.2 + 0.13 * load : 0, on ? 0.12 : 0.4);
    this.set('engineCut', 220 + s.rpm * 22 + load * 380);
    this.set('rattle', on ? 0.35 + 0.3 * load : 0);

    const flow = on ? Math.min(1, work * sim.flowShare * 0.7) : 0;
    this.set('hyd', flow * 0.11);
    this.set('whine', flow * 0.012);
    this.set('whineFreq', 430 + s.rpm * 22 + load * 120);
    this.set('swing', on ? Math.min(1, swing) * 0.035 : 0);
    this.set('swingFreq', 150 + swing * 260);
    this.set('track', Math.min(1, travel) * 0.5);
    this.set('clank', Math.min(1, travel) * 0.07);
    this.set('clankFreq', 700 + travel * 700);
    this.set('dig', Math.min(1, sim.cutRate / 0.35) * 0.3, 0.1);
    this.set('pour', Math.min(1, sim.dropRate / 0.6) * 0.3, 0.08);
    this.set('horn', s.horn ? 1 : 0, 0.01);

    // 후진 경고음: 0.5초 울리고 0.5초 쉰다
    const reversing = on && sim.trackL + sim.trackR < -0.15;
    const t = ctx.currentTime;
    if (reversing && t > this.beepUntil + 0.5) this.beepUntil = t + 0.5;
    this.set('beep', reversing && t < this.beepUntil ? 0.07 : 0, 0.01);

    // 실린더가 끝에 닿는 순간
    const strokes = [sim.boom.stroke, sim.arm.stroke, sim.bucket.stroke];
    strokes.forEach((v, i) => {
      const was = this.lastStroke[i];
      if (on && ((v >= 0.999 && was < 0.999) || (v <= 0.001 && was > 0.001))) this.clunk();
      this.lastStroke[i] = v;
    });
  }
}
