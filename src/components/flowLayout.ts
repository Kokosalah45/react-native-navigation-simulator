import { Position, type Edge, type Node } from '@xyflow/react';
import type { NavState, RouteState, RouteVerdict } from '../engine/types';
import type { Ghost, SessionState } from '../engine/session';
import { getScreenBlueprint } from '../engine/blueprint';
import { isDrawerOpen } from '../engine/routers';

/**
 * Turns `navigation.getState()` into a positioned graph.
 *
 * React Flow deliberately ships no layouting, so positions are ours to supply.
 * Navigation state is a strict tree - a navigator owns routes, a route may own
 * one navigator - so a dendrogram is enough and, unlike a force layout, it is
 * deterministic: the same state always draws the same picture, which matters
 * when you are comparing before and after a dispatch.
 *
 * The tree grows along a *depth* axis and siblings spread along a *cross* axis.
 * Which of those is horizontal is only a mapping applied at the end, so both
 * orientations come out of one algorithm:
 *
 *   TB - depth runs downward. Reads like the config object you wrote, and like
 *        the getState() JSON beside it.
 *   LR - depth runs rightward. One column is one getParent() hop, so the path
 *        an action bubbles along is the horizontal one.
 */

export type FlowDirection = 'TB' | 'LR';

/* Fixed sizes keep the layout exact; detail that would change a node's size
   lives in tooltips instead. */
export const NAV_W = 250;
export const NAV_H = 104;
export const ROUTE_W = 240;
export const ROUTE_H = 86;
export const GHOST_H = 64;

/** Depth needs more room when it runs sideways; siblings need more when stacked. */
const GAPS: Record<FlowDirection, { depth: number; cross: number }> = {
  LR: { depth: 78, cross: 16 },
  TB: { depth: 58, cross: 24 },
};

/** Carried on every node so the handles it renders match the declared ones. */
interface Directed {
  dir: FlowDirection;
  [key: string]: unknown;
}

export interface NavNodeData extends Directed {
  state: NavState;
  handled: boolean;
  drawerOpen: boolean;
  onFocusChain: boolean;
}

export interface RouteNodeData extends Directed {
  route: RouteState;
  index: number;
  navType: NavState['type'];
  navKey: string;
  /** `index === nav.index`: the one route this navigator points at. */
  active: boolean;
  isTop: boolean;
  focused: boolean;
  mounted: boolean;
  verdict?: RouteVerdict;
  blurb?: string;
}

export interface GhostNodeData extends Directed {
  ghost: Ghost;
}

export type NavigatorFlowNode = Node<NavNodeData, 'navigator'>;
export type RouteFlowNode = Node<RouteNodeData, 'route'>;
export type GhostFlowNode = Node<GhostNodeData, 'ghost'>;

export type FlowNode = NavigatorFlowNode | RouteFlowNode | GhostFlowNode;

export interface FlowGraph {
  nodes: FlowNode[];
  edges: Edge[];
  /** Changes only when the shape changes, so the viewport refits on structure. */
  signature: string;
}

interface Ctx {
  session: SessionState;
  dir: FlowDirection;
  nodes: FlowNode[];
  edges: Edge[];
}

export function buildGraph(session: SessionState, dir: FlowDirection): FlowGraph {
  const ctx: Ctx = { session, dir, nodes: [], edges: [] };
  layoutNavigator(session.root, 0, 0, ctx);
  return {
    nodes: ctx.nodes,
    edges: ctx.edges,
    signature: `${dir}:${ctx.nodes.map((n) => n.id).join('|')}`,
  };
}

/* ------------------------------ axis mapping ------------------------------ */

const depthSpan = (dir: FlowDirection, w: number, h: number) => (dir === 'LR' ? w : h);
const crossSpan = (dir: FlowDirection, w: number, h: number) => (dir === 'LR' ? h : w);
const place = (dir: FlowDirection, depth: number, cross: number) =>
  dir === 'LR' ? { x: depth, y: cross } : { x: cross, y: depth };

/**
 * Explicit geometry rather than measured geometry.
 *
 * React Flow only draws a node once it has a width and a height, and only
 * draws an edge once it knows where the handles are - normally both come from
 * measuring the DOM. Measuring is fragile here for two reasons: the panel can
 * mount into a column dragged shut, and every dispatch hands React Flow new
 * node objects, which arrive without the `measured` values the previous ones
 * had. Either way the edges quietly disappear.
 *
 * These nodes are fixed-size by design, so the sizes and the handle positions
 * are known up front and can just be declared. The docs' server-side rendering
 * path relies on exactly this, and it makes the graph deterministic: correct on
 * the first frame, with no measurement pass to lose.
 */
const geometry = (dir: FlowDirection, w: number, h: number) =>
  ({
    width: w,
    height: h,
    // `width`/`height` are enough to draw the node, but fitView only runs once
    // React Flow considers the nodes initialized, and that check reads
    // `measured` - which a freshly rebuilt node object does not carry. These
    // sizes are fixed, so stating the measurement is accurate, not a shim.
    measured: { width: w, height: h },
    handles:
      dir === 'LR'
        ? [
            { type: 'target' as const, position: Position.Left, x: 0, y: h / 2 },
            { type: 'source' as const, position: Position.Right, x: w, y: h / 2 },
          ]
        : [
            { type: 'target' as const, position: Position.Top, x: w / 2, y: 0 },
            { type: 'source' as const, position: Position.Bottom, x: w / 2, y: h },
          ],
  }) satisfies Partial<Node>;

/* -------------------------------- layout -------------------------------- */

/** Lays a navigator and its subtree out, returning the cross-axis span it uses. */
function layoutNavigator(nav: NavState, depth: number, crossTop: number, ctx: Ctx): number {
  const { session, dir } = ctx;
  const gap = GAPS[dir];
  const childDepth = depth + depthSpan(dir, NAV_W, NAV_H) + gap.depth;
  const ghosts = session.ghosts.filter((g) => g.navKey === nav.key);

  let cursor = crossTop;
  const anchors: { id: string; edge: Partial<Edge> }[] = [];

  nav.routes.forEach((route, i) => {
    const span = layoutRoute(route, nav, i, childDepth, cursor, ctx);
    anchors.push({
      id: route.key,
      edge: {
        label: `routes[${i}]`,
        ...edgeTone(i === nav.index, session.focused.includes(route.key)),
      },
    });
    cursor += span + gap.cross;
  });

  for (const ghost of ghosts) {
    ctx.nodes.push({
      id: `ghost-${ghost.key}`,
      type: 'ghost',
      position: place(dir, childDepth, cursor),
      data: { ghost, dir },
      ...geometry(dir, ROUTE_W, GHOST_H),
    });
    anchors.push({
      id: `ghost-${ghost.key}`,
      edge: {
        label: 'removed',
        style: { stroke: '#fb7185', strokeWidth: 1.2, strokeDasharray: '4 3' },
        labelStyle: { fill: '#fb7185', fontSize: 9 },
      },
    });
    cursor += crossSpan(dir, ROUTE_W, GHOST_H) + gap.cross;
  }

  const navCross = crossSpan(dir, NAV_W, NAV_H);
  const block = Math.max(cursor - gap.cross - crossTop, navCross);

  ctx.nodes.push({
    id: nav.key,
    type: 'navigator',
    position: place(dir, depth, crossTop + (block - navCross) / 2),
    data: {
      state: nav,
      handled: session.last?.handledBy === nav.key,
      drawerOpen: nav.type === 'drawer' && isDrawerOpen(nav),
      onFocusChain: isOnFocusChain(nav, session),
      dir,
    },
    ...geometry(dir, NAV_W, NAV_H),
  });

  for (const anchor of anchors) {
    ctx.edges.push({
      id: `${nav.key}->${anchor.id}`,
      source: nav.key,
      target: anchor.id,
      type: 'smoothstep',
      ...anchor.edge,
    });
  }

  return block;
}

/** Lays a route and the navigator it renders out, returning its cross-axis span. */
function layoutRoute(
  route: RouteState,
  nav: NavState,
  index: number,
  depth: number,
  crossTop: number,
  ctx: Ctx,
): number {
  const { session, dir } = ctx;
  const own = crossSpan(dir, ROUTE_W, ROUTE_H);
  let span = own;
  let cross = crossTop;

  if (route.state) {
    const childDepth = depth + depthSpan(dir, ROUTE_W, ROUTE_H) + GAPS[dir].depth;
    const nested = layoutNavigator(route.state, childDepth, crossTop, ctx);
    span = Math.max(own, nested);
    cross = crossTop + (span - own) / 2;

    ctx.edges.push({
      id: `${route.key}->${route.state.key}`,
      source: route.key,
      target: route.state.key,
      type: 'smoothstep',
      label: 'route.state',
      ...edgeTone(true, session.focused.includes(route.key)),
    });
  }

  ctx.nodes.push({
    id: route.key,
    type: 'route',
    position: place(dir, depth, cross),
    data: {
      route,
      index,
      navType: nav.type,
      navKey: nav.key,
      active: index === nav.index,
      isTop: index === nav.routes.length - 1,
      focused: session.focused.includes(route.key),
      mounted: session.mounted.includes(route.key),
      verdict: session.verdicts[route.key],
      blurb: getScreenBlueprint(session.idx, nav.key, route.name)?.blurb,
      dir,
    },
    ...geometry(dir, ROUTE_W, ROUTE_H),
  });

  return span;
}

/**
 * The focus chain is the only path where `isFocused()` is true all the way up,
 * so it is the one worth drawing loudest.
 */
function isOnFocusChain(nav: NavState, session: SessionState): boolean {
  if (nav.key === session.root.key) return true;
  return nav.routes.some((r) => session.focused.includes(r.key));
}

function edgeTone(active: boolean, focused: boolean): Partial<Edge> {
  if (focused) {
    return {
      animated: true,
      style: { stroke: '#38bdf8', strokeWidth: 1.8 },
      labelStyle: { fill: '#38bdf8', fontSize: 9 },
    };
  }
  if (active) {
    return {
      style: { stroke: '#3d4d68', strokeWidth: 1.4 },
      labelStyle: { fill: '#8ea0bd', fontSize: 9 },
    };
  }
  return {
    style: { stroke: '#1c2536', strokeWidth: 1 },
    labelStyle: { fill: '#3d4d68', fontSize: 9 },
  };
}
