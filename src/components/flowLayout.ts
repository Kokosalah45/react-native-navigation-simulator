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
 * Depth runs left to right, so each column is one `getParent()` hop and the
 * bubbling path is the horizontal one.
 */

/* Fixed sizes keep the layout exact; detail that would change a node's height
   lives in tooltips instead. */
export const NAV_W = 250;
export const NAV_H = 104;
export const ROUTE_W = 240;
export const ROUTE_H = 86;
export const GHOST_H = 64;

const COL_GAP = 78;
const ROW_GAP = 16;

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
const geometry = (w: number, h: number) =>
  ({
    width: w,
    height: h,
    handles: [
      { type: 'target' as const, position: Position.Left, x: 0, y: h / 2 },
      { type: 'source' as const, position: Position.Right, x: w, y: h / 2 },
    ],
  }) satisfies Partial<Node>;

export type NavNodeData = {
  state: NavState;
  handled: boolean;
  drawerOpen: boolean;
  onFocusChain: boolean;
};

export type RouteNodeData = {
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
};

export type GhostNodeData = { ghost: Ghost };

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
  nodes: FlowNode[];
  edges: Edge[];
}

export function buildGraph(session: SessionState): FlowGraph {
  const ctx: Ctx = { session, nodes: [], edges: [] };
  layoutNavigator(session.root, 0, 0, ctx);
  return {
    nodes: ctx.nodes,
    edges: ctx.edges,
    signature: ctx.nodes.map((n) => n.id).join('|'),
  };
}

/** Lays a navigator and its subtree out, returning the height it occupies. */
function layoutNavigator(nav: NavState, x: number, top: number, ctx: Ctx): number {
  const { session } = ctx;
  const childX = x + NAV_W + COL_GAP;
  const ghosts = session.ghosts.filter((g) => g.navKey === nav.key);

  let cursor = top;
  const anchors: { id: string; y: number; edge: Partial<Edge> }[] = [];

  nav.routes.forEach((route, i) => {
    const height = layoutRoute(route, nav, i, childX, cursor, ctx);
    const focused = session.focused.includes(route.key);
    anchors.push({
      id: route.key,
      y: cursor,
      edge: {
        label: `routes[${i}]`,
        ...edgeTone(i === nav.index, focused),
      },
    });
    cursor += height + ROW_GAP;
  });

  for (const ghost of ghosts) {
    ctx.nodes.push({
      id: `ghost-${ghost.key}`,
      type: 'ghost',
      position: { x: childX, y: cursor },
      data: { ghost },
      ...geometry(ROUTE_W, GHOST_H),
    });
    anchors.push({
      id: `ghost-${ghost.key}`,
      y: cursor,
      edge: {
        label: 'removed',
        style: { stroke: '#fb7185', strokeWidth: 1.2, strokeDasharray: '4 3' },
        labelStyle: { fill: '#fb7185', fontSize: 9 },
      },
    });
    cursor += GHOST_H + ROW_GAP;
  }

  const block = Math.max(cursor - ROW_GAP - top, NAV_H);
  const navY = top + (block - NAV_H) / 2;
  const onFocusChain = isOnFocusChain(nav, session);

  ctx.nodes.push({
    id: nav.key,
    type: 'navigator',
    position: { x, y: navY },
    data: {
      state: nav,
      handled: session.last?.handledBy === nav.key,
      drawerOpen: nav.type === 'drawer' && isDrawerOpen(nav),
      onFocusChain,
    },
    ...geometry(NAV_W, NAV_H),
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

/** Lays a route and the navigator it renders out, returning its height. */
function layoutRoute(route: RouteState, nav: NavState, index: number, x: number, top: number, ctx: Ctx): number {
  const { session } = ctx;
  let height = ROUTE_H;
  let y = top;

  if (route.state) {
    const nestedHeight = layoutNavigator(route.state, x + ROUTE_W + COL_GAP, top, ctx);
    height = Math.max(ROUTE_H, nestedHeight);
    y = top + (height - ROUTE_H) / 2;

    const focused = session.focused.includes(route.key);
    ctx.edges.push({
      id: `${route.key}->${route.state.key}`,
      source: route.key,
      target: route.state.key,
      type: 'smoothstep',
      label: 'route.state',
      ...edgeTone(true, focused),
    });
  }

  ctx.nodes.push({
    id: route.key,
    type: 'route',
    position: { x, y },
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
    },
    ...geometry(ROUTE_W, ROUTE_H),
  });

  return height;
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
