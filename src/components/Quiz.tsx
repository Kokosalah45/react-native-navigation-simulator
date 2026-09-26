import { useEffect } from 'react';
import type { Beat, BeatScore, Difficulty, Grade, Quiz } from '../engine/quiz';
import { DIFFICULTIES, DIFFICULTY_BLURB, QUIZZES } from '../engine/quiz';
import { CodeLine } from './CodeBlock';

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

const SCORE_TONE: Record<BeatScore, string> = {
  clean: 'bg-alive-400',
  passed: 'bg-focus-400',
  hinted: 'bg-v6-400',
  failed: 'bg-gone-400',
};

const DIFF_TONE: Record<Difficulty, string> = {
  easy: 'border-alive-400/40 text-alive-400',
  medium: 'border-focus-400/40 text-focus-400',
  hard: 'border-v6-400/40 text-v6-400',
};

/**
 * The drill picker, as a modal off the top bar.
 *
 * Grouped by how much of the tree you have to hold in your head at once, which
 * is the only axis that actually gets harder: one stack, then more than one
 * navigator, then whole journeys where the same call changes meaning between
 * two steps.
 */
export function DrillsModal({
  progress,
  onStart,
  onClose,
}: {
  progress: Record<string, BeatScore[]>;
  onStart: (quiz: Quiz) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/80 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Drills"
        className="my-auto w-full max-w-2xl rounded-xl border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <header className="flex items-baseline gap-2 border-b border-ink-700 px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink-200">Drills</h2>
          <p className="min-w-0 flex-1 truncate text-[10.5px] text-ink-500">
            You make the call; the engine grades the state you produced, not the call you typed.
          </p>
          <button onClick={onClose} className="mono shrink-0 text-[10px] text-ink-500 hover:text-ink-200">
            esc
          </button>
        </header>

        <div className="space-y-4 px-4 py-3.5">
          {DIFFICULTIES.map((level) => {
            const quizzes = QUIZZES.filter((q) => q.difficulty === level);
            if (!quizzes.length) return null;
            return (
              <section key={level}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span
                    className={`mono rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${DIFF_TONE[level]}`}
                  >
                    {level}
                  </span>
                  <p className="min-w-0 flex-1 text-[10px] leading-snug text-ink-500">{DIFFICULTY_BLURB[level]}</p>
                </div>

                <div className="space-y-1.5">
                  {quizzes.map((quiz) => {
                    const scores = progress[quiz.id] ?? [];
                    const graded = quiz.beats.filter((b) => b.mode === 'graded').length;
                    const complete = scores.length >= graded;
                    return (
                      <button
                        key={quiz.id}
                        onClick={() => onStart(quiz)}
                        className="block w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-left transition-colors hover:border-focus-400/60 hover:bg-ink-800"
                      >
                        <div className="flex items-center gap-2">
                          <span className="mono shrink-0 rounded bg-ink-800 px-1 py-px text-[9px] font-bold text-ink-300">
                            {quiz.rung}
                          </span>
                          <span className="truncate text-[11.5px] font-medium text-ink-200">{quiz.title}</span>
                          {complete && <span className="mono shrink-0 text-[9px] text-alive-400">done</span>}
                          <span className="ml-auto flex shrink-0 gap-0.5">
                            {Array.from({ length: graded }, (_, i) => (
                              <span
                                key={i}
                                className={`h-1.5 w-1.5 rounded-full ${scores[i] ? SCORE_TONE[scores[i]] : 'bg-ink-700'}`}
                              />
                            ))}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-ink-500">{quiz.story}</p>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The runner                                                          */
/* ------------------------------------------------------------------ */

export interface QuizRun {
  quiz: Quiz;
  beat: number;
  /** Result of the current graded beat, once it has been attempted. */
  grade: Grade | null;
  /** True when the state matches what the model answer produces. */
  matchedModel: boolean;
  hintsTaken: number;
  attempts: number;
  scores: BeatScore[];
  revealed: boolean;
  done: boolean;
}

interface Props {
  run: QuizRun;
  onHint: () => void;
  onReveal: () => void;
  onRetry: () => void;
  onNext: () => void;
  onQuit: () => void;
}

export function QuizPanel({ run, onHint, onReveal, onRetry, onNext, onQuit }: Props) {
  const { quiz, beat: beatIndex, done } = run;
  const beat: Beat | undefined = quiz.beats[beatIndex];
  const gradedTotal = quiz.beats.filter((b) => b.mode === 'graded').length;

  return (
    <div className="rounded-lg border border-focus-400/40 bg-focus-400/[0.05]">
      <header className="flex items-center gap-2 border-b border-ink-700/70 px-2.5 py-1.5">
        <span className="mono shrink-0 rounded bg-focus-400/15 px-1 py-px text-[9px] font-bold text-focus-400">
          RUNG {quiz.rung}
        </span>
        <h3 className="truncate text-[11px] font-semibold text-ink-200">{quiz.title}</h3>
        <button onClick={onQuit} className="mono ml-auto shrink-0 text-[9px] text-ink-500 hover:text-ink-200">
          quit
        </button>
      </header>

      <div className="space-y-2 px-2.5 py-2">
        {done ? (
          <Finished run={run} onQuit={onQuit} />
        ) : (
          <>
            <p className="text-[10.5px] leading-relaxed text-ink-300">{quiz.story}</p>

            {beat && (
              <div className="rounded border border-ink-700 bg-ink-900/60 px-2 py-1.5">
                <p className="mono mb-1 text-[9px] uppercase tracking-wider text-ink-500">
                  step {beatIndex + 1} of {quiz.beats.length} · {beat.mode === 'scripted' ? 'watch' : 'your call'}
                </p>
                <p className="text-[10.5px] leading-relaxed text-ink-200">{beat.narrative}</p>
                {beat.goal && (
                  <p className="mt-1.5 rounded border border-focus-400/30 bg-focus-400/[0.07] px-2 py-1.5 text-[10.5px] leading-relaxed text-ink-200">
                    <span className="mono text-[9px] font-bold uppercase tracking-wider text-focus-400">needs </span>
                    {beat.goal}
                  </p>
                )}
              </div>
            )}

            {beat?.mode === 'graded' && (
              <GradedBeat run={run} beat={beat} onHint={onHint} onReveal={onReveal} onRetry={onRetry} onNext={onNext} />
            )}

            {beat?.mode === 'scripted' && (
              <p className="mono text-[9.5px] text-ink-500">Playing {beat.actions?.length ?? 0} actions…</p>
            )}
          </>
        )}
      </div>

      {!done && (
        <div className="flex gap-0.5 px-2.5 pb-2">
          {Array.from({ length: gradedTotal }, (_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full ${run.scores[i] ? SCORE_TONE[run.scores[i]] : 'bg-ink-700'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function GradedBeat({
  run,
  beat,
  onHint,
  onReveal,
  onRetry,
  onNext,
}: {
  run: QuizRun;
  beat: Beat;
  onHint: () => void;
  onReveal: () => void;
  onRetry: () => void;
  onNext: () => void;
}) {
  const { grade, hintsTaken, revealed, matchedModel } = run;
  const hints = beat.hints ?? [];

  return (
    <div className="space-y-2">
      {/* Before answering: the hint ladder. */}
      {!grade && (
        <>
          {hints.slice(0, hintsTaken).map((hint, i) => (
            <p
              key={i}
              className="rounded border border-v6-400/30 bg-v6-400/[0.06] px-2 py-1.5 text-[10.5px] leading-relaxed text-ink-200"
            >
              <span className="mono text-[9px] font-bold uppercase tracking-wider text-v6-400">hint {i + 1} </span>
              {hint}
            </p>
          ))}
          <div className="flex items-center gap-2">
            <p className="mono text-[9.5px] text-ink-500">Make the call in the command center.</p>
            {hintsTaken < hints.length && (
              <button
                onClick={onHint}
                className="mono ml-auto shrink-0 rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[9px] text-ink-300 hover:border-ink-500 hover:text-ink-200"
              >
                hint {hintsTaken + 1}/{hints.length}
              </button>
            )}
          </div>
        </>
      )}

      {/* After answering: every assertion, passed or not. */}
      {grade && (
        <div
          className={`rounded border px-2 py-1.5 ${
            grade.ok ? 'border-alive-400/40 bg-alive-400/[0.06]' : 'border-gone-400/40 bg-gone-400/[0.06]'
          }`}
        >
          <p className={`mb-1 text-[11px] font-semibold ${grade.ok ? 'text-alive-400' : 'text-gone-400'}`}>
            {grade.ok
              ? matchedModel
                ? 'Right — and the way you did it is the one I would reach for.'
                : 'Right — though you got there a different way than I would have.'
              : 'Not yet.'}
          </p>
          <ul className="space-y-1">
            {grade.checks.map((check) => (
              <li key={check.label} className="flex items-start gap-1.5">
                <span className={`mono shrink-0 text-[10px] leading-tight ${check.ok ? 'text-alive-400' : 'text-gone-400'}`}>
                  {check.ok ? '✓' : '✗'}
                </span>
                <span className="min-w-0 text-[10px] leading-relaxed">
                  <span className="text-ink-200">{check.label}</span>
                  <span className="text-ink-500"> — {check.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The model answer, once earned or asked for. */}
      {(revealed || (grade?.ok && !matchedModel)) && beat.answer && (
        <div className="rounded border border-ink-700 bg-ink-900/60 px-2 py-1.5">
          <p className="mono mb-1 text-[9px] uppercase tracking-wider text-ink-500">
            {grade?.ok && !matchedModel ? 'what I would have done' : 'the answer'}
          </p>
          <CodeLine code={describe(beat)} className="mb-1 text-[10px]" />
          <p className="text-[10.5px] leading-relaxed text-ink-300">{beat.answer.why}</p>
        </div>
      )}

      <div className="flex gap-1.5">
        {grade && !grade.ok && (
          <button
            onClick={onRetry}
            className="mono flex-1 rounded border border-focus-400/50 bg-focus-400/10 px-2 py-1 text-[10px] text-focus-400 hover:bg-focus-400/20"
          >
            try again
          </button>
        )}
        {grade?.ok && (
          <button
            onClick={onNext}
            className="mono flex-1 rounded border border-alive-400/50 bg-alive-400/10 px-2 py-1 text-[10px] text-alive-400 hover:bg-alive-400/20"
          >
            next step
          </button>
        )}
        {!revealed && (
          <button
            onClick={onReveal}
            className="mono shrink-0 rounded border border-ink-700 bg-ink-850 px-2 py-1 text-[10px] text-ink-500 hover:border-ink-500 hover:text-ink-200"
          >
            show me
          </button>
        )}
      </div>
    </div>
  );
}

function Finished({ run, onQuit }: { run: QuizRun; onQuit: () => void }) {
  const clean = run.scores.filter((s) => s === 'clean').length;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-alive-400">
        Done — {clean}/{run.scores.length} first time, without a hint.
      </p>
      <div className="flex gap-1">
        {run.scores.map((s, i) => (
          <span key={i} className={`mono rounded px-1.5 py-0.5 text-[9px] text-ink-950 ${SCORE_TONE[s]}`}>
            {s}
          </span>
        ))}
      </div>
      <p className="rounded border border-focus-400/30 bg-focus-400/[0.07] px-2 py-1.5 text-[10.5px] leading-relaxed text-ink-200">
        {run.quiz.takeaway}
      </p>
      <button
        onClick={onQuit}
        className="mono w-full rounded border border-ink-700 bg-ink-850 px-2 py-1 text-[10px] text-ink-300 hover:border-ink-500 hover:text-ink-200"
      >
        back to the list
      </button>
    </div>
  );
}

const describe = (beat: Beat) => {
  const a = beat.answer?.action;
  if (!a) return '';
  if (a.type === 'POP_TO') return `navigation.popTo('${a.payload.name}')`;
  if (a.type === 'PUSH') return `navigation.push('${a.payload.name}')`;
  if (a.type === 'NAVIGATE') {
    const params = a.payload.params ? `, ${JSON.stringify(a.payload.params)}` : '';
    return `navigation.navigate('${a.payload.name}'${params})`;
  }
  return a.type;
};
