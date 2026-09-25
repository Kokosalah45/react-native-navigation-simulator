import type { NavAction } from '../engine/types';
import { Tooltip } from './Tooltip';

export interface Scenario {
  id: string;
  title: string;
  presetId: string;
  question: string;
  steps: NavAction[];
}

/**
 * Scripted walkthroughs. Each one is designed to be run twice - once on v6,
 * once on v7 - so the difference is something you watch happen rather than
 * something you read about.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'navigate-vs-push',
    title: 'navigate() to a screen already in the stack',
    presetId: 'native-stack',
    question: 'Does the stack unwind back to Feed, or gain a second Feed on top?',
    steps: [
      { type: 'PUSH', payload: { name: 'Feed' } },
      { type: 'PUSH', payload: { name: 'Profile' } },
      { type: 'PUSH', payload: { name: 'Settings' } },
      { type: 'NAVIGATE', payload: { name: 'Feed' } },
    ],
  },
  {
    id: 'push-duplicates',
    title: 'push() never deduplicates',
    presetId: 'native-stack',
    question: 'Three pushes of the same screen: three keys, three component instances.',
    steps: [
      { type: 'PUSH', payload: { name: 'Profile' } },
      { type: 'PUSH', payload: { name: 'Profile' } },
      { type: 'PUSH', payload: { name: 'Profile' } },
    ],
  },
  {
    id: 'pop-to',
    title: 'popTo() rolls back explicitly',
    presetId: 'native-stack',
    question: 'The v7 answer to unwinding - and it fails loudly if the target was never there.',
    steps: [
      { type: 'PUSH', payload: { name: 'Feed' } },
      { type: 'PUSH', payload: { name: 'Profile' } },
      { type: 'PUSH', payload: { name: 'Settings' } },
      { type: 'POP_TO', payload: { name: 'Feed' } },
      { type: 'POP_TO', payload: { name: 'Details' } },
    ],
  },
  {
    id: 'tabs-stay-mounted',
    title: 'Tab screens mount once and stay',
    presetId: 'bottom-tabs',
    question: 'Watch the console: each tab mounts on first visit and never unmounts after.',
    steps: [
      { type: 'JUMP_TO', payload: { name: 'Search' } },
      { type: 'JUMP_TO', payload: { name: 'Notifications' } },
      { type: 'JUMP_TO', payload: { name: 'Home' } },
      { type: 'JUMP_TO', payload: { name: 'Search' } },
    ],
  },
  {
    id: 'nested-navigate',
    title: 'Reaching a screen in a nested navigator',
    presetId: 'nested',
    question: 'From the Feed tab, can navigate() find ProductDetails inside the Dashboard stack?',
    steps: [
      { type: 'NAVIGATE', payload: { name: 'ProductDetails' } },
      { type: 'NAVIGATE', payload: { name: 'Dashboard', params: { screen: 'ProductDetails' } } },
    ],
  },
  {
    id: 'sibling-branches',
    title: 'Sibling branches cannot see each other',
    presetId: 'nested',
    question:
      'Deep inside the Dashboard stack, reach Security in the Profile stack. The bare call fails; naming the sibling route works.',
    steps: [
      { type: 'NAVIGATE', payload: { name: 'Dashboard', params: { screen: 'ProductDetails' } } },
      { type: 'PUSH', payload: { name: 'Checkout' } },
      // Sideways: stack-profile is neither above nor below stack-dashboard.
      { type: 'NAVIGATE', payload: { name: 'Security' } },
      // Up to tab-main, which declares Profile, then back down into its stack.
      { type: 'NAVIGATE', payload: { name: 'Profile', params: { screen: 'Security' } } },
    ],
  },
  {
    id: 'deep-nested',
    title: 'Three navigators deep in one dispatch',
    presetId: 'full-app',
    question: 'Drawer → Tabs → Stack. Each level of the payload is handled by a different navigator.',
    steps: [
      { type: 'NAVIGATE', payload: { name: 'Billing' } },
      {
        type: 'NAVIGATE',
        payload: { name: 'App', params: { screen: 'Account', params: { screen: 'EditProfile' } } },
      },
    ],
  },
  {
    id: 'nested-initial-true',
    title: 'Nested payload, initial: true (default)',
    presetId: 'full-app',
    question: 'EditProfile becomes the child stack’s only route — so goBack() leaves the tab entirely.',
    steps: [
      { type: 'NAVIGATE', payload: { name: 'App', params: { screen: 'Account', params: { screen: 'EditProfile' } } } },
      { type: 'GO_BACK' },
    ],
  },
  {
    id: 'nested-initial-false',
    title: 'The same call with initial: false',
    presetId: 'full-app',
    question: 'AccountHome is kept underneath, so goBack() stays inside the child stack. Run it straight after the one above.',
    steps: [
      {
        // `initial` sits next to the `screen` it qualifies, so it belongs on the
        // innermost level here: it governs the navigator that contains
        // EditProfile (stack-account), not the one that contains Account.
        type: 'NAVIGATE',
        payload: { name: 'App', params: { screen: 'Account', params: { screen: 'EditProfile', initial: false } } },
      },
      { type: 'GO_BACK' },
    ],
  },
  {
    id: 'replace',
    title: 'replace() swaps the instance',
    presetId: 'native-stack',
    question: 'Same depth, different key - so the old screen is gone for good.',
    steps: [
      { type: 'PUSH', payload: { name: 'Feed' } },
      { type: 'PUSH', payload: { name: 'Details' } },
      { type: 'REPLACE', payload: { name: 'Profile' } },
      { type: 'GO_BACK' },
    ],
  },
  {
    id: 'params',
    title: 'setParams() is immutable',
    presetId: 'native-stack',
    question: 'Params change, the key does not - so nothing remounts.',
    steps: [
      { type: 'PUSH', payload: { name: 'Details', params: { id: 42 } } },
      { type: 'SET_PARAMS', payload: { params: { highlighted: true } } },
      { type: 'SET_PARAMS', payload: { params: { id: 99 } } },
    ],
  },
  {
    id: 'reset',
    title: 'reset() fabricates a history',
    presetId: 'native-stack',
    question: 'A back stack the user never navigated through - every key is brand new.',
    steps: [
      { type: 'PUSH', payload: { name: 'Feed' } },
      { type: 'RESET', payload: { index: 2, routes: [{ name: 'Home' }, { name: 'Profile' }, { name: 'Settings' }] } },
    ],
  },
];

interface Props {
  activeId: string | null;
  stepIndex: number;
  onRun: (scenario: Scenario) => void;
  onStop: () => void;
}

export function Scenarios({ activeId, stepIndex, onRun, onStop }: Props) {
  return (
    <div className="space-y-1.5">
      {SCENARIOS.map((scenario) => {
        const active = activeId === scenario.id;
        return (
          <Tooltip
            key={scenario.id}
            wide
            className="block"
            label={
              <span>
                {scenario.question}
                <br />
                <span className="text-ink-300">
                  Loads the "{scenario.presetId}" layout, then dispatches {scenario.steps.length} actions. Run it once on v6 and once
                  on v7.
                </span>
              </span>
            }
          >
            <button
              onClick={() => (active ? onStop() : onRun(scenario))}
              className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                active ? 'border-focus-400/60 bg-focus-400/10' : 'border-ink-700 bg-ink-850 hover:border-ink-500 hover:bg-ink-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-[11.5px] font-medium ${active ? 'text-focus-400' : 'text-ink-200'}`}>{scenario.title}</span>
                <span className="mono ml-auto shrink-0 text-[9.5px] text-ink-300">
                  {active ? `${stepIndex}/${scenario.steps.length}` : `${scenario.steps.length} steps`}
                </span>
              </div>
              {active && (
                <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded bg-ink-700">
                  <div
                    className="h-full bg-focus-400 transition-[width] duration-300"
                    style={{ width: `${(stepIndex / scenario.steps.length) * 100}%` }}
                  />
                </div>
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
