/**
 * The CLOSED set of click-throughs `browser console-shot` can photograph. A walk is a name a caller picks, the path it
 * opens, the selectors whose union is cut, and the selectors it waits to see before the shutter. The clicks themselves
 * live in the capture spec beside the fixtures they run over (`src/__tests__/e2e/capture/consoleWalks.capture.ts`),
 * which refuses a walk named here with no steps there, and steps there with no row here.
 *
 * Closed rather than a script a caller passes, because the console is served over a throwaway home seeded with the
 * synthetic organisation, and a free-form script is a second browser door. A new walk is a reviewed row and its steps.
 *
 * Pure data, no imports, so the CLI's parser and the spec can both read it.
 */

/** One registered click-through. */
export interface ConsoleWalk {
  /** The name `--walk` takes. */
  readonly name: string;
  /** One line saying what the click-through proves, for `--help` and the receipt's reader. */
  readonly summary: string;
  /** The path the walk opens, query included. */
  readonly initialPath: string;
  /** The selectors whose union is cut; the union must be smaller than the viewport. */
  readonly region: readonly string[];
  /** The selectors the walk waits to see, each visible, before the shutter fires. */
  readonly witnesses: readonly string[];
}

/** Every walk `browser console-shot --walk` accepts. */
export const CONSOLE_WALKS: readonly ConsoleWalk[] = [
  {
    initialPath: "/automations?context=work",
    name: "automations-context",
    region: ["main"],
    summary: "the Automations page after its context is switched from Work to Slopweaver in the context switcher",
    witnesses: ['[data-context="slopweaver"]', "main"],
  },
];

/**
 * The walk registered under a name, or `undefined` when none is.
 *
 * @param name the name `--walk` was given
 * @returns the walk
 */
export function consoleWalkNamed({ name }: { name: string }): ConsoleWalk | undefined {
  return CONSOLE_WALKS.find((walk) => walk.name === name);
}
