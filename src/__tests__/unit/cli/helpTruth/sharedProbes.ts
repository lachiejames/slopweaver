/**
 * Probe bases and flag derivations more than one help-truth slice (or the sweep itself) reads, so each is
 * stated once.
 */

import { booleanFlagsOf, type FlagSpec, stringFlagsOf } from "../../../../cli/parseFlags.js";

/**
 * A `parseFlagTail` spec's flag TOKENS. The slack verbs all tokenise through one helper, so one projection
 * serves them rather than seven hand-written arrays that could each drift from the spec beside them.
 *
 * @returns every valued flag then every switch, each as its `--` token
 */
export function flagNamesOf({
  spec: { value, boolean: booleans = [] },
}: {
  spec: { readonly value: readonly string[]; readonly boolean?: readonly string[] };
}): readonly string[] {
  // A spec declaring no `boolean` list takes no switch, only valued flags.
  return [...value, ...booleans].map((name) => `--${name}`);
}

/**
 * A `parseFlags` spec's flag TOKENS, `--help` aside: every usage answers it and none advertises it.
 *
 * @returns every string flag then every boolean flag, each as its `--` token
 */
export function parseFlagsNamesOf({ spec }: { spec: FlagSpec }): readonly string[] {
  return [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })]
    .filter((name) => name !== "help")
    .map((name) => `--${name}`);
}

/** The home every slack probe resolves against — never touched, since a parse is pure. */
export const PROBE_HOME = "/tmp/slopweaver-probe-home";

/** A valid `talk transcript`: `--call` and `--entries-file` are required. */
export const TRANSCRIPT_BASE: readonly string[] = [
  "--call",
  "a0000041-0000-4000-8000-000000000044",
  "--entries-file",
  "/tmp/batch.jsonl",
];

/** The console-origin group a console server passes `talk transcript` and `talk relay`: all three or none. */
export const CONSOLE_ORIGIN: readonly string[] = [
  "--console-root",
  "/w/main",
  "--console-port",
  "3000",
  "--console-default-port",
  "3000",
];

/** A valid `slack post --as bot`: `--as`, `--channel` and `--form` are all required together. */
export const SLACK_BOT_POST_PROBE: readonly string[] = ["--as", "bot", "--channel", "D1", "--form", "-"];

/** A valid `slack reply --as me`: same parent, and NO `--shape` — the verb refuses one. */
export const SLACK_ME_REPLY_PROBE: readonly string[] = [
  "--as",
  "me",
  "--channel",
  "D1",
  "--thread-ts",
  "1712345678.000100",
  "--body",
  "-",
];

/**
 * `gmail mark` demands exactly one of `--read`/`--unread`, so probing any OTHER flag needs a direction
 * supplied — and probing either direction must NOT have one added, which would be a clash or a duplicate.
 *
 * @returns the fragment unchanged when it names a direction, else prefixed with `--read`
 */
export function markDirection({ fragment }: { fragment: readonly string[] }): readonly string[] {
  const carriesDirection = fragment.includes("--read") || fragment.includes("--unread");
  return carriesDirection ? [...fragment] : ["--read", ...fragment];
}

/**
 * A base invocation with every flag the fragment names removed, then the fragment appended.
 *
 * Needed wherever a base carries a required flag the fragment may also name: the shared parser refuses a
 * value flag passed twice, so a base `--form` plus a probed `--form` would report the repeat instead of what
 * the probe was testing. The `grant` verbs add pairs that exclude each other (`--change` beside
 * `--change-file`), mapped below.
 *
 * @param base a complete invocation of the verb
 * @param fragment the flag being probed, with its value
 * @returns the base minus what the fragment supersedes, plus the fragment
 */
export function dedupeFlags({
  base,
  fragment,
}: {
  base: readonly string[];
  fragment: readonly string[];
}): readonly string[] {
  const supersedes: ReadonlySet<string> = new Set(
    fragment.flatMap((token) => {
      if (!token.startsWith("--")) {
        return [];
      }
      if (token === "--change-file" || token === "--change") {
        return ["--change", "--change-file"];
      }
      if (token === "--target-system" || token === "--target-file") {
        return ["--target-file", "--target-system"];
      }
      if (token === "--wrote-file" || token === "--wrote") {
        return ["--wrote", "--wrote-file"];
      }
      // `store ingest` names what to read with exactly one of these and REFUSES both, and each mode's
      // resume flag is refused in the other — so probing any one of the four has to displace the base's
      // `--file` and never leave the other mode's resume flag behind it.
      if (token === "--source" || token === "--file" || token === "--from-file" || token === "--from") {
        return ["--file", "--source", "--from", "--from-file"];
      }
      return [token];
    }),
  );
  const kept: string[] = [];
  for (let index = 0; index < base.length; index += 1) {
    const token = base[index]!;
    if (token.startsWith("--") && supersedes.has(token)) {
      index += 1;
      continue;
    }
    kept.push(token);
  }
  return [...kept, ...fragment];
}
