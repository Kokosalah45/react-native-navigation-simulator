import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BackBehavior, NavigatorType } from '../engine/types';
import type { NavigatorBlueprint, Preset, ScreenBlueprint } from '../engine/blueprint';
import {
  type CustomLayout,
  blankLayout,
  duplicateAsCustom,
  exportLayout,
  importLayout,
  nextNavId,
  validateBlueprint,
} from '../engine/layouts';
import { generateStatic } from '../engine/codegen';
import { CodeBlock } from './CodeBlock';
import { InfoTip } from './Tooltip';

interface Props {
  layout: CustomLayout;
  presets: Preset[];
  onChange: (layout: CustomLayout) => void;
  onSave: (layout: CustomLayout) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  saved: boolean;
}

const NAV_LABEL: Record<NavigatorType, string> = {
  stack: 'Native stack',
  tab: 'Bottom tabs',
  drawer: 'Drawer',
};

const BACK_BEHAVIORS: BackBehavior[] = ['firstRoute', 'initialRoute', 'order', 'history', 'fullHistory', 'none'];

/**
 * Builds a navigator tree by hand for a proof of concept, alongside the fixed
 * presets. The tree it edits is a `NavigatorBlueprint` - the same object the
 * engine runs, the codegen prints and the export file contains, so there is no
 * separate authoring format to keep in sync.
 */
export function LayoutBuilder({ layout, presets, onChange, onSave, onDelete, onClose, saved }: Props) {
  const [tab, setTab] = useState<'tree' | 'transfer'>('tree');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const validation = useMemo(() => validateBlueprint(layout.blueprint), [layout.blueprint]);

  const setBlueprint = useCallback(
    (blueprint: NavigatorBlueprint) => onChange({ ...layout, blueprint, updatedAt: Date.now() }),
    [layout, onChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const doExport = (download: boolean) => {
    const json = exportLayout(layout);
    if (download) {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${layout.label.replace(/[^\w-]+/g, '-').toLowerCase() || 'layout'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    navigator.clipboard?.writeText(json).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false),
    );
  };

  const doImport = (text: string) => {
    const result = importLayout(text);
    if (!result.ok) {
      setImportError(result.errors);
      return;
    }
    setImportError(null);
    setImportText('');
    onChange(result.value);
    onSave(result.value);
    setTab('tree');
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full max-h-[880px] w-full max-w-[1180px] flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <header className="flex flex-wrap items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-ink-200">Navigation builder</h2>
          <InfoTip label="Build a navigator tree for a proof of concept. It runs on the same engine as the built-in presets, so bubbling, mounting and the v6/v7 differences all behave identically." />

          <input
            value={layout.label}
            onChange={(e) => onChange({ ...layout, label: e.target.value.slice(0, 60) })}
            placeholder="Layout name"
            className="ml-2 w-44 rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-[11.5px] text-ink-200 outline-none focus:border-focus-400"
          />
          <input
            value={layout.tagline}
            onChange={(e) => onChange({ ...layout, tagline: e.target.value.slice(0, 240) })}
            placeholder="What is it for?"
            className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-[11.5px] text-ink-200 outline-none focus:border-focus-400"
          />

          <div className="flex rounded-md border border-ink-700 bg-ink-900 p-0.5 text-[10px] font-medium">
            {(
              [
                ['tree', 'Structure'],
                ['transfer', 'Import / export'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`rounded px-2 py-1 transition-colors ${tab === id ? 'bg-ink-700 text-ink-200' : 'text-ink-300 hover:text-ink-200'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            className="rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-200"
          >
            Close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_380px]">
          {/* ------------- editor ------------- */}
          <div className="min-h-0 overflow-y-auto border-ink-700 p-4 lg:border-r">
            {tab === 'tree' ? (
              <NavigatorEditor
                nav={layout.blueprint}
                root={layout.blueprint}
                depth={0}
                onChange={setBlueprint}
                onReplaceRoot={setBlueprint}
              />
            ) : (
              <div className="space-y-4">
                <section>
                  <h3 className="mb-1.5 text-[11px] font-semibold text-ink-200">Export</h3>
                  <p className="mb-2 text-[10.5px] leading-snug text-ink-300">
                    A self-contained JSON file. Keep it in your repo next to the proof of concept, or paste it to a colleague.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => doExport(true)}
                      className="rounded-md border border-focus-400/50 bg-focus-400/10 px-2.5 py-1 text-[11px] text-focus-400 transition-colors hover:bg-focus-400/20"
                    >
                      Download .json
                    </button>
                    <button
                      onClick={() => doExport(false)}
                      className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 text-[11px] text-ink-200 transition-colors hover:border-ink-500"
                    >
                      {copied ? 'Copied' : 'Copy to clipboard'}
                    </button>
                  </div>
                  <CodeBlock code={exportLayout(layout)} language="json" className="mt-2 max-h-52" />
                </section>

                <section>
                  <h3 className="mb-1.5 text-[11px] font-semibold text-ink-200">Import</h3>
                  <p className="mb-2 text-[10.5px] leading-snug text-ink-300">
                    Paste an exported file, or just a bare navigator blueprint. It is validated before anything is loaded —
                    duplicate navigator ids, unknown navigator types and bad initialRouteName values are all rejected with a
                    reason.
                  </p>
                  <div className="mb-2 flex gap-2">
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 text-[11px] text-ink-200 transition-colors hover:border-ink-500"
                    >
                      Choose file…
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        doImport(await file.text());
                        e.target.value = '';
                      }}
                    />
                    <button
                      onClick={() => doImport(importText)}
                      disabled={!importText.trim()}
                      className="rounded-md border border-alive-400/50 bg-alive-400/10 px-2.5 py-1 text-[11px] text-alive-400 transition-colors hover:bg-alive-400/20 disabled:opacity-40"
                    >
                      Import pasted JSON
                    </button>
                  </div>
                  <textarea
                    value={importText}
                    onChange={(e) => {
                      setImportText(e.target.value);
                      setImportError(null);
                    }}
                    spellCheck={false}
                    placeholder='{ "format": "react-navigation-simulator/layout", … }'
                    className="mono h-40 w-full rounded-lg border border-ink-700 bg-ink-950 p-2 text-[10px] text-ink-200 outline-none placeholder:text-ink-500 focus:border-focus-400"
                  />
                  {importError && (
                    <ul className="mt-2 space-y-1 rounded border border-gone-400/40 bg-gone-400/[0.07] p-2">
                      {importError.map((err) => (
                        <li key={err} className="text-[10.5px] leading-snug text-gone-400">
                          {err}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <h3 className="mb-1.5 text-[11px] font-semibold text-ink-200">Start from a preset</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {presets.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => {
                          const copy = duplicateAsCustom(preset);
                          onChange(copy);
                          onSave(copy);
                          setTab('tree');
                        }}
                        className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-[10.5px] text-ink-200 transition-colors hover:border-ink-500"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>

          {/* ------------- live preview ------------- */}
          <div className="flex min-h-0 flex-col overflow-y-auto p-4">
            <h3 className="mb-1.5 text-[11px] font-semibold text-ink-200">Generated config</h3>
            {validation.ok ? (
              <CodeBlock code={generateStatic(layout.blueprint)} language="tsx" className="!text-[9.5px]" />
            ) : (
              <ul className="space-y-1 rounded border border-gone-400/40 bg-gone-400/[0.07] p-2">
                {validation.errors.map((err) => (
                  <li key={err} className="text-[10.5px] leading-snug text-gone-400">
                    {err}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* footer */}
        <footer className="flex items-center gap-2 border-t border-ink-700 bg-ink-850 px-4 py-2.5">
          <button
            onClick={() => onChange(blankLayout())}
            className="rounded-md border border-ink-700 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-200"
          >
            New blank
          </button>
          <button
            onClick={() => onDelete(layout.id)}
            className="rounded-md border border-gone-400/40 px-2.5 py-1 text-[11px] text-gone-400 transition-colors hover:bg-gone-400/10"
          >
            Delete
          </button>

          <span className="mono ml-auto text-[10px] text-ink-300">
            {validation.ok ? `${countNavigators(layout.blueprint)} navigators · ${countScreens(layout.blueprint)} screens` : `${validation.errors.length} problem(s)`}
          </span>

          <button
            onClick={() => onSave(layout)}
            disabled={!validation.ok}
            className="rounded-md border border-focus-400/50 bg-focus-400/15 px-3 py-1 text-[11px] font-medium text-focus-400 transition-colors hover:bg-focus-400/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saved ? 'Save & run' : 'Save & run'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NavigatorEditor({
  nav,
  root,
  depth,
  onChange,
  onReplaceRoot,
}: {
  nav: NavigatorBlueprint;
  root: NavigatorBlueprint;
  depth: number;
  onChange: (next: NavigatorBlueprint) => void;
  onReplaceRoot: (next: NavigatorBlueprint) => void;
}) {
  const update = (patch: Partial<NavigatorBlueprint>) => onChange({ ...nav, ...patch });

  const setScreen = (index: number, screen: ScreenBlueprint) => {
    const screens = nav.screens.slice();
    screens[index] = screen;
    update({ screens });
  };

  const addScreen = () => {
    const base = 'Screen';
    let name = base;
    for (let i = 1; nav.screens.some((s) => s.name === name); i++) name = `${base}${i + 1}`;
    update({ screens: [...nav.screens, { name, icon: name.charAt(0) }] });
  };

  const removeScreen = (index: number) => {
    if (nav.screens.length === 1) return;
    const removed = nav.screens[index];
    const screens = nav.screens.filter((_, i) => i !== index);
    update({
      screens,
      ...(nav.initialRouteName === removed.name ? { initialRouteName: undefined } : {}),
    });
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= nav.screens.length) return;
    const screens = nav.screens.slice();
    [screens[index], screens[target]] = [screens[target], screens[index]];
    update({ screens });
  };

  return (
    <div className={`rounded-lg border border-ink-700 bg-ink-900/60 ${depth > 0 ? 'mt-2' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-700/70 px-3 py-2">
        <select
          value={nav.type}
          onChange={(e) => {
            const type = e.target.value as NavigatorType;
            update({ type, ...(type === 'stack' ? { backBehavior: undefined } : {}) });
          }}
          className="mono rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10.5px] text-ink-200 outline-none focus:border-focus-400"
        >
          {(Object.keys(NAV_LABEL) as NavigatorType[]).map((t) => (
            <option key={t} value={t}>
              {NAV_LABEL[t]}
            </option>
          ))}
        </select>

        <label className="mono flex items-center gap-1 text-[10px] text-ink-300">
          id
          <input
            value={nav.id}
            onChange={(e) => update({ id: e.target.value.replace(/[^a-z0-9-]/gi, '').toLowerCase() })}
            className="w-24 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10.5px] text-ink-200 outline-none focus:border-focus-400"
          />
        </label>

        <label className="mono flex items-center gap-1 text-[10px] text-ink-300">
          initial
          <select
            value={nav.initialRouteName ?? ''}
            onChange={(e) => update({ initialRouteName: e.target.value || undefined })}
            className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10.5px] text-ink-200 outline-none focus:border-focus-400"
          >
            <option value="">first screen</option>
            {nav.screens.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {nav.type !== 'stack' && (
          <label className="mono flex items-center gap-1 text-[10px] text-ink-300">
            backBehavior
            <select
              value={nav.backBehavior ?? ''}
              onChange={(e) => update({ backBehavior: (e.target.value || undefined) as BackBehavior | undefined })}
              className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10.5px] text-ink-200 outline-none focus:border-focus-400"
            >
              <option value="">firstRoute (default)</option>
              {BACK_BEHAVIORS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          onClick={addScreen}
          className="ml-auto rounded border border-ink-700 px-2 py-0.5 text-[10px] text-ink-200 transition-colors hover:border-focus-400 hover:text-focus-400"
        >
          + screen
        </button>
      </div>

      <div className="space-y-1.5 p-2">
        {nav.screens.map((screen, i) => (
          <ScreenEditor
            key={i}
            screen={screen}
            index={i}
            count={nav.screens.length}
            root={root}
            depth={depth}
            onChange={(next) => setScreen(i, next)}
            onRemove={() => removeScreen(i)}
            onMove={(delta) => move(i, delta)}
            onReplaceRoot={onReplaceRoot}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ScreenEditor({
  screen,
  index,
  count,
  root,
  depth,
  onChange,
  onRemove,
  onMove,
  onReplaceRoot,
}: {
  screen: ScreenBlueprint;
  index: number;
  count: number;
  root: NavigatorBlueprint;
  depth: number;
  onChange: (next: ScreenBlueprint) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onReplaceRoot: (next: NavigatorBlueprint) => void;
}) {
  const [open, setOpen] = useState(false);

  const addNested = () => {
    onChange({
      ...screen,
      nested: {
        id: nextNavId(root, `${screen.name.toLowerCase()}`),
        type: 'stack',
        screens: [{ name: `${screen.name}Home`, icon: screen.name.charAt(0) }],
      },
    });
  };

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850">
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
        <span className="mono w-5 shrink-0 text-[10px] text-ink-500">{index}</span>

        <input
          value={screen.name}
          onChange={(e) => onChange({ ...screen, name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })}
          className="mono w-32 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-200 outline-none focus:border-focus-400"
        />
        <input
          value={screen.icon ?? ''}
          onChange={(e) => onChange({ ...screen, icon: e.target.value.slice(0, 3) })}
          placeholder="ic"
          className="mono w-10 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-center text-[11px] text-ink-200 outline-none focus:border-focus-400"
        />

        <button
          onClick={() => setOpen((v) => !v)}
          className="mono rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-200"
        >
          {open ? 'less' : 'more'}
        </button>

        {screen.nested ? (
          <span className="mono rounded border border-focus-400/40 bg-focus-400/10 px-1.5 py-0.5 text-[9.5px] text-focus-400">
            nested {screen.nested.type}
          </span>
        ) : (
          depth < 4 && (
            <button
              onClick={addNested}
              className="mono rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-300 transition-colors hover:border-alive-400 hover:text-alive-400"
            >
              + navigator
            </button>
          )
        )}

        <span className="ml-auto flex shrink-0 gap-1">
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="mono rounded border border-ink-700 px-1.5 text-[10px] text-ink-300 transition-colors hover:border-ink-500 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            className="mono rounded border border-ink-700 px-1.5 text-[10px] text-ink-300 transition-colors hover:border-ink-500 disabled:opacity-30"
          >
            ↓
          </button>
          <button
            onClick={onRemove}
            disabled={count === 1}
            className="mono rounded border border-ink-700 px-1.5 text-[10px] text-gone-400 transition-colors hover:border-gone-400 disabled:opacity-30"
          >
            ×
          </button>
        </span>
      </div>

      {open && (
        <div className="grid gap-1.5 border-t border-ink-700/60 px-2 py-2 sm:grid-cols-2">
          <label className="mono block text-[9.5px] text-ink-300">
            title
            <input
              value={screen.title ?? ''}
              onChange={(e) => onChange({ ...screen, title: e.target.value || undefined })}
              placeholder={screen.name}
              className="mt-0.5 w-full rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10.5px] text-ink-200 outline-none focus:border-focus-400"
            />
          </label>
          <label className="mono block text-[9.5px] text-ink-300">
            initialParams (JSON)
            <input
              value={screen.initialParams ? JSON.stringify(screen.initialParams) : ''}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (!raw) return onChange({ ...screen, initialParams: undefined });
                try {
                  const parsed = JSON.parse(raw);
                  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    onChange({ ...screen, initialParams: parsed });
                  }
                } catch {
                  /* keep the last valid value while typing */
                }
              }}
              placeholder='{ "id": 1 }'
              className="mt-0.5 w-full rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10.5px] text-ink-200 outline-none focus:border-focus-400"
            />
          </label>
          <label className="mono block text-[9.5px] text-ink-300 sm:col-span-2">
            blurb (shown on the device)
            <input
              value={screen.blurb ?? ''}
              onChange={(e) => onChange({ ...screen, blurb: e.target.value || undefined })}
              className="mt-0.5 w-full rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10.5px] text-ink-200 outline-none focus:border-focus-400"
            />
          </label>
        </div>
      )}

      {screen.nested && (
        <div className="border-t border-ink-700/60 px-2 pb-2 pt-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="mono text-[9.5px] text-ink-300">nested navigator</span>
            <button
              onClick={() => {
                const { nested: _drop, ...rest } = screen;
                onChange(rest);
              }}
              className="mono rounded border border-ink-700 px-1.5 text-[9.5px] text-gone-400 transition-colors hover:border-gone-400"
            >
              remove
            </button>
          </div>
          <NavigatorEditor
            nav={screen.nested}
            root={root}
            depth={depth + 1}
            onChange={(next) => onChange({ ...screen, nested: next })}
            onReplaceRoot={onReplaceRoot}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function countNavigators(bp: NavigatorBlueprint): number {
  return 1 + bp.screens.reduce((sum, s) => sum + (s.nested ? countNavigators(s.nested) : 0), 0);
}

function countScreens(bp: NavigatorBlueprint): number {
  return bp.screens.reduce((sum, s) => sum + 1 + (s.nested ? countScreens(s.nested) : 0), 0);
}
