/**
 * Every `plans` verb's FLAG SPEC and the usage line derived from it — and nothing else.
 *
 * A LEAF on purpose. `cli/manifests/plans.ts` names these usage lines, and a manifest is enumerated by
 * `--help`, `catalog` and `discoverCommands` on invocations that dispatch none of these verbs, so a manifest
 * importing `core.ts` would drag the register's types and the flag parser onto every unrelated command's
 * load path. That is the eager-import leak `.claude/rules/area-cli.md` § "Metadata is eager, the run function
 * is lazy" names, closed for this family rather than described. Its one import is a TYPE, which erases.
 *
 * The specs live here rather than beside the parsers for the same reason a usage line is derived rather than
 * written: `parsePlansArgs` reads {@link PLANS_SPECS}, `plansUsage` renders it, and the help-truth ratchet
 * reads {@link PLANS_FLAG_NAMES} off it — so a flag added in one place cannot go unadvertised in another.
 *
 * Keep it importing nothing else. A helper that needs the register belongs in `core.ts`.
 */
import type { FlagSpec } from "../../parseFlags.js";

/** Flags each `plans` verb accepts. The ONE declaration — parser, usage line and ratchet all read it. */
export const PLANS_SPECS: Readonly<Record<string, FlagSpec>> = {
  adopt: { boolean: ["json"], string: ["home"] },
  add: { boolean: ["json", "pinned"], string: ["email", "home", "percent", "plan", "provider", "store-dir"] },
  lapse: { boolean: ["json"], string: ["home", "on", "plan", "provider"] },
  list: { boolean: ["json"], string: ["home", "provider"] },
  pause: { boolean: ["json"], string: ["home", "plan", "provider", "reason"] },
  pin: { boolean: ["json"], string: ["home", "plan", "provider"] },
  "clear-lapse": { boolean: ["json"], string: ["home", "plan", "provider"] },
  connect: { boolean: ["json"], string: ["home", "provider"] },
  "connect-cancel": { boolean: ["json"], string: ["home", "id"] },
  "connect-worker": { string: ["home", "id"] },
  connections: { boolean: ["json"], string: ["home"] },
  remove: { boolean: ["json"], string: ["home", "plan", "provider"] },
  resume: { boolean: ["json"], string: ["home", "plan", "provider"] },
  "set-email": { boolean: ["json"], string: ["email", "home", "plan", "provider"] },
  "set-store-dir": { boolean: ["json"], string: ["home", "plan", "provider", "store-dir"] },
  unpin: { boolean: ["json"], string: ["home", "plan", "provider"] },
  "set-thresholds": {
    boolean: ["json"],
    repeatable: ["reset"],
    string: [
      "acceptance-at-percent",
      "alert-at-percent",
      "balanced-spread-percent",
      "drifting-spread-percent",
      "home",
      "pause-at-percent",
      "provider",
      "reset",
      "route-at-percent",
      "spend-out-at-percent",
      "spend-out-before-reset-minutes",
    ],
  },
  "set-usage-limit": { boolean: ["json"], string: ["allowance", "from", "home", "percent", "plan", "provider"] },
  "sync-accounts": { boolean: ["json"], string: ["home"] },
  usage: { boolean: ["json"], string: ["home"] },
  validate: { boolean: ["json", "repair-projection"], string: ["home"] },
};

/** Every flag one spec declares, `--`-prefixed and sorted. An omitted half is an EMPTY half, said so. */
function flagNamesOf({ boolean = [], string = [] }: FlagSpec): readonly string[] {
  return [...string, ...boolean].map((name) => `--${name}`).toSorted();
}

/** `--`-prefixed flag names per verb, for the help-truth ratchet. */
export const PLANS_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(PLANS_SPECS).map(([verb, spec]) => [verb, flagNamesOf(spec)]),
);

/** The flags that take a value, so a usage line renders `[--x <value>]` for exactly those. */
const WITH_VALUE: ReadonlySet<string> = new Set([
  "--acceptance-at-percent",
  "--alert-at-percent",
  "--allowance",
  "--balanced-spread-percent",
  "--drifting-spread-percent",
  "--email",
  "--from",
  "--home",
  "--id",
  "--on",
  "--pause-at-percent",
  "--percent",
  "--plan",
  "--provider",
  "--reason",
  "--reset",
  "--route-at-percent",
  "--spend-out-at-percent",
  "--spend-out-before-reset-minutes",
  "--store-dir",
]);

/**
 * The usage line for one verb, built from its REAL flag spec so the two cannot disagree.
 *
 * @param verb the verb name
 * @returns the single-line usage string
 */
export function plansUsage({ verb }: { verb: string }): string {
  const flags = PLANS_FLAG_NAMES[verb];
  if (flags === undefined) {
    return `usage: slopweaver plans ${verb}`;
  }
  const rendered = flags.map((flag) => (WITH_VALUE.has(flag) ? `[${flag} <value>]` : `[${flag}]`)).join(" ");
  return `usage: slopweaver plans ${verb} ${rendered}`.replace(/\s+/g, " ").trim();
}
