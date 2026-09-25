import { useMemo, useState } from 'react';
import type { RNVersion } from '../engine/types';
import type { NavigatorBlueprint } from '../engine/blueprint';
import { VERSION_FACTS, generateDynamic, generateStatic } from '../engine/codegen';
import { CodeBlock } from './CodeBlock';

interface Props {
  blueprint: NavigatorBlueprint;
  version: RNVersion;
}

/**
 * Shows the current layout written both ways, plus the v6 -> v7 changes that
 * actually alter runtime behaviour.
 *
 * The static API is v7's architectural headline: the navigation graph stops
 * being a JSX tree you render and becomes a configuration object you declare.
 * Because that object is plain data, v7 can derive the TypeScript param lists
 * and the deep-linking config from it instead of asking you to keep three
 * sources of truth in sync by hand.
 */
export function CodePanel({ blueprint, version }: Props) {
  const [tab, setTab] = useState<'static' | 'dynamic' | 'diff'>(version === 'v7' ? 'static' : 'dynamic');

  const code = useMemo(
    () => (tab === 'static' ? generateStatic(blueprint) : tab === 'dynamic' ? generateDynamic(blueprint) : ''),
    [tab, blueprint],
  );

  return (
    <section className="flex min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-ink-700 px-4 py-2">
        <h2 className="text-[12px] font-semibold text-ink-200">Layout configuration</h2>
        <div className="ml-auto flex rounded-md border border-ink-700 bg-ink-900 p-0.5 text-[10px] font-medium">
          {(
            [
              ['static', 'v7 static'],
              ['dynamic', 'v6 dynamic'],
              ['diff', 'what changed'],
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
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'diff' ? (
          <div className="space-y-2">
            {VERSION_FACTS.map((fact) => (
              <div key={fact.title} className="rounded-lg border border-ink-700 bg-ink-900/60 p-2.5">
                <h3 className="mb-1.5 text-[11.5px] font-semibold text-ink-200">{fact.title}</h3>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  <p className="rounded border border-v6-400/25 bg-v6-400/[0.07] px-2 py-1.5 text-[10.5px] leading-snug text-ink-200">
                    <span className="mono mr-1 font-bold text-v6-400">v6</span>
                    {fact.v6}
                  </p>
                  <p className="rounded border border-v7-400/25 bg-v7-400/[0.07] px-2 py-1.5 text-[10.5px] leading-snug text-ink-200">
                    <span className="mono mr-1 font-bold text-v7-400">v7</span>
                    {fact.v7}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <p className="mb-2 text-[10.5px] leading-snug text-ink-300">
              {tab === 'static'
                ? 'v7 static architecture: the whole graph is one serialisable object, so param-list types and linking paths are derived from it rather than maintained separately.'
                : 'v6 dynamic architecture: navigators are components you render, and every param list has to be written and kept in sync by hand.'}
            </p>
            <CodeBlock code={code} language="tsx" />
          </>
        )}
      </div>
    </section>
  );
}
