# React Navigation Simulator & Live Stack Visualizer

An interactive model of the React Navigation router state machine, built to teach what
actually happens to `navigation.getState()` when you call `navigate`, `push`, `popTo`,
`replace` or `reset` — and how those mechanics changed between v6 and v7.

No React Native runtime is involved. The routers are pure TypeScript functions with the
same signature as the real ones (`(state, action) => state | null`), so the state objects
you see in the visualizer are the same shape you would log in a real app.

```bash
pnpm install
pnpm dev        # http://localhost:5183
pnpm build      # tsc -b && vite build
pnpm typecheck
```

## Layout

Four resizable columns:

| Column | Contents |
| --- | --- |
| 1 | Device canvas (header, tab bar, drawer) + guided scenarios |
| 2 | Explanation of the last dispatch, bubbling resolver, command control center |
| 3 | Live navigation state — annotated tree, or the raw `getState()` object as a collapsible JSON tree |
| 4 | Layout configuration (top) and the lifecycle console (bottom) |

Every action button carries a **lifecycle chip** predicting which hooks the dispatch would fire, so the difference
between `useEffect` and `useFocusEffect` is visible *before* you click:

| chip | meaning |
| --- | --- |
| `mount` | brings new components into the tree — `useEffect` setup runs |
| `unmount` | destroys components and their local state |
| `swap` | both in one dispatch (`replace`, `reset`) |
| `blur only` | nothing mounts or unmounts; only `useFocusEffect` fires |
| `no-op` | the state object changes without any hook firing |
| `blocked` | no navigator would handle it |

The clearest demonstration: in the Bottom Tabs layout, `jumpTo('Search')` reads **mount** the first time (tabs are lazy)
and **blur only** every time after, because a tab screen never unmounts once visited. Hovering any button lists the
exact screens involved.

Chips come from the same `computeAction` the real dispatch uses — the preview is a speculative run of the engine, not
a second set of rules — so a chip cannot promise something the button would not do.

Every code surface — the generated config, the nested payload preview, the call shapes and the dispatched calls in the
console — is highlighted with `prism-react-renderer`, themed from the same tokens as the rest of the app.

**Dispatch from** models `navigation.getParent()`. It changes where bubbling *starts*, so it rewrites both the call
(`navigation.getParent('tab-main').navigate('Checkout')`) and the verdict: from the focused screen that call is handled
right here by `stack-dashboard`, but dispatched from `tab-main` the very same call is unhandled, because `Checkout` is
now below you.

Drag any divider to resize, double-click one to restore just that pane, or use **Reset layout** for all of them.
Arrow keys work when a divider has focus. Sizes persist in `localStorage`, and the navigation-state column keeps a
280px floor so it can never be squeezed away. Below 1280px the columns stack and the dividers disappear.

## Source map

```
src/engine/
  types.ts              NavState / RouteState / NavAction — the real state shape
  blueprint.ts          App layout DSL, the five presets, key generation, lazy hydration
  routers.ts            stackRouter / tabRouter / drawerRouter (the mechanics live here)
  NavigatorEngine.ts    Action bubbling, mount analysis, lifecycle diffing, freezing
  nested.ts             Nested payloads: flatten, rebuild, address a screen, `initial`
  layouts.ts            Custom layouts: validation, import/export, persistence
  resolve.ts            "Can a bare navigate() reach this screen from here?"
  session.ts            Reducer tying it together: log, verdicts, ghosts, scenarios
  codegen.ts            Renders the current layout as v7 static config and v6 dynamic JSX
src/components/
  BubblePanel.tsx       Live bubbling trace + which call shape to use
  JsonTree.tsx          Raw getState() as a collapsible tree (react-json-view)
  CodeBlock.tsx         Prism highlighting, themed from the same tokens
  LayoutBuilder.tsx     Build/edit a navigator tree, import and export it
  AppSimulator.tsx      Layout, version/preset switches, scenario playback
  PhoneCanvas.tsx       Device frame; a pure view over the state object
  CommandCenter.tsx     Every action dispatched as a real action object
  VisualizerStack.tsx   Recursive navigator tree, badges, tooltips, animations
  EventLog.tsx          useEffect / useFocusEffect console
  CodePanel.tsx         Static vs dynamic config + the v6→v7 change list
  Scenarios.tsx         Scripted walkthroughs designed to be run on both versions
  Tooltip.tsx           Portal tooltip (the visualizer scrolls, so inline would clip)
```

## Mechanics the engine reproduces

- **Action bubbling.** An action starts at the navigator owning the focused screen and
  travels up until a router returns non-null. Routers that decline are shown in the
  `bubbled:` trail.
- **`push` never deduplicates.** Every push appends a new key, so two instances of the
  same screen can coexist with independent component state.
- **Unwinding preserves array position.** When a stack rolls back to an existing route it
  is `routes.slice(0, i + 1)` — the target keeps its key and its index. It is never lifted
  or swapped to the top.
- **Lazy tab mounting.** Tab and drawer navigators hold *every* declared screen in `routes`
  from the first frame, but a screen is not mounted until it is first focused — and then it
  stays mounted. Stack routes are mounted for as long as they are in the array.
- **Nested state is created on mount.** A route has no `state` property until the navigator
  it renders actually mounts, which is exactly why v6's nested `navigate` was unreliable.
- **Lifecycle ordering.** Mounts, then blurs, then focuses, then unmounts — the order the
  hooks fire in.
- **`setParams` is immutable.** A new route object and a new state object; the key is
  untouched, so nothing remounts.
- **v7 freezes the state tree** in development, as the real library does.

## Building your own layout

**Build layout** in the header opens the navigation builder, seeded from whatever preset is loaded. Add screens, pick
each navigator's type, `initialRouteName` and `backBehavior`, and reorder or remove routes. Custom layouts appear
under **My layouts** in the picker and run on exactly the same engine as the presets — bubbling, lazy mounting,
`initial`, and the v6/v7 differences all behave identically, because there is no separate authoring format: the
builder edits the same `NavigatorBlueprint` the engine executes and the codegen prints.

### Adding navigators

There are two ways to add one, and they produce the same tree:

- **`+ navigator`** in a navigator's header appends a new route *and* the navigator it renders, in one step.
- **`renders a navigator`** on a screen that has none attaches a navigator to that existing route.

Both ask which kind to add, because the choice is not cosmetic: a tab or drawer holds every one of its routes from
frame one and mounts them lazily on first focus, while a stack builds its history as you push.

This is the part of the mental model the builder is shaped around — **a navigator is never a child of a navigator.
It is the component of a screen:**

```tsx
const RootStack = createNativeStackNavigator({
  screens: {
    Tabs: TabsTabs,   // <- a navigator, rendered by the route named "Tabs"
    Menu: MenuDrawer,
    Details: DetailsScreen,
  },
});
```

So a root navigator holding several navigators is just a root whose routes happen to render them, and those route
names are exactly what a nested payload addresses: `navigate('Menu', { screen: 'MenuHome' })`. Nesting is capped at
6 levels, 16 navigators and 16 screens per navigator; the controls grey out at the same ceilings the validator
enforces, with the reason on hover.

### Import / export

Layouts export as a self-contained JSON file you can keep next to the proof of concept:

```json
{
  "format": "react-navigation-simulator/layout",
  "version": 1,
  "exportedAt": "...",
  "layout": { "id": "...", "label": "...", "blueprint": { ... } }
}
```

Import accepts that file, a bare `{ label, blueprint }`, or just a navigator blueprint — permissive about the wrapper,
strict about the shape. Everything from a file or from `localStorage` is treated as untrusted and fully validated
before it reaches the engine, with a reason per problem rather than a single failure:

```
root.screens[0].name must start with a letter and contain only letters, digits or underscores.
root declares "Ok" twice. routeNames must be unique within a navigator.
root.initialRouteName "Nope" is not one of its screens.
Duplicate navigator "stack-dup" at root.screens[1].nested. Every navigator needs its own id.
root.backBehavior only applies to tab and drawer navigators.
```

Navigator-id uniqueness matters more than it looks: navigator keys are derived as `${type}-${id}`, and the engine
assumes they are unique when it walks and replaces nodes in the tree. Depth, navigator count and screen count are
capped so a malformed file cannot wedge the app.

Custom layouts persist in `localStorage`. If storage is unavailable the layout still works for the session — it just
will not survive a reload.

## Nested navigation: which call shape?

The rule the whole thing hangs on, from the [navigate reference](https://reactnavigation.org/docs/navigation-object#navigate):
the name you pass must be **“a destination name of the screen in the current or a parent navigator”**. And from
[nesting navigators](https://reactnavigation.org/docs/nesting-navigators): *“Navigation actions first go to the current
navigator. If it can't handle them, they bubble up to the parent.”* Up only — never sideways, and since v7 never down.

But that is only half the story, because **each action bubbles by its own rules**. A router returns `null` for any
action it has no handler for — so `push` travels straight past a tab navigator to the nearest ancestor *stack*, while
`jumpTo` is invisible to a stack. Standing in the Dashboard stack with `Profile` selected:

| action | verdict |
| --- | --- |
| `navigate('Profile')` | handled 1 level up by `tab-main` |
| `jumpTo('Profile')` | handled 1 level up by `tab-main` |
| `push('Profile')` | **not handled** — `tab-main` declares `Profile` but a tab router has no `push` |

The **“Would this action be handled?”** panel answers this live. Pick the action and the target; it walks the focus
chain leaf → root, marks the router that consumes the action, and distinguishes four reasons a call fails:
*rejected outright* (`popTo` on v6), *reachable but not with this action*, *the target is below you*, and *the target is
in a sibling branch*.

Every verdict is a **speculative run of the real routers**, not a second copy of their rules — so the panel can never
claim something the engine would not actually do. (Route keys are snapshotted and restored around the dry run, so
predicting costs nothing.)

| Where the target is declared | Call to use |
| --- | --- |
| On the navigator owning the focused screen | `navigate('Details')` — handled immediately, no bubbling |
| On an ancestor navigator | `navigate('Settings')` — bubbles up N levels, still a bare call |
| **Below** you, in a child navigator | `navigate('Parent', { screen: 'Child' })` — up-only bubbling walks away from it |
| **Sideways**, in a sibling branch | `navigate('SiblingRoute', { screen: 'Child' })` — climb to the fork, then hand down |

The **Sibling stacks in Tabs** preset exists for that last row: two native stacks hanging off one tab navigator.
Standing on `Checkout` deep in the Dashboard stack, `navigate('Security')` cannot reach the Profile stack — the action
climbs to `tab-main` and stops, because bubbling gets you to the fork but cannot take the other prong. Naming
`Profile` works, because that first hop *is* reachable by bubbling, and `tab-main` then hands the rest down.

The recommended address is always the **shortest one that works**: it is anchored at the nearest navigator shared with
the focus chain, not at the root. From the Home stack in the three-level preset that means
`navigate('Account', { screen: 'EditProfile' })`, not the longer root-anchored form.

Deep nesting composes the same way, to any depth:

```js
navigation.navigate('Home', {
  screen: 'Settings',
  params: { screen: 'Sound', params: { screen: 'Media' } },
});
```

The simulator runs that as **four separate NAVIGATE actions**, one per level, each logged with the navigator that
handled it — which is exactly why this form works before the child navigator has mounted, while naming `Media`
directly does not.

### `initial`

*“By default, when you navigate a screen in the nested navigator, the specified screen is used as the initial screen
and the `initialRouteName` prop on the navigator is ignored.”* So the child is created holding **only** the target, and
there is nothing to go back to inside it. `initial: false` keeps the child's `initialRouteName` underneath, and
`goBack()` then lands inside the child. The flag sits next to the `screen` it qualifies, and only bites when that
navigator is **created** by this dispatch — navigating into an already-mounted child just pushes, as usual.

Run the `initial: true (default)` and `initial: false` scenarios back to back to see both.

## v6 vs v7

Flip the version switch and re-run any scenario. The differences the engine models:

| | v6 | v7 |
| --- | --- | --- |
| `navigate` to a screen already in the stack | Goes back to it, destroying everything above | Pushes a new instance. Opt back in with `{ pop: true }` or `navigateDeprecated` |
| Rolling back | No dedicated API | `popTo(name, params)` |
| Nested screens | `navigate('Child')` worked if the child navigator was mounted | Removed by default; use `navigate('Parent', { screen: 'Child' })`, or the `navigationInChildEnabled` prop |
| Declaring the graph | Dynamic JSX + hand-written param lists | Static config object; types and links derived from it |
| Blurring a nested stack | `unmountOnBlur` | `popToTopOnBlur` |
| Mutating state | Tolerated | Frozen in development |

## A note on the JSON tree dependency

The **JSON** tab renders `getState()` with **[`@microlink/react-json-view`](https://www.npmjs.com/package/@microlink/react-json-view)**,
not `react-json-view` itself. Same component, same props — but the original caps its `peerDependencies` at React 17 and
was last published in June 2022, so it cannot be used on this project's React 19. The fork is actively maintained
(`react >= 15`) and is the standard drop-in replacement. Swapping back is a one-line import change if that ever
becomes viable again.

Its base16 theme is wired to the same tokens as the rest of the app, and it is handed a structural clone of the state:
v7 deep-freezes the tree, and the viewer keeps internal copies of whatever it is given.

## Not simulated

Stated plainly so nothing here is mistaken for complete:

- **`getId`** — the documented third branch of `navigate` in a stack (“if another screen in the stack has the same ID,
  bring that screen to focus and update its params”). The navigate tooltip lists it; the engine does not implement it.
- **`preload`** — v7 can mount a screen without focusing it. The mount/focus split in the console would model this well.
- Screen `options`, headers beyond the title, gestures, animations, and deep linking.

Navigator keys here are readable (`stack-dashboard`) rather than random, and `getParent()` in the UI is keyed by those
navigator keys — the real `getParent(id)` takes a navigator `id` you set yourself via the `id` prop.

## Two deliberate deviations from the brief

Both are driven by the [v7 upgrade guide](https://reactnavigation.org/docs/upgrading-from-6.x),
and both are toggleable in the header so you can see either behaviour.

1. **`navigate` unwinding is v6, not v7.** The brief specifies that `navigate('Profile')`
   must drop every screen above an existing `Profile`. That is v6 behaviour. v7 explicitly
   removed it ("The `navigate` method no longer goes back, use `popTo` instead"), so the
   engine performs the unwind on the **v6** switch, and on v7 when you tick `pop: true` or
   call `navigateDeprecated`. On plain v7 `navigate`, it pushes a duplicate.

2. **`popTo` on a missing screen.** The brief asks for a simulation error. The documented
   v7 behaviour is to pop the current screen and add the target. The **strict popTo**
   toggle (on by default) raises the error as specified; turning it off runs the real
   router logic.
