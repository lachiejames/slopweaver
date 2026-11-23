/**
 * The help-truth tables' rows for `browser` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 *
 * Every `browser` verb shares ONE flag spec (`BROWSER_FLAG_NAMES`) and ONE parser, so its twenty probe tables
 * would be twenty hand-typed copies of the same thirty-four rows, differing only in the argv each verb needs before
 * a flag of its own. They are derived here from that base and one value per flag, with the handful of rows that
 * genuinely differ named as exceptions rather than hidden in a copy.
 */

import { browserVerbErrorLines } from "../../../../cli/commands/browser/errors.js";
import { BROWSER_FLAG_NAMES, parseBrowserArgs } from "../../../../cli/commands/browser/profileCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/** The argv each verb needs before any flag of its own, so a probe exercises the flag rather than a refusal. */
const BASES = {
  act: ["--session", "s-1", "--do", "click"],
  aim: ["--session", "s-1"],
  annotate: ["--form", "/tmp/f.json"],
  "break-glass": ["--reason", "why"],
  close: ["--session", "s-1"],
  "console-shot": ["--walk", "automations-context", "--out", "/tmp/a.png"],
  cookies: ["--origin", "https://github.com"],
  "image-record": ["--form", "/tmp/f.json"],
  inspect: ["--url", "https://example.com/"],
  open: ["--url", "https://example.com/"],
  pin: [],
  present: ["--url", "https://example.com/"],
  profile: [],
  read: ["--session", "s-1"],
  redact: ["--form", "/tmp/f.json"],
  scroll: ["--session", "s-1"],
  sessions: [],
  shot: ["--url", "https://example.com/", "--out", "/tmp/a.png"],
  "sign-in": [],
  "terminal-shot": ["--form", "/tmp/f.json"],
  verdicts: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;

type BrowserVerb = keyof typeof BASES;

/** A valid value for each flag of the shared spec; a switch takes none. */
const FLAG_VALUES: Readonly<Record<string, readonly string[]>> = {
  "--blocked": [],
  "--caption": ["the claim"],
  "--destination": ["datadog"],
  "--do": ["click"],
  "--download-dir": ["/tmp"],
  "--expect-focus": ["e1"],
  "--expect-name": ["a.txt"],
  "--find": ["text"],
  "--focus": [],
  "--form": ["/tmp/f.json"],
  "--full-page": [],
  "--home": ["/tmp"],
  "--json": [],
  "--limit": ["20"],
  "--list": [],
  "--no-focus": [],
  "--observation": ["obs-1"],
  "--org": ["acme"],
  "--origin": ["https://github.com"],
  "--out": ["/tmp/a.png"],
  "--page": ["https://example.com/"],
  "--pages": ["2"],
  "--provider": ["github"],
  "--raw": [],
  "--readiness-timeout": ["5000"],
  "--reason": ["why"],
  "--session": ["s-1"],
  "--set": ["Default"],
  "--settle": ["2000"],
  "--target": ["f1e4"],
  "--under": ["e1"],
  "--up": [],
  "--url": ["https://example.com/"],
  "--value": ["text"],
  "--walk": ["automations-context"],
};

/** The verbs whose `--target` probe names a dashboard widget rather than a page element. */
const WIDGET_TARGET_VERBS: ReadonlySet<BrowserVerb> = new Set([
  "annotate",
  "break-glass",
  "console-shot",
  "cookies",
  "image-record",
  "pin",
  "profile",
  "redact",
  "shot",
  "sign-in",
  "terminal-shot",
  "verdicts",
]);

/** Flags a verb's probe states WITHOUT its base, each as the verbs it applies to. */
const UNBASED_FLAGS: Readonly<Record<string, readonly BrowserVerb[]>> = {
  "--destination": ["present"],
  "--find": ["present"],
  "--form": ["break-glass"],
  "--org": ["present"],
  "--provider": ["present"],
  "--under": ["present"],
};

/** One verb's probe table: each flag appended to the verb's base, or the base itself for a flag it already names. */
function probesFor({ verb }: { verb: BrowserVerb }): Readonly<Record<string, readonly string[]>> {
  const base: readonly string[] = BASES[verb];
  const named = new Set(base.filter((token) => token.startsWith("--")));
  return Object.fromEntries(
    Object.entries(FLAG_VALUES).map(([flag, value]) => {
      if (named.has(flag)) {
        return [flag, [...base]];
      }
      const stated = flag === "--target" && WIDGET_TARGET_VERBS.has(verb) ? ["datadog-logs-v1:timeseries"] : value;
      const unbased = UNBASED_FLAGS[flag]?.includes(verb) === true;
      return [flag, unbased ? [flag, ...stated] : [...base, flag, ...stated]];
    }),
  );
}

/** Whether a key of `BASES` names a browser verb, so the key list narrows without an assertion. */
function isBrowserVerb(key: string): key is BrowserVerb {
  return Object.hasOwn(BASES, key);
}

const VERBS: readonly BrowserVerb[] = Object.keys(BASES).filter(isBrowserVerb);

/** The rows for `browser`. */
export const browserSlice: HelpTruthSlice = {
  guarded: Object.fromEntries(VERBS.map((verb) => [`browser ${verb}`, BROWSER_FLAG_NAMES])),
  parsers: Object.fromEntries(
    VERBS.map((verb) => [
      `browser ${verb}`,
      ({ fragment }: { fragment: readonly string[] }) =>
        parseBrowserArgs({ rest: [verb, ...fragment] }).mapErr((error) => browserVerbErrorLines({ error })),
    ]),
  ),
  probes: Object.fromEntries(VERBS.map((verb) => [`browser ${verb}`, probesFor({ verb })])),
};
