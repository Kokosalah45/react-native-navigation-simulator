import { Highlight, type Language, type PrismTheme } from 'prism-react-renderer';

/**
 * Syntax highlighting for every code surface in the app, themed from the same
 * tokens as the rest of the chrome so generated config, dispatched calls and
 * the JSON tree all read as one palette.
 */
export const CODE_THEME: PrismTheme = {
  plain: { color: '#b8c6dd', backgroundColor: 'transparent' },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: '#3d4d68', fontStyle: 'italic' } },
    { types: ['punctuation'], style: { color: '#8ea0bd' } },
    { types: ['operator', 'entity', 'url'], style: { color: '#8ea0bd' } },
    { types: ['keyword', 'boolean', 'constant', 'symbol', 'number'], style: { color: '#c084fc' } },
    { types: ['string', 'char', 'attr-value', 'inserted'], style: { color: '#34d399' } },
    { types: ['function', 'method'], style: { color: '#38bdf8' } },
    { types: ['tag'], style: { color: '#38bdf8' } },
    { types: ['class-name', 'maybe-class-name'], style: { color: '#fbbf24' } },
    { types: ['attr-name', 'property'], style: { color: '#fbbf24' } },
    { types: ['deleted'], style: { color: '#fb7185' } },
    { types: ['variable', 'parameter', 'imports'], style: { color: '#b8c6dd' } },
  ],
};

interface BlockProps {
  code: string;
  language?: Language;
  className?: string;
}

/** A multi-line, horizontally scrollable, selectable code block. */
export function CodeBlock({ code, language = 'tsx', className = '' }: BlockProps) {
  return (
    <Highlight theme={CODE_THEME} code={code.trimEnd()} language={language}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre
          className={`mono select-text overflow-x-auto rounded-lg border border-ink-700 bg-ink-950 p-3 text-[10.5px] leading-relaxed ${className}`}
        >
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

interface LineProps {
  code: string;
  language?: Language;
  className?: string;
}

/**
 * A single highlighted line with no block chrome, for places that already have
 * their own container (call shapes, console entries).
 */
export function CodeLine({ code, language = 'jsx', className = '' }: LineProps) {
  return (
    <Highlight theme={CODE_THEME} code={code} language={language}>
      {({ tokens, getTokenProps }) => (
        <code className={`mono block overflow-x-auto whitespace-nowrap ${className}`}>
          {tokens.map((line, i) => (
            <span key={i}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </span>
          ))}
        </code>
      )}
    </Highlight>
  );
}
