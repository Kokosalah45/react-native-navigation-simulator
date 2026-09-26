import { useMemo, useState } from 'react';
import type { NavAction, Params } from '../engine/types';
import { previewLifecycle, type LifecyclePreview, type SessionState } from '../engine/session';
import { buildPayload, formatPayload, type NestedHop } from '../engine/nested';
import { resolveTarget } from '../engine/resolve';
import { BubblePanel } from './BubblePanel';
import { CodeBlock } from './CodeBlock';
import { InfoTip, Tooltip } from './Tooltip';

interface Props {
  session: SessionState;
  dispatch: (action: NavAction, source?: string) => void;
}

interface ScreenOption {
  name: string;
  navKey: string;
  navLabel: string;
}

/**
 * The command center. Every button dispatches a real action object into the
 * engine - there is no shortcut path that mutates state directly, exactly as
 * in React Navigation where `navigation.push(...)` is sugar over
 * `dispatch(StackActions.push(...))`.
 */
export function CommandCenter({ session, dispatch }: Props) {
  const [target, setTarget] = useState<string>('');
  const [paramsText, setParamsText] = useState('{ "id": 7 }');
  const [popCount, setPopCount] = useState(1);
  const [merge, setMerge] = useState(false);
  const [popMode, setPopMode] = useState(false);
  const [useNested, setUseNested] = useState(false);
  const [initialFalse, setInitialFalse] = useState(false);
  const [sourceNav, setSourceNav] = useState('');
  const [previewId, setPreviewId] = useState('navigate');
  const [resetText, setResetText] = useState('');

  const screens: ScreenOption[] = useMemo(() => {
    const out: ScreenOption[] = [];
    for (const [navKey, bp] of session.idx.navigators) {
      for (const screen of bp.screens) {
        out.push({ name: screen.name, navKey, navLabel: `${bp.type}-${bp.id}` });
      }
    }
    return out;
  }, [session.idx]);

  const selected = target || screens[0]?.name || '';
  const selectedOption = screens.find((s) => s.name === selected);

  const parsed = useMemo((): { ok: true; value: Params | undefined } | { ok: false; error: string } => {
    const raw = paramsText.trim();
    if (!raw || raw === '{}') return { ok: true, value: undefined };
    try {
      const value = JSON.parse(raw);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { ok: false, error: 'Params must be a plain object.' };
      }
      return { ok: true, value: value as Params };
    } catch {
      return { ok: false, error: 'Invalid JSON.' };
    }
  }, [paramsText]);

  const params = parsed.ok ? parsed.value : undefined;

  const resolution = useMemo(
    () => resolveTarget(session, selected, selectedOption?.navKey ?? null, previewId, params, sourceNav || undefined),
    [session, selected, selectedOption, previewId, params, sourceNav],
  );

  /**
   * The smallest address that reaches the target from where the focus is now:
   * it starts at the nearest navigator shared with the focus chain, not at the
   * root. One hop means plain bubbling already gets there.
   */
  const path: NestedHop[] = resolution.path;
  const isNestable = path.length > 1;


  /** Addresses the target through every parent, not just the immediate one. */
  const withNesting = (base: { name: string; params?: Params }) => {
    if (!useNested || !isNestable) return base;
    const hops = path.map((hop, i) =>
      i === path.length - 1
        ? { ...hop, name: base.name, params: base.params, ...(initialFalse ? { initial: false } : {}) }
        : hop,
    );
    return buildPayload(hops);
  };

  const nestedPreview = useMemo(() => {
    if (!isNestable) return null;
    const hops = path.map((hop, i) =>
      i === path.length - 1 ? { ...hop, params, ...(initialFalse ? { initial: false } : {}) } : hop,
    );
    const code = formatPayload(hops);
    return sourceNav ? code.replace(/^navigation\./, `navigation.getParent('${sourceNav}').`) : code;
  }, [isNestable, path, params, initialFalse, sourceNav]);

  const go = (action: NavAction) => dispatch(action, sourceNav || undefined);

  /**
   * Every dispatchable action, built once. The chip on each button previews
   * exactly this object, so what the chip promises and what the click does can
   * never drift apart.
   */
  const acts = useMemo(() => {
    const resetNames = resetText.split(',').map((n) => n.trim()).filter(Boolean);
    const resetRoutes = (resetNames.length ? resetNames : [selected]).map((name) => ({ name }));
    return {
      navigate: {
        type: 'NAVIGATE',
        payload: { ...withNesting({ name: selected, params }), merge, ...(popMode ? { pop: true } : {}) },
      },
      push: { type: 'PUSH', payload: { name: selected, params } },
      pop: { type: 'POP', payload: { count: popCount } },
      popTo: { type: 'POP_TO', payload: { name: selected, params, merge } },
      popToTop: { type: 'POP_TO_TOP' },
      replace: { type: 'REPLACE', payload: { name: selected, params } },
      goBack: { type: 'GO_BACK' },
      setParams: { type: 'SET_PARAMS', payload: { params: params ?? {} } },
      replaceParams: { type: 'REPLACE_PARAMS', payload: { params: params ?? {} } },
      navigateDeprecated: { type: 'NAVIGATE_DEPRECATED', payload: { name: selected, params, merge } },
      jumpTo: { type: 'JUMP_TO', payload: { name: selected, params } },
      openDrawer: { type: 'OPEN_DRAWER' },
      closeDrawer: { type: 'CLOSE_DRAWER' },
      toggleDrawer: { type: 'TOGGLE_DRAWER' },
      nested: {
        type: 'NAVIGATE',
        payload: {
          ...buildPayload(
            path.map((hop, i) => (i === path.length - 1 ? { ...hop, params, ...(initialFalse ? { initial: false } : {}) } : hop)),
          ),
          merge,
          ...(popMode ? { pop: true } : {}),
        },
      },
      reset: { type: 'RESET', payload: { index: resetRoutes.length - 1, routes: resetRoutes } },
    } satisfies Record<string, NavAction>;
  }, [selected, params, merge, popMode, popCount, path, initialFalse, useNested, isNestable, resetText]);

  /** Which hooks each action would fire, from a speculative run of the engine. */
  const previews = useMemo(() => {
    const out = {} as Record<keyof typeof acts, LifecyclePreview>;
    for (const [id, action] of Object.entries(acts)) {
      out[id as keyof typeof acts] = previewLifecycle(session, action, sourceNav || undefined);
    }
    return out;
  }, [acts, session, sourceNav]);


  return (
    <div className="space-y-3">
      {/* ---------------- target + params ---------------- */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-300">Target screen</span>
          <select
            value={selected}
            onChange={(e) => setTarget(e.target.value)}
            className="mono w-full rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-[11.5px] text-ink-200 outline-none focus:border-focus-400"
          >
            {[...new Set(screens.map((s) => s.navLabel))].map((navLabel) => (
              <optgroup key={navLabel} label={navLabel}>
                {screens
                  .filter((s) => s.navLabel === navLabel)
                  .map((s) => (
                    <option key={`${s.navKey}-${s.name}`} value={s.name}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-300">Params (JSON)</span>
          <input
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            spellCheck={false}
            className={`mono w-full rounded-md border bg-ink-900 px-2 py-1.5 text-[11.5px] text-ink-200 outline-none ${
              parsed.ok ? 'border-ink-700 focus:border-focus-400' : 'border-gone-400/60'
            }`}
          />
        </label>
      </div>

      {!parsed.ok && <p className="text-[10px] text-gone-400">{parsed.error} Actions will be dispatched without params.</p>}

      {/* ---------------- modifiers ---------------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2">
        <Check
          checked={merge}
          onChange={setMerge}
          label="merge: true"
          tip="Shallow-merges the params into the existing route instead of replacing them. Without it, navigate() and popTo() overwrite params wholesale."
        />
        {session.version === 'v7' && (
          <Check
            checked={popMode}
            onChange={setPopMode}
            label="pop: true"
            tip="The v7 opt-in that restores v6 unwinding: navigate(name, params, { pop: true }) goes back to an existing instance instead of pushing a new one."
          />
        )}
        <Check
          checked={useNested}
          onChange={setUseNested}
          disabled={!isNestable}
          label="nested payload"
          tip={
            isNestable
              ? `Addresses the target through all ${path.length} levels (${path.map((h) => h.name).join(' → ')}) instead of naming the child screen directly. Each level is a separate NAVIGATE handled by a different navigator, which is why this works before the child has mounted.`
              : 'Only available when the selected screen lives inside a nested navigator. This one is in the root navigator.'
          }
        />
        <Check
          checked={initialFalse}
          onChange={setInitialFalse}
          disabled={!isNestable || !useNested}
          label="initial: false"
          tip="Only has an effect when the child navigator is CREATED by this dispatch. Default (initial: true) makes the target the child's only route, so there is nothing to go back to inside it. initial: false keeps the child's initialRouteName underneath."
        />
      </div>

      {/* ---------------- bubbling resolver ---------------- */}
      <BubblePanel
        session={session}
        target={selected}
        resolution={resolution}
        previewId={previewId}
        onPreviewChange={setPreviewId}
        dispatch={dispatch}
      />

      {/* ---------------- nested navigation ---------------- */}
      <div className="rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2">
        <div className="mb-1.5 flex items-center gap-2">
          <h4 className="text-[10px] font-medium uppercase tracking-wider text-ink-300">Nested payload</h4>
          <InfoTip label="The full payload including your params and the initial flag. Each level is dispatched as its own NAVIGATE and logged separately in the console." />
          {isNestable && (
            <span className="mono rounded bg-alive-400/15 px-1.5 py-px text-[9px] font-bold text-alive-400">
              {path.length} levels
            </span>
          )}
        </div>

        {isNestable ? (
          <>
            <CodeBlock code={nestedPreview ?? ''} language="jsx" className="mb-1.5 !p-2 !text-[9.5px]" />
            <Cmd
              label={`navigate nested → ${selected}${popMode ? " { pop: true }" : ""}`}
              tone="primary"
              tip="Dispatches the payload above with your params and initial flag applied, whether or not the nested payload checkbox is ticked."
              preview={previews.nested}
              onClick={() => go(acts.nested)}
            />
          </>
        ) : (
          <p className="text-[10.5px] leading-snug text-ink-300">
            <span className="mono text-ink-200">{selected}</span> is declared on the root navigator, so it needs no nested payload.
            Load the “Sibling stacks in Tabs” or “Drawer + Tabs + Stacks” layout to build a deep one.
          </p>
        )}

        <div className="mt-2">
          <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-300">
            Dispatch from
            <InfoTip label="Which navigator the action starts at. The default is the one owning the focused screen. Picking another models navigation.getParent() — bubbling then begins THERE, so the same call can go from handled to unhandled. Note that the real getParent(id) takes a navigator id you set yourself via the id prop; this simulator keys navigators by a readable generated key. If the navigator you pick is not mounted, there is no navigation object to call getParent on and the action falls back to the focused screen." />
          </label>
          <select
            value={sourceNav}
            onChange={(e) => setSourceNav(e.target.value)}
            className="mono w-full rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-[11px] text-ink-200 outline-none focus:border-focus-400"
          >
            <option value="">focused screen (default)</option>
            {[...session.idx.navigators.keys()].map((navKey) => (
              <option key={navKey} value={navKey}>
                getParent → {navKey}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ---------------- stack actions ---------------- */}
      <Group title="Stack actions">
        <Cmd
          label={`navigate('${selected}'${popMode ? ', { pop: true }' : ''})`}
          tone="primary"
          tip={
            session.version === 'v7'
              ? 'v7 in a stack, per the docs, in order: (1) already on a screen with this name → update its params, no push; (2) different screen → push it; (3) getId matches another screen → bring that one to focus and update params (not simulated here); (4) otherwise push. In a tab or drawer it just switches to the screen.'
              : 'v6: if the screen exists anywhere in the stack, everything above it is destroyed and focus drops back to it, in place. Otherwise it is pushed. This is what navigateDeprecated() still does in v7.'
          }
          preview={previews.navigate}
          onClick={() => go(acts.navigate)}
        />
        <Cmd
          label={`push('${selected}')`}
          tip="Always appends a brand-new instance with a fresh key, even when the same screen is already in the stack. This is how you get two Profiles in one stack."
          preview={previews.push}
          onClick={() => go(acts.push)}
        />
        <Cmd
          label={`pop(${popCount})`}
          tip="Truncates the routes array by n entries. The screens removed are unmounted and their local state is destroyed."
          preview={previews.pop}
          onClick={() => go(acts.pop)}
          trailing={
            <input
              type="number"
              min={1}
              max={9}
              value={popCount}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setPopCount(Math.max(1, Math.min(9, Number(e.target.value) || 1)))}
              className="mono ml-1 w-9 rounded border border-ink-600 bg-ink-950 px-1 py-0.5 text-[10px] text-ink-200 outline-none"
            />
          }
        />
        <Cmd
          label={`popTo('${selected}')`}
          badge="v7"
          tone={session.version === 'v6' ? 'danger' : 'default'}
          tip={
            session.version === 'v6'
              ? 'StackActions.popTo did not exist in v6. Dispatching it here shows the failure you would get.'
              : session.options.strictPopTo
                ? 'Strict mode: rolls back to an existing instance, and errors if the screen is not already in the stack.'
                : 'Real v7 behaviour: rolls back to an existing instance, or - if absent - pops the current screen and adds the target.'
          }
          preview={previews.popTo}
          onClick={() => go(acts.popTo)}
        />
        <Cmd
          label="popToTop()"
          tip="Collapses the stack to routes[0]. The bottom route keeps its key and its state; everything above is destroyed in one dispatch."
          preview={previews.popToTop}
          onClick={() => go(acts.popToTop)}
        />
        <Cmd
          label={`replace('${selected}')`}
          tip="Swaps the entry at the current index. Depth is unchanged, but the key changes - so the old screen unmounts and you cannot go back to it."
          preview={previews.replace}
          onClick={() => go(acts.replace)}
        />
        <Cmd label="goBack()" tip="Dispatches GO_BACK. Whichever navigator can handle it first wins - which is why back inside a nested stack pops that stack rather than switching tabs." preview={previews.goBack} onClick={() => go(acts.goBack)} />
        <Cmd
          label={`setParams(${paramsText.trim() || '{}'})`}
          tip="Shallow-merges into the FOCUSED route's params, like React's setState. The key is untouched, so nothing remounts - v7 produces a new frozen state object rather than mutating the old one."
          preview={previews.setParams}
          onClick={() => go(acts.setParams)}
        />
        <Cmd
          label="replaceParams({...})"
          badge="v7"
          tip="The counterpart to setParams: replaces route.params with the new object outright, so keys you omit disappear. Same key, so still no remount."
          preview={previews.replaceParams}
          onClick={() => go(acts.replaceParams)}
        />
        {session.version === 'v7' && (
          <Cmd
            label={`navigateDeprecated('${selected}')`}
            badge="v7"
            tip="The v7 migration shim that behaves exactly like v6's navigate(). It exists so you can move a large codebase one call site at a time; it will be removed in v8."
            preview={previews.navigateDeprecated}
            onClick={() => go(acts.navigateDeprecated)}
          />
        )}
      </Group>

      {/* ---------------- tab / drawer actions ---------------- */}
      <Group title="Tab & drawer actions">
        <Cmd
          label={`jumpTo('${selected}')`}
          tip="Tab-only action: moves index without adding or removing routes. Dispatched from a nested stack it bubbles up to the tab navigator."
          preview={previews.jumpTo}
          onClick={() => go(acts.jumpTo)}
        />
        <Cmd label="openDrawer()" tip="Adds a { type: 'drawer', status: 'open' } entry to the navigator history. No route changes, and the screen behind stays focused." preview={previews.openDrawer} onClick={() => go(acts.openDrawer)} />
        <Cmd label="closeDrawer()" tip="Removes the drawer history entry." preview={previews.closeDrawer} onClick={() => go(acts.closeDrawer)} />
        <Cmd label="toggleDrawer()" tip="Open or close depending on the current history." preview={previews.toggleDrawer} onClick={() => go(acts.toggleDrawer)} />
      </Group>

      {/* ---------------- reset ---------------- */}
      <Group title="reset()">
        <div className="col-span-full flex gap-2">
          <input
            value={resetText}
            onChange={(e) => setResetText(e.target.value)}
            placeholder={`comma-separated route names, e.g. ${screens
              .slice(0, 2)
              .map((s) => s.name)
              .join(', ')}`}
            spellCheck={false}
            className="mono min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-[11px] text-ink-200 outline-none placeholder:text-ink-500 focus:border-focus-400"
          />
          <Cmd
            label="dispatch reset"
            tone="danger"
            tip="Replaces the navigator's whole state object. Every key is regenerated, so every screen unmounts and remounts with no preserved state. The nuclear option - and the only one that can build a history that was never navigated."
            preview={previews.reset}
            onClick={() => go(acts.reset)}
          />
        </div>
      </Group>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-300">{title}</h4>
      <div className="grid grid-cols-2 gap-1.5">{children}</div>
    </div>
  );
}

function Cmd({
  label,
  tip,
  onClick,
  tone = 'default',
  badge,
  trailing,
  preview,
}: {
  label: string;
  tip: string;
  onClick: () => void;
  tone?: 'default' | 'primary' | 'danger';
  badge?: string;
  trailing?: React.ReactNode;
  preview?: LifecyclePreview;
}) {
  const tones = {
    default: 'border-ink-700 bg-ink-850 hover:border-ink-500 hover:bg-ink-800 text-ink-200',
    primary: 'border-focus-400/50 bg-focus-400/10 hover:bg-focus-400/20 text-focus-400',
    danger: 'border-gone-400/40 bg-gone-400/10 hover:bg-gone-400/20 text-gone-400',
  } as const;

  return (
    <Tooltip wide label={<span>{tip}{preview ? <><br /><br /><LifecycleSummary preview={preview} /></> : null}</span>} className="block">
      <button
        onClick={onClick}
        className={`mono flex w-full items-center gap-1 truncate rounded-md border px-2 py-1.5 text-left text-[10.5px] transition-colors ${tones[tone]}`}
      >
        <span className="truncate">{label}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {badge && <span className="rounded bg-alive-400/15 px-1 py-px text-[8.5px] font-bold text-alive-400">{badge}</span>}
          {preview && <LifecycleChip preview={preview} />}
          {trailing}
        </span>
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Does this action bring components into the tree, destroy them, or only move
 * focus? That distinction is the whole difference between useEffect and
 * useFocusEffect, and it is invisible until you dispatch - so it is previewed.
 */
const CHIP = {
  mount: { text: 'mount', tone: 'border-alive-400/40 bg-alive-400/15 text-alive-400' },
  unmount: { text: 'unmount', tone: 'border-gone-400/40 bg-gone-400/15 text-gone-400' },
  swap: { text: 'swap', tone: 'border-v6-400/40 bg-v6-400/15 text-v6-400' },
  focus: { text: 'blur only', tone: 'border-focus-400/40 bg-focus-400/15 text-focus-400' },
  none: { text: 'no-op', tone: 'border-ink-600 bg-ink-800 text-ink-300' },
  blocked: { text: 'blocked', tone: 'border-ink-700 bg-ink-900 text-ink-500' },
} as const;

function LifecycleChip({ preview }: { preview: LifecyclePreview }) {
  const chip = CHIP[preview.kind];
  const count = preview.mounts.length + preview.unmounts.length;
  return (
    <span className={`rounded border px-1 py-px text-[8.5px] font-bold tracking-wide ${chip.tone}`}>
      {chip.text}
      {count > 1 ? ` ${count}` : ''}
    </span>
  );
}

function LifecycleSummary({ preview }: { preview: LifecyclePreview }) {
  if (!preview.ok) {
    return <span className="text-gone-400">No navigator would handle this, so nothing would render or unmount.</span>;
  }

  const rows: string[] = [];
  if (preview.mounts.length) rows.push(`useEffect setup: ${preview.mounts.join(', ')}`);
  if (preview.unmounts.length) rows.push(`useEffect cleanup (state destroyed): ${preview.unmounts.join(', ')}`);
  if (preview.blurs.length) rows.push(`useFocusEffect cleanup: ${preview.blurs.join(', ')}`);
  if (preview.focuses.length) rows.push(`useFocusEffect setup: ${preview.focuses.join(', ')}`);

  return (
    <span className="text-ink-300">
      <strong className="text-ink-200">
        {preview.kind === 'focus'
          ? 'Focus only — nothing mounts or unmounts.'
          : preview.kind === 'none'
            ? 'No hooks fire at all; only the state object changes.'
            : preview.kind === 'mount'
              ? 'Mounts new components.'
              : preview.kind === 'unmount'
                ? 'Unmounts components and destroys their local state.'
                : 'Mounts and unmounts in the same dispatch.'}
      </strong>
      {rows.length ? (
        <>
          <br />
          {rows.join(' · ')}
        </>
      ) : null}
    </span>
  );
}

function Check({
  checked,
  onChange,
  label,
  tip,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  tip: string;
  disabled?: boolean;
}) {
  return (
    <Tooltip wide label={tip}>
      <label className={`mono flex cursor-pointer items-center gap-1.5 text-[10.5px] ${disabled ? 'text-ink-500' : 'text-ink-200'}`}>
        <input
          type="checkbox"
          checked={checked && !disabled}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3 w-3 accent-sky-400"
        />
        {label}
      </label>
    </Tooltip>
  );
}
