import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import type { NavState } from '../engine/types';
import type { SessionState } from '../engine/session';
import {
  buildGraph,
  type FlowNode,
  type GhostFlowNode,
  type NavigatorFlowNode,
  type RouteFlowNode,
} from './flowLayout';
import { Tooltip } from './Tooltip';

/**
 * `navigation.getState()` drawn as a graph.
 *
 * The tree shape is the lesson: every navigator is its own state object with
 * its own `index` and `routes`, and an action walks this graph upward until a
 * router stops returning `null`. Laying depth out horizontally makes that
 * path literal - one column is one `getParent()` hop.
 */

const NAV_META: Record<NavState['type'], { label: string; factory: string; tone: string }> = {
  stack: { label: 'STACK', factory: 'createNativeStackNavigator', tone: 'text-focus-400 border-focus-400/40 bg-focus-400/10' },
  tab: { label: 'TABS', factory: 'createBottomTabNavigator', tone: 'text-alive-400 border-alive-400/40 bg-alive-400/10' },
  drawer: { label: 'DRAWER', factory: 'createDrawerNavigator', tone: 'text-param-400 border-param-400/40 bg-param-400/10' },
};

/** Hidden, but present: an edge cannot attach without a handle. Never display:none. */
function Ports() {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!h-1 !w-1 !border-0 !bg-ink-600 opacity-0" />
      <Handle type="source" position={Position.Right} className="!h-1 !w-1 !border-0 !bg-ink-600 opacity-0" />
    </>
  );
}

/* ------------------------------ navigator ------------------------------ */

function NavigatorNode({ data }: NodeProps<NavigatorFlowNode>) {
  const { state, handled, drawerOpen, onFocusChain } = data;
  const meta = NAV_META[state.type];

  return (
    <div
      className={`flex h-full w-full flex-col gap-1 rounded-xl border bg-ink-900/95 px-2.5 py-2 ${
        handled
          ? 'border-focus-400/70 shadow-[0_0_0_2px_rgba(56,189,248,0.25)]'
          : onFocusChain
            ? 'border-ink-600'
            : 'border-ink-700'
      }`}
    >
      <Ports />

      <div className="flex items-center gap-1.5">
        <Tooltip
          wide
          label={
            <span>
              <strong className="text-ink-200">{meta.factory}</strong>
              <br />
              This navigator holds its own state object with its own <code className="text-focus-400">index</code> and{' '}
              <code className="text-focus-400">routes</code>. Actions are handled here first if the focused screen belongs to it,
              otherwise they bubble to the parent.
            </span>
          }
        >
          <span className={`mono cursor-help rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${meta.tone}`}>
            {meta.label}
          </span>
        </Tooltip>
        <span className="mono truncate text-[10px] text-ink-300">{state.key}</span>
        {handled && (
          <span className="mono ml-auto shrink-0 rounded bg-focus-400/15 px-1 py-0.5 text-[8.5px] font-bold text-focus-400">
            HANDLED
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Tooltip
          label={
            <span>
              <code className="text-focus-400">index</code> is the only pointer to the focused route. For a stack it is always{' '}
              <code>routes.length - 1</code>; for tabs and drawers it moves freely without changing the array.
            </span>
          }
        >
          <span className="mono cursor-help rounded bg-ink-800 px-1.5 py-0.5 text-[9.5px] text-ink-200">
            index: {state.index}
          </span>
        </Tooltip>
        {drawerOpen && (
          <span className="mono rounded border border-param-400/40 bg-param-400/10 px-1 py-0.5 text-[8.5px] font-bold text-param-400">
            DRAWER OPEN
          </span>
        )}
      </div>

      <Tooltip
        wide
        label={
          <span>
            <code className="text-focus-400">routeNames</code> comes straight from the screens you declared. A router returns{' '}
            <code>null</code> for any action naming a screen that is not in this list, which is precisely how actions bubble
            upward.
          </span>
        }
      >
        <div className="mono cursor-help truncate text-[9px] text-ink-300">routeNames: [{state.routeNames.join(', ')}]</div>
      </Tooltip>

      {state.history && (
        <Tooltip
          wide
          label={
            <span>
              Tab and drawer navigators keep a <code className="text-focus-400">history</code> array to implement{' '}
              <code>backBehavior</code>. An open drawer is stored here as a <code>{'{ type: "drawer" }'}</code> entry - which is
              why closing the drawer changes state without touching any route.
            </span>
          }
        >
          <div className="mono cursor-help truncate text-[9px] text-ink-300">
            history: [{state.history.map((h) => (h.type === 'drawer' ? 'drawer:open' : h.key)).join(', ')}]
          </div>
        </Tooltip>
      )}
    </div>
  );
}

/* -------------------------------- route -------------------------------- */

function RouteNode({ data }: NodeProps<RouteFlowNode>) {
  const { route, index, navType, active, isTop, focused, mounted, verdict, blurb } = data;

  const anim =
    verdict?.outcome === 'added'
      ? 'animate-push-in'
      : verdict?.outcome === 'refocused' || verdict?.outcome === 'params-updated'
        ? 'animate-flash'
        : '';

  const border = focused
    ? 'border-focus-400/70 bg-focus-400/[0.09]'
    : mounted
      ? 'border-ink-600 bg-ink-850'
      : 'border-dashed border-ink-700 bg-ink-900/70';

  return (
    <div className={`${anim} flex h-full w-full flex-col gap-1 rounded-lg border px-2 py-1.5 ${border}`}>
      <Ports />

      <div className="flex items-center gap-1.5">
        <Tooltip
          label={
            <span>
              Position <code className="text-focus-400">routes[{index}]</code>
              {isTop && navType === 'stack' ? ' - the top of the stack.' : '.'} Array order is history order; React Navigation
              never reorders it.
            </span>
          }
        >
          <span
            className={`mono cursor-help rounded px-1 py-0.5 text-[9.5px] font-semibold ${
              active ? 'bg-focus-400/20 text-focus-400' : 'bg-ink-800 text-ink-300'
            }`}
          >
            {index}
          </span>
        </Tooltip>

        <span className="truncate text-[12px] font-semibold text-ink-200">{route.name}</span>

        <span className="ml-auto flex shrink-0 gap-1">
          {focused && <Badge tone="focus" text="FOCUSED" tip="This route is on the focus chain from the root, so useFocusEffect has run and isFocused() is true." />}
          {!focused && mounted && (
            <Badge
              tone="alive"
              text="MOUNTED"
              tip="Rendered and alive in memory, but blurred. Its useEffect setup already ran and its component state is intact - only useFocusEffect has cleaned up."
            />
          )}
          {!mounted && (
            <Badge
              tone="idle"
              text="LAZY"
              tip="Present in the routes array but never rendered. Tab and drawer navigators are lazy by default, so a screen you have not visited yet exists in state without existing in the tree."
            />
          )}
          {verdict?.outcome === 'added' && <Badge tone="new" text="NEW" tip={verdict.reason} />}
        </span>
      </div>

      <Tooltip
        wide
        label={
          <span>
            {verdict ? (
              <>
                <strong className="text-ink-200">Last action: {verdict.outcome}</strong>
                <br />
                {verdict.reason}
              </>
            ) : (
              (blurb ?? 'A route object: a key, a name and optional params.')
            )}
            <br />
            <span className="text-ink-300">
              The key identifies the component instance. Same key across a dispatch means the same React component, with its
              state preserved.
            </span>
          </span>
        }
      >
        <div className="mono cursor-help truncate text-[9.5px] text-ink-300">key: {route.key}</div>
      </Tooltip>

      {route.params ? (
        <Tooltip
          wide
          label={
            <span>
              Params live on the route object, not in component state. <code className="text-focus-400">setParams()</code>{' '}
              shallow-merges into this object and produces a new route object - the previous one is never mutated, which is what
              lets React detect the change.
            </span>
          }
        >
          <div className="mono cursor-help truncate rounded border border-param-400/25 bg-param-400/[0.07] px-1 py-0.5 text-[9px] text-param-400">
            params: {JSON.stringify(route.params)}
          </div>
        </Tooltip>
      ) : (
        <div className="mono truncate text-[9px] text-ink-500">no params</div>
      )}
    </div>
  );
}

/* -------------------------------- ghost -------------------------------- */

function GhostNode({ data }: NodeProps<GhostFlowNode>) {
  const { ghost } = data;
  return (
    <div className="animate-dissolve flex h-full w-full flex-col gap-1 overflow-hidden rounded-lg border border-gone-400/40 bg-gone-400/[0.08] px-2 py-1.5">
      <Ports />
      <div className="flex items-center gap-1.5">
        <span className="mono rounded bg-gone-400/20 px-1 py-0.5 text-[9.5px] font-semibold text-gone-400">×</span>
        <span className="truncate text-[12px] font-semibold text-gone-400 line-through">{ghost.name}</span>
        <span className="mono ml-auto shrink-0 text-[9px] text-gone-400/70">{ghost.key}</span>
      </div>
      <p className="line-clamp-2 text-[9.5px] leading-snug text-gone-400/80">{ghost.reason}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const BADGE_TONES = {
  focus: 'border-focus-400/50 bg-focus-400/15 text-focus-400',
  alive: 'border-alive-400/40 bg-alive-400/10 text-alive-400',
  idle: 'border-ink-600 bg-ink-800 text-ink-300',
  new: 'border-focus-400/50 bg-focus-400/20 text-focus-400',
} as const;

function Badge({ tone, text, tip }: { tone: keyof typeof BADGE_TONES; text: string; tip: string }) {
  return (
    <Tooltip wide label={tip}>
      <span className={`mono cursor-help rounded border px-1 py-[1px] text-[8.5px] font-bold tracking-wider ${BADGE_TONES[tone]}`}>
        {text}
      </span>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */

// Defined once, outside the component: React Flow warns and re-renders the
// whole graph if this object identity changes between renders.
const nodeTypes = {
  navigator: NavigatorNode,
  route: RouteNode,
  ghost: GhostNode,
} as unknown as NodeTypes;

const FIT_VIEW = { padding: 0.18, duration: 260, maxZoom: 1 };

function Flow({ session }: { session: SessionState }) {
  const graph = useMemo(() => buildGraph(session), [session]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const { fitView } = useReactFlow();

  // Positions are derived from state, so every dispatch re-seeds the graph
  // rather than trying to reconcile a layout that no longer describes it.
  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

  // Refit only when the shape changes. Refitting on a params update would
  // yank the viewport for a change that moved nothing.
  useEffect(() => {
    const id = window.setTimeout(() => void fitView(FIT_VIEW), 0);
    return () => window.clearTimeout(id);
  }, [graph.signature, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      colorMode="dark"
      fitView
      fitViewOptions={FIT_VIEW}
      minZoom={0.2}
      maxZoom={1.6}
      nodesConnectable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      className="bg-ink-950"
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#1c2536" />
      <Controls showInteractive={false} className="!shadow-none" />
    </ReactFlow>
  );
}

export function StateFlow({ session }: { session: SessionState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sized, setSized] = useState(false);

  // React Flow measures node and handle geometry from the DOM on mount. If it
  // mounts into a zero-sized box - a column dragged shut, a hidden tab - every
  // node comes back unmeasured, and unmeasured nodes mean no edges and a
  // fitView that silently does nothing. Waiting for a real box avoids that,
  // and avoids the library's own width/height warning.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSized(el.clientWidth > 0 && el.clientHeight > 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="h-full w-full">
      {sized ? (
        <ReactFlowProvider>
          <Flow session={session} />
        </ReactFlowProvider>
      ) : null}
    </div>
  );
}
