import { useMemo } from 'react';
import ReactJson from '@microlink/react-json-view';
import type { NavState } from '../engine/types';

/**
 * The raw `navigation.getState()` object as a collapsible tree.
 *
 * Uses @microlink/react-json-view — the maintained fork of react-json-view,
 * whose own peerDependencies still cap at React 17 (last published 2022) and
 * so cannot be used on React 19. Same component, same props.
 */

/** base16 palette wired to the app's own tokens so the tree matches the chrome. */
const THEME = {
  base00: 'rgba(0,0,0,0)', // transparent: the panel behind supplies the background
  base01: '#141b2b',
  base02: '#1c2536',
  base03: '#3d4d68', // collapsed-content ellipsis
  base04: '#8ea0bd', // object size counts
  base05: '#b8c6dd', // punctuation / default text
  base06: '#b8c6dd',
  base07: '#b8c6dd', // keys
  base08: '#fb7185', // NaN
  base09: '#34d399', // strings
  base0A: '#3d4d68', // null / undefined
  base0B: '#c084fc', // floats
  base0C: '#38bdf8', // array indices
  base0D: '#38bdf8', // expand / collapse arrows
  base0E: '#c084fc', // booleans
  base0F: '#c084fc', // integers
};

export function JsonTree({ root }: { root: NavState }) {
  /**
   * v7 deep-freezes the state tree, and the viewer keeps internal copies of
   * whatever it is handed. A structural clone keeps it away from the frozen
   * objects without changing what is displayed.
   */
  const src = useMemo(() => JSON.parse(JSON.stringify(root)) as Record<string, unknown>, [root]);

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-950 p-3">
      <ReactJson
        src={src}
        name={null}
        theme={THEME}
        iconStyle="triangle"
        indentWidth={2}
        collapsed={4}
        collapseStringsAfterLength={40}
        displayDataTypes={false}
        displayObjectSize
        enableClipboard
        quotesOnKeys={false}
        sortKeys={false}
        style={{
          backgroundColor: 'transparent',
          fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Consolas, monospace",
          fontSize: '10.5px',
          lineHeight: 1.6,
        }}
      />
    </div>
  );
}
