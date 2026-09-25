import type { NavigatorBlueprint, ScreenBlueprint } from './blueprint';
import type { RNVersion } from './types';

/**
 * Renders the current layout as the code you would actually write, in both
 * styles: the v6 dynamic JSX tree and the v7 static configuration object.
 *
 * The static API is the headline architectural shift in v7: the navigation
 * graph becomes a plain, serialisable object declared in one place, which is
 * what lets v7 derive both the TypeScript types and the deep-linking config
 * automatically instead of making you maintain them by hand.
 */

const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const suffix = (t: NavigatorBlueprint['type']) => (t === 'stack' ? 'Stack' : t === 'tab' ? 'Tabs' : 'Drawer');

const factory = (t: NavigatorBlueprint['type']) =>
  t === 'stack' ? 'createNativeStackNavigator' : t === 'tab' ? 'createBottomTabNavigator' : 'createDrawerNavigator';

const pkg = (t: NavigatorBlueprint['type']) =>
  t === 'stack' ? '@react-navigation/native-stack' : t === 'tab' ? '@react-navigation/bottom-tabs' : '@react-navigation/drawer';

const compName = (bp: NavigatorBlueprint) => `${pascal(bp.id)}${suffix(bp.type)}`;

const screenComponent = (s: ScreenBlueprint) => `${s.name}Screen`;

function collect(bp: NavigatorBlueprint, out: NavigatorBlueprint[] = []): NavigatorBlueprint[] {
  for (const screen of bp.screens) if (screen.nested) collect(screen.nested, out);
  out.push(bp);
  return out;
}

function imports(bp: NavigatorBlueprint, version: RNVersion) {
  const types = [...new Set(collect(bp).map((n) => n.type))];
  const lines = types.map((t) => `import { ${factory(t)} } from '${pkg(t)}';`);
  lines.unshift(
    version === 'v7'
      ? `import { createStaticNavigation } from '@react-navigation/native';`
      : `import { NavigationContainer } from '@react-navigation/native';`,
  );
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* v7 static API                                                       */
/* ------------------------------------------------------------------ */

export function generateStatic(bp: NavigatorBlueprint): string {
  const blocks = collect(bp).map((nav) => {
    const entries = nav.screens.map((s) => {
      const target = s.nested ? compName(s.nested) : screenComponent(s);
      const options: string[] = [];
      if (s.title && s.title !== s.name) options.push(`title: '${s.title}'`);
      const extras: string[] = [];
      if (s.initialParams) extras.push(`initialParams: ${JSON.stringify(s.initialParams)}`);
      if (options.length) extras.push(`options: { ${options.join(', ')} }`);

      if (!extras.length) return `    ${s.name}: ${target},`;
      return `    ${s.name}: {\n      screen: ${target},\n${extras.map((e) => `      ${e},`).join('\n')}\n    },`;
    });

    const config = [
      nav.initialRouteName ? `  initialRouteName: '${nav.initialRouteName}',` : null,
      '  screens: {',
      ...entries,
      '  },',
    ]
      .filter(Boolean)
      .join('\n');

    return `const ${compName(nav)} = ${factory(nav.type)}({\n${config}\n});`;
  });

  return [
    imports(bp, 'v7'),
    '',
    ...blocks,
    '',
    `const Navigation = createStaticNavigation(${compName(bp)});`,
    '',
    'export default function App() {',
    '  return <Navigation />;',
    '}',
    '',
    '// Types come for free from the config object itself:',
    `type RootParamList = StaticParamList<typeof ${compName(bp)}>;`,
    '',
    'declare global {',
    '  namespace ReactNavigation {',
    '    interface RootParamList extends RootParamList {}',
    '  }',
    '}',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* v6 dynamic API                                                      */
/* ------------------------------------------------------------------ */

export function generateDynamic(bp: NavigatorBlueprint): string {
  const blocks = collect(bp).map((nav) => {
    const varName = `${pascal(nav.id)}${suffix(nav.type)}Nav`;
    const screens = nav.screens.map((s) => {
      const target = s.nested ? compName(s.nested) : screenComponent(s);
      const props = [`name="${s.name}"`, `component={${target}}`];
      if (s.initialParams) props.push(`initialParams={${JSON.stringify(s.initialParams)}}`);
      if (s.title && s.title !== s.name) props.push(`options={{ title: '${s.title}' }}`);
      return `      <${varName}.Screen ${props.join(' ')} />`;
    });

    const navProps = nav.initialRouteName ? ` initialRouteName="${nav.initialRouteName}"` : '';

    return [
      `const ${varName} = ${factory(nav.type)}();`,
      '',
      `function ${compName(nav)}() {`,
      '  return (',
      `    <${varName}.Navigator${navProps}>`,
      ...screens,
      `    </${varName}.Navigator>`,
      '  );',
      '}',
    ].join('\n');
  });

  return [
    imports(bp, 'v6'),
    '',
    ...blocks.join('\n\n').split('\n'),
    '',
    'export default function App() {',
    '  return (',
    '    <NavigationContainer>',
    `      <${compName(bp)} />`,
    '    </NavigationContainer>',
    '  );',
    '}',
    '',
    '// Param lists must be written and maintained by hand:',
    'type RootParamList = {',
    ...bp.screens.map((s) => `  ${s.name}: undefined;`),
    '};',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Narrative comparison                                                */
/* ------------------------------------------------------------------ */

export interface VersionFact {
  title: string;
  v6: string;
  v7: string;
}

export const VERSION_FACTS: VersionFact[] = [
  {
    title: 'navigate() to a screen already in the stack',
    v6: 'Goes back to it: every screen above is destroyed and index moves down.',
    v7: 'No longer goes back - it pushes a new instance. Use popTo(), or navigate(name, params, { pop: true }).',
  },
  {
    title: 'Rolling back to an earlier screen',
    v6: 'No dedicated API. You leaned on navigate() and its implicit unwinding.',
    v7: 'popTo(name, params) states the intent at the call site. Absent from the stack, it pops the current screen and adds the target.',
  },
  {
    title: 'Reaching a screen in a nested navigator',
    v6: 'navigate("ChildScreen") could work - but only if the child navigator was already mounted.',
    v7: 'Removed by default. Address the parent: navigate("Parent", { screen: "Child" }). Opt back in with navigationInChildEnabled.',
  },
  {
    title: 'Declaring the navigation graph',
    v6: 'Dynamic JSX: <Stack.Navigator><Stack.Screen /></Stack.Navigator>, with hand-written param lists.',
    v7: 'Static config: createNativeStackNavigator({ screens: {...} }) + createStaticNavigation(). Types and links are derived from it.',
  },
  {
    title: 'navigate() with a route key',
    v6: 'navigate({ key: "someuniquekey" }) was supported.',
    v7: 'The key option is removed - keys are internal. Use getId() when you need instance identity.',
  },
  {
    title: 'Dropping a nested stack when a tab blurs',
    v6: 'unmountOnBlur destroyed the whole subtree, losing local state and remounting slowly.',
    v7: 'unmountOnBlur is replaced by popToTopOnBlur, which resets the nested stack without unmounting it.',
  },
  {
    title: 'Mutating the state object',
    v6: 'Silently tolerated, with confusing downstream bugs.',
    v7: 'The state tree is frozen in development, so a direct write throws immediately.',
  },
  {
    title: 'Blocking a screen from being removed',
    v6: 'The beforeRemove event, which never worked properly with the native stack.',
    v7: 'The usePreventRemove hook, which does.',
  },
];
