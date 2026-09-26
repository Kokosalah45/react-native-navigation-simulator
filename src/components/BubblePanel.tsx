import type { NavAction } from '../engine/types';
import type { SessionState } from '../engine/session';
import type { Capability } from '../engine/capabilities';
import { getNavigatorBlueprint } from '../engine/blueprint';
import { PREVIEW_ACTIONS, type CallShapeInfo, type Resolution } from '../engine/resolve';
import { CodeLine } from './CodeBlock';
import { InfoTip, Tooltip } from './Tooltip';

interface Props {
  session: SessionState;
  target: string;
  resolution: Resolution;
  previewId: string;
  onPreviewChange: (id: string) => void;
  dispatch: (action: NavAction, source?: string) => void;
  /** Which methods this navigation object has, keyed by action type. */
  caps: Record<NavAction['type'], Capability>;
  /** Hide the verdict and the call ranking; keep the trace. */
  blindfold?: boolean;
}

/**
 * Predicts what the selected action would do from where the focus is now.
 *
 * Every verdict here comes from a speculative run of the real routers, so the
 * panel cannot claim something the engine would not actually do. Switching the
 * action changes both the code shape and the answer, because each action
 * bubbles by its own rules: a tab router has no handler for push at all, while
 * jumpTo is invisible to a stack.
 */
export function BubblePanel({ session, target, resolution, previewId, onPreviewChange, dispatch, caps, blindfold = false }: Props) {
  const { trace, spec, handledBy, headline, explanation, bare, nested, relation, pop } = resolution;

  const verdictTone =
    handledBy === null
      ? 'border-gone-400/50 bg-gone-400/[0.07]'
      : trace.find((s) => s.navKey === handledBy)?.levelsUp
        ? 'border-v6-400/40 bg-v6-400/[0.06]'
        : 'border-alive-400/40 bg-alive-400/[0.06]';

  const headlineTone =
    handledBy === null ? 'text-gone-400' : trace.find((s) => s.navKey === handledBy)?.levelsUp ? 'text-v6-400' : 'text-alive-400';

  const available = PREVIEW_ACTIONS.filter((a) => !(a.v7Only && session.version === 'v6') || a.id === previewId);

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-[10px] font-medium uppercase tracking-wider text-ink-300">Would this action be handled?</h4>
        <InfoTip
          label={
            <span>
              Each action bubbles by its own rules. From the docs: actions “first go to the current navigator. If it can't handle
              them, they bubble up to the parent.” A router that has no handler for an action returns{' '}
              <code className="text-focus-400">null</code> — so <code>push</code> travels straight past a tab navigator to the
              nearest ancestor stack, while <code>jumpTo</code> does the opposite. The <code>pop: true</code> modifier feeds in
              here too: it is an option of <code>navigate</code> alone, so every other action ignores it. Every verdict below is a
              dry run of the real routers.
            </span>
          }
        />
        <select
          value={previewId}
          onChange={(e) => onPreviewChange(e.target.value)}
          className="mono ml-auto rounded-md border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10px] text-ink-200 outline-none focus:border-focus-400"
        >
          {available.map((a) => {
            const has = caps[a.build('_', undefined).type]?.ok ?? true;
            return (
              <option key={a.id} value={a.id}>
                {a.label}
                {a.v7Only ? ' (v7)' : ''}
                {has ? '' : ' — not on this screen'}
              </option>
            );
          })}
        </select>
      </div>

      {/* bubbling trace, leaf first */}
      <div className="mb-2 space-y-1">
        {trace.map((step) => {
          const routeNames = getNavigatorBlueprint(session.idx, step.navKey)?.screens.map((s) => s.name) ?? [];
          return (
            <Tooltip
              key={step.navKey}
              wide
              className="block"
              label={
                step.status === 'handled'
                  ? `${step.navKey} is a ${step.type} navigator whose router handles ${spec.label}${
                      spec.needsName ? ` for '${target}'` : ''
                    }. It returns a new state, so the action stops here.`
                  : step.status === 'declined'
                    ? `${step.navKey} returned null — ${step.note}. routeNames: [${routeNames.join(', ')}]. The action moves up to its parent.`
                    : `The action never got this far: a navigator below already handled it.`
              }
            >
              <div
                className={`mono flex cursor-help items-center gap-2 rounded border px-2 py-1 text-[10px] ${
                  step.status === 'handled'
                    ? 'border-focus-400/60 bg-focus-400/10 text-focus-400'
                    : step.status === 'unreached'
                      ? 'border-ink-800 bg-ink-900 text-ink-500'
                      : 'border-ink-700 bg-ink-850 text-ink-300'
                }`}
              >
                <span className="w-10 shrink-0 text-ink-500">{step.levelsUp === 0 ? 'here' : `↑ ${step.levelsUp}`}</span>
                <span className="truncate">{step.navKey}</span>
                <span className="ml-auto shrink-0 truncate pl-2">{step.status === 'handled' ? 'handles it' : step.note}</span>
              </div>
            </Tooltip>
          );
        })}

        {handledBy === null && (
          <div className="mono flex items-center gap-2 rounded border border-gone-400/40 bg-gone-400/[0.08] px-2 py-1 text-[10px] text-gone-400">
            <span className="w-10 shrink-0">↑ end</span>
            <span>root reached, no handler — dev-only error, then nothing</span>
          </div>
        )}
      </div>

      {blindfold ? (
        <div className="mb-2 rounded border border-ink-700 border-dashed bg-ink-900/60 px-2 py-1.5">
          <p className="mono text-[9px] uppercase tracking-wider text-ink-500">verdict hidden while this step is graded</p>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-300">
            The trace above still shows you which navigator sees what — that is the part you reason with.
          </p>
        </div>
      ) : (
      <div className={`mb-2 rounded border px-2 py-1.5 ${verdictTone}`}>
        <p className={`mb-1 text-[11px] font-semibold ${headlineTone}`}>{headline}</p>
        <p className="text-[10.5px] leading-relaxed text-ink-200">{explanation}</p>
        {relation && (
          <p className="mono mt-1.5 text-[9.5px] text-ink-300">
            target sits {relation === 'below' ? 'BELOW you' : 'SIDEWAYS'} · bubbling only goes UP
          </p>
        )}
      </div>
      )}

      {/**
        * The pop modifier, but only when it is worth a line: ticked, or unticked
        * while it would change the outcome. Silent when it is off and irrelevant.
        */}
      {!blindfold && (pop.on || pop.changes) && (
        <div
          className={`mb-2 rounded border px-2 py-1.5 ${
            !pop.accepted
              ? 'border-ink-700 bg-ink-850'
              : pop.changes
                ? 'border-alive-400/40 bg-alive-400/[0.06]'
                : 'border-ink-700 bg-ink-850'
          }`}
        >
          <div className="mono mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-wider">
            <span
              className={
                !pop.accepted ? 'text-ink-500 line-through' : pop.on ? 'text-alive-400' : 'text-ink-300'
              }
            >
              pop: true
            </span>
            <span className="text-ink-500">
              {!pop.accepted
                ? `ignored by ${spec.label}`
                : pop.on
                  ? pop.changes
                    ? 'applied - and it changes the outcome'
                    : 'applied - but it makes no difference here'
                  : 'off - ticking it would change the outcome'}
            </span>
          </div>
          <p className="text-[10.5px] leading-relaxed text-ink-200">{pop.note}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <CallShape info={bare} label={spec.needsName ? 'bare' : spec.label} onRun={() => dispatch(bare.action)} blindfold={blindfold} />
        {nested && (
          <CallShape info={nested} label={`nested · ${nested.hops} levels`} onRun={() => dispatch(nested.action)} blindfold={blindfold} />
        )}
        {!nested && !spec.supportsNested && spec.needsName && (
          <p className="text-[10px] leading-snug text-ink-300">
            A <span className="mono">{spec.label}</span> payload is never forwarded into a child navigator — only{' '}
            <span className="mono">navigate</span> resolves a <span className="mono">{'{ screen }'}</span> payload.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const CALL_STATUS = {
  use: { mark: '✓', mark_tone: 'text-alive-400', box: 'border-alive-400/50 bg-alive-400/10 hover:bg-alive-400/20' },
  avoid: { mark: '✗', mark_tone: 'text-gone-400', box: 'border-gone-400/40 bg-gone-400/[0.06] hover:bg-gone-400/10' },
  redundant: { mark: '~', mark_tone: 'text-ink-300', box: 'border-ink-700 bg-ink-850 opacity-70 hover:opacity-100' },
} as const;

function CallShape({
  info,
  label,
  onRun,
  blindfold = false,
}: {
  info: CallShapeInfo;
  label: string;
  onRun: () => void;
  blindfold?: boolean;
}) {
  const tone = CALL_STATUS[blindfold ? 'redundant' : info.status];
  return (
    <div className={`rounded-md border transition-colors ${tone.box}`}>
      <div className="flex items-center gap-1.5 px-2 pt-1.5">
        <span className={`mono text-[9px] font-bold ${tone.mark_tone}`}>{blindfold ? '?' : tone.mark}</span>
        <span className="mono text-[9px] uppercase tracking-wider text-ink-300">{label}</span>
        {info.handledBy && !blindfold && <span className="mono text-[9px] text-focus-400">→ {info.handledBy}</span>}
        {!blindfold && <InfoTip label={info.reason} className="ml-auto" />}
      </div>
      {/* The code is selectable and scrollable; only the button runs it. */}
      <button onClick={onRun} title="Dispatch this call" className="block w-full px-2 pb-1.5 pt-0.5 text-left">
        <CodeLine code={info.code} className="text-[10px]" />
      </button>
    </div>
  );
}
