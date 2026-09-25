import type { BackBehavior, NavigatorType, Params } from './types';
import { PRESETS, type NavigatorBlueprint, type Preset, type ScreenBlueprint } from './blueprint';

/**
 * Custom layouts.
 *
 * A `NavigatorBlueprint` is already a plain, serialisable tree, so it doubles
 * as the persistence and interchange format - the same shape the builder edits,
 * localStorage holds and the export file contains.
 *
 * Everything that comes back from storage or an import file is untrusted: it
 * may be hand-edited, from a different version, or simply wrong. It is fully
 * validated before it is allowed anywhere near the engine.
 */

export const LAYOUT_FORMAT = 'react-navigation-simulator/layout';
export const LAYOUT_VERSION = 1;

const STORAGE_KEY = 'rn-nav-sim:layouts';

/** Guard rails so a malformed or hostile file cannot wedge the app. */
export const LAYOUT_LIMITS = {
  maxDepth: 6,
  maxNavigators: 16,
  maxScreensPerNavigator: 16,
  maxLabel: 60,
  maxBlurb: 240,
} as const;

/** The builder greys out its controls at the same ceilings the validator enforces. */
const LIMITS = LAYOUT_LIMITS;

const NAV_TYPES: NavigatorType[] = ['stack', 'tab', 'drawer'];
const BACK_BEHAVIORS: BackBehavior[] = ['firstRoute', 'initialRoute', 'order', 'history', 'fullHistory', 'none'];

/** Screen names end up in generated code, so they must be identifier-safe. */
const SCREEN_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const NAV_ID = /^[a-z0-9][a-z0-9-]*$/i;

export interface CustomLayout {
  id: string;
  label: string;
  tagline: string;
  blueprint: NavigatorBlueprint;
  updatedAt: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

interface ValidationCtx {
  errors: string[];
  navIds: Set<string>;
  navCount: number;
}

function validateNavigator(value: unknown, path: string, depth: number, ctx: ValidationCtx): NavigatorBlueprint | null {
  if (!isPlainObject(value)) {
    ctx.errors.push(`${path} must be an object.`);
    return null;
  }
  if (depth > LIMITS.maxDepth) {
    ctx.errors.push(`${path} is nested deeper than ${LIMITS.maxDepth} levels.`);
    return null;
  }
  if (++ctx.navCount > LIMITS.maxNavigators) {
    ctx.errors.push(`A layout may not contain more than ${LIMITS.maxNavigators} navigators.`);
    return null;
  }

  const id = value.id;
  if (typeof id !== 'string' || !NAV_ID.test(id)) {
    ctx.errors.push(`${path}.id must be letters, digits or dashes (got ${JSON.stringify(id)}).`);
    return null;
  }

  const type = value.type;
  if (typeof type !== 'string' || !NAV_TYPES.includes(type as NavigatorType)) {
    ctx.errors.push(`${path}.type must be one of ${NAV_TYPES.join(', ')}.`);
    return null;
  }

  // Navigator keys are derived as `${type}-${id}`, and the engine assumes they
  // are unique when it walks and replaces nodes in the tree.
  const navKey = `${type}-${id}`;
  if (ctx.navIds.has(navKey)) {
    ctx.errors.push(`Duplicate navigator "${navKey}" at ${path}. Every navigator needs its own id.`);
    return null;
  }
  ctx.navIds.add(navKey);

  const rawScreens = value.screens;
  if (!Array.isArray(rawScreens) || rawScreens.length === 0) {
    ctx.errors.push(`${path}.screens must be a non-empty array.`);
    return null;
  }
  if (rawScreens.length > LIMITS.maxScreensPerNavigator) {
    ctx.errors.push(`${path}.screens has more than ${LIMITS.maxScreensPerNavigator} entries.`);
    return null;
  }

  const seen = new Set<string>();
  const screens: ScreenBlueprint[] = [];

  rawScreens.forEach((raw, i) => {
    const screen = validateScreen(raw, `${path}.screens[${i}]`, depth, ctx);
    if (!screen) return;
    if (seen.has(screen.name)) {
      ctx.errors.push(`${path} declares "${screen.name}" twice. routeNames must be unique within a navigator.`);
      return;
    }
    seen.add(screen.name);
    screens.push(screen);
  });

  if (!screens.length) return null;

  const out: NavigatorBlueprint = { id, type: type as NavigatorType, screens };

  if (value.initialRouteName !== undefined) {
    if (typeof value.initialRouteName !== 'string' || !seen.has(value.initialRouteName)) {
      ctx.errors.push(`${path}.initialRouteName "${String(value.initialRouteName)}" is not one of its screens.`);
    } else {
      out.initialRouteName = value.initialRouteName;
    }
  }

  if (value.backBehavior !== undefined) {
    if (typeof value.backBehavior !== 'string' || !BACK_BEHAVIORS.includes(value.backBehavior as BackBehavior)) {
      ctx.errors.push(`${path}.backBehavior must be one of ${BACK_BEHAVIORS.join(', ')}.`);
    } else if (type === 'stack') {
      ctx.errors.push(`${path}.backBehavior only applies to tab and drawer navigators.`);
    } else {
      out.backBehavior = value.backBehavior as BackBehavior;
    }
  }

  return out;
}

function validateScreen(value: unknown, path: string, depth: number, ctx: ValidationCtx): ScreenBlueprint | null {
  if (!isPlainObject(value)) {
    ctx.errors.push(`${path} must be an object.`);
    return null;
  }

  const name = value.name;
  if (typeof name !== 'string' || !SCREEN_NAME.test(name)) {
    ctx.errors.push(`${path}.name must start with a letter and contain only letters, digits or underscores.`);
    return null;
  }

  const screen: ScreenBlueprint = { name };

  const str = (key: 'icon' | 'title' | 'blurb', max: number) => {
    const raw = value[key];
    if (raw === undefined || raw === '') return;
    if (typeof raw !== 'string') {
      ctx.errors.push(`${path}.${key} must be a string.`);
      return;
    }
    screen[key] = raw.slice(0, max);
  };
  str('icon', 3);
  str('title', LIMITS.maxLabel);
  str('blurb', LIMITS.maxBlurb);

  if (value.initialParams !== undefined) {
    if (!isPlainObject(value.initialParams)) {
      ctx.errors.push(`${path}.initialParams must be a plain object.`);
    } else {
      screen.initialParams = value.initialParams as Params;
    }
  }

  if (value.nested !== undefined && value.nested !== null) {
    const nested = validateNavigator(value.nested, `${path}.nested`, depth + 1, ctx);
    if (nested) screen.nested = nested;
  }

  return screen;
}

export function validateBlueprint(value: unknown): Result<NavigatorBlueprint> {
  const ctx: ValidationCtx = { errors: [], navIds: new Set(), navCount: 0 };
  const blueprint = validateNavigator(value, 'root', 0, ctx);
  if (!blueprint || ctx.errors.length) {
    return { ok: false, errors: ctx.errors.length ? ctx.errors : ['The layout could not be read.'] };
  }
  return { ok: true, value: blueprint };
}

/* ------------------------------------------------------------------ */
/* Import / export                                                     */
/* ------------------------------------------------------------------ */

export interface LayoutFile {
  format: string;
  version: number;
  exportedAt: string;
  layout: { id: string; label: string; tagline: string; blueprint: NavigatorBlueprint };
}

export function exportLayout(preset: Preset | CustomLayout): string {
  const file: LayoutFile = {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    exportedAt: new Date().toISOString(),
    layout: {
      id: preset.id,
      label: preset.label,
      tagline: 'tagline' in preset ? preset.tagline : '',
      blueprint: preset.blueprint,
    },
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Accepts a full export file, a bare `{ label, blueprint }`, or just a
 * navigator blueprint - permissive about the wrapper, strict about the shape.
 */
export function importLayout(text: string): Result<CustomLayout> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`Not valid JSON: ${(error as Error).message}`] };
  }

  if (!isPlainObject(parsed)) return { ok: false, errors: ['Expected a JSON object.'] };

  if (typeof parsed.format === 'string' && parsed.format !== LAYOUT_FORMAT) {
    return { ok: false, errors: [`Unrecognised format "${parsed.format}". Expected "${LAYOUT_FORMAT}".`] };
  }
  if (typeof parsed.version === 'number' && parsed.version > LAYOUT_VERSION) {
    return {
      ok: false,
      errors: [`This file was written by a newer version of the simulator (v${parsed.version}).`],
    };
  }

  const holder = isPlainObject(parsed.layout) ? parsed.layout : parsed;
  const candidate = isPlainObject(holder.blueprint) ? holder.blueprint : holder;

  const result = validateBlueprint(candidate);
  if (!result.ok) return result;

  const rawLabel = typeof holder.label === 'string' ? holder.label.trim() : '';

  return {
    ok: true,
    value: {
      id: newLayoutId(),
      label: (rawLabel || `Imported ${result.value.type}`).slice(0, LIMITS.maxLabel),
      tagline: typeof holder.tagline === 'string' ? holder.tagline.slice(0, LIMITS.maxBlurb) : 'Imported layout.',
      blueprint: result.value,
      updatedAt: Date.now(),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

export const newLayoutId = () => `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;

export function loadLayouts(): CustomLayout[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return []; // private windows, blocked site data
  }
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): CustomLayout | null => {
        if (!isPlainObject(entry)) return null;
        const result = validateBlueprint(entry.blueprint);
        if (!result.ok) return null;
        return {
          id: typeof entry.id === 'string' ? entry.id : newLayoutId(),
          label: typeof entry.label === 'string' ? entry.label : 'Untitled layout',
          tagline: typeof entry.tagline === 'string' ? entry.tagline : '',
          blueprint: result.value,
          updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
        };
      })
      .filter((l): l is CustomLayout => l !== null);
  } catch {
    return [];
  }
}

export function saveLayouts(layouts: CustomLayout[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Presets <-> custom layouts                                          */
/* ------------------------------------------------------------------ */

const factoryFor = (bp: NavigatorBlueprint): string => {
  const names = new Set<string>();
  const walk = (nav: NavigatorBlueprint) => {
    names.add(
      nav.type === 'stack'
        ? 'createNativeStackNavigator'
        : nav.type === 'tab'
          ? 'createBottomTabNavigator'
          : 'createDrawerNavigator',
    );
    for (const screen of nav.screens) if (screen.nested) walk(screen.nested);
  };
  walk(bp);
  return [...names].join(' + ');
};

/** Custom layouts are presented to the rest of the app exactly like built-ins. */
export function asPreset(layout: CustomLayout): Preset {
  return {
    id: layout.id,
    label: layout.label,
    tagline: layout.tagline || 'Custom layout.',
    factory: factoryFor(layout.blueprint),
    blueprint: layout.blueprint,
  };
}

export const isCustomId = (id: string) => id.startsWith('custom-');

export function allLayouts(custom: CustomLayout[]): Preset[] {
  return [...PRESETS, ...custom.map(asPreset)];
}

export function resolveLayout(id: string, custom: CustomLayout[]): Preset {
  return allLayouts(custom).find((p) => p.id === id) ?? PRESETS[0];
}

/* ------------------------------------------------------------------ */
/* Authoring helpers                                                   */
/* ------------------------------------------------------------------ */

export function blankLayout(): CustomLayout {
  return {
    id: newLayoutId(),
    label: 'My layout',
    tagline: 'A layout I built.',
    blueprint: {
      id: 'root',
      type: 'stack',
      screens: [{ name: 'Home', icon: 'H' }, { name: 'Details', icon: 'D' }],
    },
    updatedAt: Date.now(),
  };
}

/** Start from a built-in preset, so you can tweak rather than begin cold. */
export function duplicateAsCustom(preset: Preset, label?: string): CustomLayout {
  return {
    id: newLayoutId(),
    label: (label ?? `${preset.label} copy`).slice(0, LIMITS.maxLabel),
    tagline: preset.tagline,
    blueprint: structuredClone(preset.blueprint),
    updatedAt: Date.now(),
  };
}

/** Every navigator id already used, so the builder can mint a fresh one. */
export function usedNavIds(bp: NavigatorBlueprint, out: Set<string> = new Set()): Set<string> {
  out.add(bp.id);
  for (const screen of bp.screens) if (screen.nested) usedNavIds(screen.nested, out);
  return out;
}

export function nextNavId(bp: NavigatorBlueprint, base: string): string {
  const used = usedNavIds(bp);
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
  return `${base}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
