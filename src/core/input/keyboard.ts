export type KeyAction =
  | 'engine'
  | 'lock'
  | 'rpmUp'
  | 'rpmDown'
  | 'camera'
  | 'help'
  | 'pattern'
  | 'demo'
  | 'verify'
  | 'horn'
  | 'restart'
  | 'coach'
  | 'levers'
  | 'belt'
  | 'pause'
  | 'confirm'
  | 'dev';

const ACTIONS: Record<string, KeyAction> = {
  KeyR: 'engine',
  KeyF: 'lock',
  Equal: 'rpmUp',
  NumpadAdd: 'rpmUp',
  Minus: 'rpmDown',
  NumpadSubtract: 'rpmDown',
  KeyV: 'camera',
  Tab: 'camera',
  KeyH: 'help',
  KeyP: 'pattern',
  KeyG: 'demo',
  KeyT: 'verify',
  Space: 'horn',
  Backspace: 'restart',
  KeyC: 'coach',
  KeyX: 'levers',
  KeyB: 'belt',
  Escape: 'pause',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  KeyM: 'dev',
};

const PREVENT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace']);

/** 브라우저 키 이벤트를 모은다. 레버 키는 눌림 상태로, 스위치 키는 동작으로 전달한다. */
export class KeyboardInput {
  readonly keys = new Set<string>();
  onAction: (action: KeyAction) => void = () => {};

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const action = ACTIONS[e.code];
      if (action) this.onAction(action);
    });
    target.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    target.addEventListener('blur', () => this.keys.clear());
  }

  get fine(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }
}
