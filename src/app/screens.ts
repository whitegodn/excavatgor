import type { LeverPattern } from '../core/input/levers';
import type { Score } from '../core/scoring/score';
import type { Progress, TaskRecord } from '../curriculum/progress';
import type { LevelDef, QuizQuestion, TaskDef } from '../curriculum/task';
import type { CycleReport } from '../equipment/excavator/excavatorSim';

export type ScreenAction =
  | { act: 'task'; id: string }
  | { act: 'free' }
  | { act: 'begin' }
  | { act: 'menu' }
  | { act: 'retry' }
  | { act: 'next' }
  | { act: 'resume' }
  | { act: 'pattern' }
  | { act: 'reset' }
  | { act: 'quizDone'; correct: number; total: number };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** 결과 화면에 덧붙이는 기록: 과제 중 나온 실수 알림, 사이클별 결과 */
export interface ResultExtra {
  notes: string[];
  cycles: CycleReport[];
}

const FAULT_LABEL: Record<string, string> = {
  returned: '세지 않음 · 담은 흙을 도로 떨어뜨림',
  none: '세지 않음 · 파란 구역에 거의 못 쏟음',
  spill: '세지 않음 · 구역 밖에 많이 흘림',
  source: '세지 않음 · 노란 구역 밖에서 팜',
};

/** 퀴즈를 풀 때마다 보기 순서를 섞는다 (정답 자리를 외워서 푸는 것을 막는다) */
function shuffled(q: QuizQuestion): QuizQuestion {
  const order = q.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, choices: order.map((i) => q.choices[i]), answer: order.indexOf(q.answer) };
}

/**
 * 장비 화면 위에 덮는 화면들: 과정 메뉴, 과제 설명, 퀴즈, 일시 정지, 결과.
 * 단추는 마우스로 누르거나 Enter(기본 단추), Esc(뒤로)로 고른다.
 */
export class Screens {
  onAction: (a: ScreenAction) => void = () => {};
  private quiz: { questions: QuizQuestion[]; index: number; correct: number; answered: number | null } | null = null;

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || el.hasAttribute('disabled')) return;
      const act = el.dataset.act!;
      if (act === 'choice') this.answer(Number(el.dataset.i));
      else if (act === 'quizNext') this.quizNext();
      else if (act === 'task') this.onAction({ act, id: el.dataset.id! });
      else this.onAction({ act } as ScreenAction);
    });
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  hide(): void {
    this.quiz = null;
    this.root.classList.add('hidden');
    document.body.classList.remove('screen-open');
  }

  private show(html: string, wide = false): void {
    this.root.innerHTML = `<div class="card${wide ? ' wide' : ''}">${html}</div>`;
    this.root.classList.remove('hidden');
    document.body.classList.add('screen-open');
    this.root.querySelector<HTMLElement>('.card')!.scrollTop = 0;
  }

  /** Enter: 기본 단추 */
  confirm(): void {
    this.root.querySelector<HTMLElement>('[data-primary]')?.click();
  }

  /** Esc: 뒤로 */
  back(): void {
    this.root.querySelector<HTMLElement>('[data-back]')?.click();
  }

  /** 숫자 키: 퀴즈 보기 고르기 */
  digit(n: number): void {
    if (this.quiz && this.quiz.answered === null) this.answer(n - 1);
  }

  // ── 과정 메뉴 ──
  menu(levels: readonly LevelDef[], tasks: readonly TaskDef[], progress: Progress, pattern: LeverPattern): void {
    const next = progress.next();
    const badge = progress.badge();
    const done = tasks.filter((t) => progress.get(t.id)?.passed).length;
    let html = `
      <header>
        <div>
          <h1>굴착기 시뮬레이터</h1>
          <p class="sub">① 자격증 취득 과정 · 굴착기운전기능사 실기 대비</p>
        </div>
        <div class="badge ${badge ? 'earned' : ''}">
          <b>${badge ? `${badge.tier} · ${badge.name}` : '등급 없음'}</b>
          <span>${badge ? '레벨 0~2 통과' : '레벨 0~2를 모두 통과하면 브론즈 등급'}</span>
        </div>
      </header>
      <div class="bar"><i style="width:${Math.round((done / tasks.length) * 100)}%"></i></div>
      <p class="sub">과제 ${done} / ${tasks.length} 통과</p>`;
    for (const lv of levels) {
      const list = tasks.filter((t) => t.level === lv.level);
      html += `<section><h2>레벨 ${lv.level} · ${esc(lv.name)} <small>${esc(lv.summary)}</small></h2>`;
      if (lv.comingSoon) {
        html += `<p class="soon">준비 중 · ${esc(lv.comingSoon)}</p>`;
      } else {
        html += '<div class="tasks">';
        for (const t of list) {
          const rec = progress.get(t.id);
          const unlocked = progress.isUnlocked(t.id);
          const state = rec?.passed ? 'passed' : unlocked ? 'open' : 'locked';
          const mark = rec?.passed ? `통과 · 최고 ${rec.best}점` : rec ? `최고 ${rec.best}점` : unlocked ? '새 과제' : '잠김 · 앞 과제를 통과하면 열림';
          html += `
            <button class="task ${state}" data-act="task" data-id="${t.id}" ${unlocked ? '' : 'disabled'}
              ${next?.id === t.id ? 'data-primary' : ''}>
              <span class="tid">${t.id}</span>
              <span class="tt"><b>${esc(t.title)}${t.provisional ? ' <em>임시 규격</em>' : ''}</b><small>${esc(t.summary)}</small></span>
              <span class="tm">${mark}</span>
            </button>`;
        }
        html += '</div>';
      }
      html += '</section>';
    }
    html += `
      <footer>
        <button data-act="free">자유 연습 <small>과제 없이 연습장에서</small></button>
        <button data-act="pattern">레버 방식: ${pattern} <small>누르면 바뀜</small></button>
        <button data-act="reset" class="quiet">기록 지우기</button>
      </footer>
      <p class="hint"><kbd>Enter</kbd> 이어서 할 과제 시작${next ? ` (${next.id} ${esc(next.title)})` : ''}</p>`;
    this.show(html, true);
  }

  // ── 과제 설명 ──
  brief(task: TaskDef, record: TaskRecord | null): void {
    const limit = task.timeLimit ? `${Math.floor(task.timeLimit / 60)}분${task.timeLimit % 60 ? ` ${task.timeLimit % 60}초` : ''}` : '없음';
    const help = { full: '단계 안내와 실수 알림', notices: '실수 알림만', none: '없음 (시험 방식)' }[task.coach];
    this.show(`
      <p class="sub">레벨 ${task.level} · ${task.id}${task.provisional ? ' · <em>임시 규격</em>' : ''}</p>
      <h1>${esc(task.title)}</h1>
      <ul class="brief">${task.brief.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
      <div class="facts">
        <div><span>합격 기준</span><b>${esc(task.passText)}</b></div>
        <div><span>제한 시간</span><b>${limit}</b></div>
        ${task.quiz ? '' : `<div><span>화면 도움</span><b>${help}</b></div>`}
        <div><span>내 기록</span><b>${record ? `최고 ${record.best}점 · ${record.attempts}번 시도${record.passed ? ' · 통과' : ''}` : '첫 시도'}</b></div>
      </div>
      ${task.quiz ? '' : '<p class="hint">시작하면 안전벨트(<kbd>B</kbd>) → 시동(<kbd>R</kbd>) → 안전레버 해제(<kbd>F</kbd>) 순서로 준비합니다. 시간은 안전레버를 푼 뒤부터 잽니다.</p>'}
      <footer>
        <button data-act="begin" data-primary class="primary">시작 <kbd>Enter</kbd></button>
        <button data-act="menu" data-back>메뉴로 <kbd>Esc</kbd></button>
      </footer>`);
  }

  // ── 퀴즈 ──
  startQuiz(task: TaskDef): void {
    this.quiz = { questions: task.quiz!.map(shuffled), index: 0, correct: 0, answered: null };
    this.renderQuiz(task.title);
  }

  private quizTitle = '';

  private renderQuiz(title?: string): void {
    if (title) this.quizTitle = title;
    const qz = this.quiz!;
    const q = qz.questions[qz.index];
    const answered = qz.answered !== null;
    const right = qz.answered === q.answer;
    this.show(`
      <p class="sub">${esc(this.quizTitle)} · 문제 ${qz.index + 1} / ${qz.questions.length}</p>
      <h1 class="q">${esc(q.q)}</h1>
      <div class="choices">
        ${q.choices
          .map((c, i) => {
            const cls = !answered ? '' : i === q.answer ? 'right' : i === qz.answered ? 'wrong' : 'dim';
            return `<button class="choice ${cls}" data-act="choice" data-i="${i}" ${answered ? 'disabled' : ''}><kbd>${i + 1}</kbd> ${esc(c)}</button>`;
          })
          .join('')}
      </div>
      ${answered ? `<p class="why ${right ? 'right' : 'wrong'}"><b>${right ? '맞았습니다.' : '틀렸습니다.'}</b> ${esc(q.why)}</p>` : '<p class="hint">보기를 누르거나 숫자 키로 고르세요</p>'}
      <footer>
        ${answered ? `<button data-act="quizNext" data-primary class="primary">${qz.index + 1 < qz.questions.length ? '다음 문제' : '결과 보기'} <kbd>Enter</kbd></button>` : ''}
        <button data-act="menu" data-back>그만두기 <kbd>Esc</kbd></button>
      </footer>`);
  }

  private answer(i: number): void {
    const qz = this.quiz;
    if (!qz || qz.answered !== null || i < 0 || i >= qz.questions[qz.index].choices.length) return;
    qz.answered = i;
    if (i === qz.questions[qz.index].answer) qz.correct++;
    this.renderQuiz();
  }

  private quizNext(): void {
    const qz = this.quiz;
    if (!qz || qz.answered === null) return;
    if (qz.index + 1 < qz.questions.length) {
      qz.index++;
      qz.answered = null;
      this.renderQuiz();
    } else {
      this.quiz = null;
      this.onAction({ act: 'quizDone', correct: qz.correct, total: qz.questions.length });
    }
  }

  // ── 일시 정지 ──
  pause(title: string): void {
    this.show(`
      <p class="sub">일시 정지</p>
      <h1>${esc(title)}</h1>
      <footer class="col">
        <button data-act="resume" data-primary data-back class="primary">계속하기 <kbd>Enter</kbd></button>
        <button data-act="retry">처음부터 다시</button>
        <button data-act="menu">메뉴로 나가기</button>
      </footer>`);
  }

  // ── 결과 ──
  result(
    task: TaskDef,
    score: Score,
    record: TaskRecord,
    next: TaskDef | null,
    newBadge: string | null,
    extra: ResultExtra = { notes: [], cycles: [] },
  ): void {
    const cycles = extra.cycles.length
      ? `<h2>사이클별 기록</h2>
        <table class="score cycles">
          <tr><th>#</th><th>결과</th><th>시간</th><th>쏟음</th><th>구역 밖</th><th>떨어뜨림</th></tr>
          ${extra.cycles
            .map(
              (c, i) => `<tr class="${c.valid ? '' : 'bad'}">
                <td>${i + 1}</td>
                <td>${c.valid ? '인정' : (FAULT_LABEL[c.fault] ?? '세지 않음')}</td>
                <td>${c.valid ? `${c.time.toFixed(1)}초` : '—'}</td>
                <td>${c.dumped.toFixed(2)}</td><td>${c.spilled.toFixed(2)}</td><td>${c.returned.toFixed(2)}</td>
              </tr>`,
            )
            .join('')}
        </table>`
      : '';
    const notes = extra.notes.length
      ? `<h2>과제 중 나온 실수 알림</h2><ul class="notes">${extra.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
      : '';
    const verdict = score.pass ? '합격' : score.fatal ? '실격' : '불합격';
    this.show(`
      <p class="sub">레벨 ${task.level} · ${task.id} · ${esc(task.title)}${task.provisional ? ' · <em>임시 규격</em>' : ''}</p>
      <div class="verdict ${score.pass ? 'pass' : 'fail'}">
        <b>${verdict}</b>
        <span>${score.total}점 <small>/ 100 · 합격선 ${score.passScore}점</small></span>
      </div>
      ${score.fatal ? `<p class="why wrong"><b>실격 사유:</b> ${esc(score.fatal)}</p>` : ''}
      <table class="score">
        ${score.items
          .map(
            (it) => `<tr>
              <th>${esc(it.label)}</th>
              <td class="pts ${it.points >= it.max ? 'full' : it.points < it.max * 0.5 ? 'low' : ''}">${it.points} <small>/ ${it.max}</small></td>
              <td>${esc(it.detail)}</td>
            </tr>`,
          )
          .join('')}
      </table>
      ${cycles}
      ${notes}
      <p class="sub">내 기록: 최고 ${record.best}점 · ${record.attempts}번 시도</p>
      ${newBadge ? `<p class="why right"><b>등급 획득!</b> ${esc(newBadge)}</p>` : ''}
      <footer>
        ${score.pass && next ? `<button data-act="next" data-primary class="primary">다음 과제: ${esc(next.title)} <kbd>Enter</kbd></button>` : ''}
        <button data-act="retry" ${score.pass && next ? '' : 'data-primary class="primary"'}>다시 하기${score.pass && next ? '' : ' <kbd>Enter</kbd>'}</button>
        <button data-act="menu" data-back>메뉴로 <kbd>Esc</kbd></button>
      </footer>`);
  }
}
