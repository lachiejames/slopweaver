/**
 * Flag specs, usage strings and parsers for the verbs that EDIT a briefing scratch file in place —
 * `sweep-block`, `fold-caps` and `recut` on the form, `card` on the open-pages document — which replace the supervisor chair's Python scratch scripts.
 *
 * A sibling of `./core.ts` rather than more of it, so the render and archive parsers stay readable; the
 * help-truth ratchet reads the exported flag names from here exactly as it reads `core.ts`'s.
 *
 * ## Repeatable flags are read off the RAW argv first
 *
 * `--fold`, `--alignment-detail` and `--drop-card-prefix` may be given more than once. `collectRepeated`
 * silently skips an occurrence with no value, and `withoutRepeated` then strips it, so an invocation ending in
 * `--fold` or reading `--fold --dry-run` would quietly lose a fold. So every occurrence is counted before
 * either helper runs, and one without a usable value is refused by name.
 */
import { err, ok, type Result } from "#lib/result.js";

import { PAGE_UNFOLDED_BLOCKS_MAX } from "../../../briefing/caps.js";
import { headlineSentenceIssues } from "../../../briefing/headlineSentences.js";
import type { SweepBlockInput } from "../../../briefing/sweepBlock.js";
import { collectRepeated, withoutRepeated } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/**
 * How many recent blocks stay open when `--keep-recent` is not given.
 *
 * Four, and it is a POLICY rather than a cap: the schema admits `PAGE_UNFOLDED_BLOCKS_MAX` (five). Every tick
 * script ten chairs in a row ran rolled at four — reproduce with
 * `grep -l 'len(d\["recent"\]) > 4' ~/.slopweaver/supervisor-scratch/handoff-*\/tick*.py | wc -l`.
 */
const DEFAULT_KEEP_RECENT = 4;

/** `sweep-block`'s single-value and boolean flags. */
const SWEEP_BLOCK_FLAGS: FlagSpec = {
  boolean: ["dry-run"],
  string: [
    "form",
    "workspace",
    "handoff",
    "model",
    "pinned-at",
    "sleeping",
    "lede",
    "alignment",
    "alignment-summary",
    "intake",
    "fold-summary",
    "keep-recent",
    "earlier-summary",
  ],
};

/** `sweep-block`'s repeatable flags, each read off the raw argv before the scalar parser sees it. */
const SWEEP_BLOCK_REPEATED: readonly string[] = ["alignment-detail", "fold", "drop-card-prefix", "headline-sentence"];

/**
 * Every accepted `sweep-block` flag, WITH the `--`, for the help-truth ratchet.
 *
 * @internal — the ratchet's own input; nothing else names it.
 */
export const BRIEFING_SWEEP_BLOCK_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: SWEEP_BLOCK_FLAGS }),
  ...booleanFlagsOf({ spec: SWEEP_BLOCK_FLAGS }),
  ...SWEEP_BLOCK_REPEATED,
].map((name) => `--${name}`);

/**
 * A parsed `briefing sweep-block` invocation.
 *
 * @internal — the shape {@link parseBriefingSweepBlockArgs} returns and `./sweepBlockRun.ts` reads.
 */
export interface BriefingSweepBlockArgs {
  /** The form file, rewritten in place. */
  readonly formPath: string;
  /** Validate and report, write nothing. */
  readonly dryRun: boolean;
  /** The sweep's edit, ready for the pure core. */
  readonly input: SweepBlockInput;
}

/** `fold-caps`'s flags. */
const FOLD_CAPS_FLAGS: FlagSpec = { boolean: ["dry-run"], string: ["form"] };

/**
 * Every accepted `fold-caps` flag, WITH the `--`, for the help-truth ratchet.
 *
 * @internal — the ratchet's own input; nothing else names it.
 */
export const BRIEFING_FOLD_CAPS_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: FOLD_CAPS_FLAGS }),
  ...booleanFlagsOf({ spec: FOLD_CAPS_FLAGS }),
].map((name) => `--${name}`);

/** `card`'s flags. */
const CARD_FLAGS = {
  boolean: ["replace", "dry-run", "json"],
  string: ["open-pages", "row", "drop", "settled-by", "home"],
} as const satisfies FlagSpec;

/**
 * Every accepted `card` flag, WITH the `--`, for the help-truth ratchet.
 *
 * @internal — the ratchet's own input; nothing else names it.
 */
export const BRIEFING_CARD_FLAG_NAMES: readonly string[] = [...CARD_FLAGS.string, ...CARD_FLAGS.boolean].map(
  (name) => `--${name}`,
);

/** What every `briefing card` invocation carries, whichever arm it takes. */
interface BriefingCardCommonArgs {
  /** The open-pages document, rewritten in place. */
  readonly openPagesPath: string;
  /** Validate and report, write nothing. */
  readonly dryRun: boolean;
  /** One JSON object on stdout instead of lines. */
  readonly json: boolean;
  /** The state home, when given; the caller resolves the ambient one otherwise. */
  readonly home: string | undefined;
}

/**
 * A parsed `briefing card --row` invocation: place one row.
 *
 * @internal — the arm `./cardRun.ts` places.
 */
export interface BriefingCardPlaceArgs extends BriefingCardCommonArgs {
  readonly mode: "place";
  /** The row: a path, or `-` for stdin. */
  readonly rowSource: string;
  /** Swap in for the row already naming the url rather than refusing. */
  readonly replace: boolean;
}

/**
 * A parsed `briefing card --drop` invocation: remove the one row naming a url the owner's ruling settled.
 *
 * @internal — the arm `./cardDropRun.ts` runs.
 */
export interface BriefingCardDropArgs extends BriefingCardCommonArgs {
  readonly mode: "drop";
  /** The row's exact url. */
  readonly url: string;
  /** The board row whose settlement carries the drop when the lock-in ledger does not, when given. */
  readonly settledBy: string | undefined;
}

/**
 * A parsed `briefing card` invocation: exactly one of `--row` and `--drop`.
 *
 * @internal — the shape {@link parseBriefingCardArgs} returns and `./cardRun.ts` dispatches on.
 */
export type BriefingCardArgs = BriefingCardPlaceArgs | BriefingCardDropArgs;

/** `recut`'s flags. */
const RECUT_FLAGS: FlagSpec = { boolean: ["dry-run"], string: ["form", "out"] };

/**
 * Every accepted `recut` flag, WITH the `--`, for the help-truth ratchet.
 *
 * @internal — the ratchet's own input; nothing else names it.
 */
export const BRIEFING_RECUT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: RECUT_FLAGS }),
  ...booleanFlagsOf({ spec: RECUT_FLAGS }),
].map((name) => `--${name}`);

/**
 * A parsed `fold-caps` or `recut` invocation: the form, where the result goes, and whether to write at all.
 *
 * @internal — the shape both parsers return; `out` equals `formPath` for `fold-caps`, which edits in place.
 */
export interface BriefingFormPassArgs {
  readonly formPath: string;
  readonly out: string;
  readonly dryRun: boolean;
}

/**
 * Every value one repeatable flag was given, refusing an occurrence with no usable value.
 *
 * @param rest the raw argv tail
 * @param name the flag's name, without the `--`
 * @returns the values in the order written, or one refusal per unusable occurrence
 */
function repeatedValues({ rest, name }: { rest: readonly string[]; name: string }): Result<readonly string[]> {
  const flag = `--${name}`;
  const errors: string[] = [];
  for (const [index, token] of rest.entries()) {
    const next = rest[index + 1];
    if (token === flag && (next === undefined || next.startsWith("-"))) {
      errors.push(`${flag} takes a value (write ${flag}=<text> for text that starts with a dash)`);
    }
  }
  const values = collectRepeated({ name: flag, rest });
  if (values.some((value) => value.trim() === "")) {
    errors.push(`${flag} was given an empty value`);
  }
  return errors.length > 0 ? err(errors) : ok(values);
}

/**
 * One single-value flag's text, refusing an empty one and, when `required`, a missing one.
 *
 * @param values the parsed single-value flags
 * @param name the flag's name, without the `--`
 * @param required whether the flag must be given
 * @param errors where a refusal is recorded
 * @returns the text, or `undefined` when it was not given (or was refused)
 */
function textFlag({
  values,
  name,
  required,
  errors,
}: {
  values: ParsedFlags["values"];
  name: string;
  required: boolean;
  errors: string[];
}): string | undefined {
  const value = values[name];
  if (value === undefined) {
    if (required) {
      errors.push(`--${name} is required`);
    }
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`--${name} was given an empty value`);
    return undefined;
  }
  return value;
}

/**
 * `--keep-recent`: a whole number from 1 to the schema's own cap, written as digits and nothing else.
 *
 * @param raw the flag's value, absent when it was not given
 * @param errors where a refusal is recorded
 * @returns the count
 */
function keepRecentOf({ raw, errors }: { raw: string | undefined; errors: string[] }): number {
  if (raw === undefined) {
    return DEFAULT_KEEP_RECENT;
  }
  const count = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(count) || count < 1 || count > PAGE_UNFOLDED_BLOCKS_MAX) {
    errors.push(
      `--keep-recent takes a whole number between 1 and ${String(PAGE_UNFOLDED_BLOCKS_MAX)} (the schema's own cap)`,
    );
    return DEFAULT_KEEP_RECENT;
  }
  return count;
}

/**
 * `--sleeping`: exactly `true` or `false`, never a truthy reading of any other word.
 *
 * @param raw the flag's value
 * @param errors where a refusal is recorded
 * @returns the boolean
 */
function sleepingOf({ raw, errors }: { raw: string | undefined; errors: string[] }): boolean {
  if (raw !== undefined && raw !== "true" && raw !== "false") {
    errors.push("--sleeping takes exactly `true` or `false`");
  }
  return raw === "true";
}

/**
 * Parse `briefing sweep-block`'s argv tail.
 *
 * Every problem is reported at once, so one run names everything wrong with the invocation.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed arguments, or every refusal
 */
export function parseBriefingSweepBlockArgs({ rest }: { rest: readonly string[] }): Result<BriefingSweepBlockArgs> {
  const repeated = SWEEP_BLOCK_REPEATED.map((name) => repeatedValues({ name, rest }));
  const scalarTail = SWEEP_BLOCK_REPEATED.reduce<readonly string[]>(
    (tail, name) => withoutRepeated({ name: `--${name}`, rest: tail }),
    rest,
  );
  const parsed = parseFlags({ args: scalarTail, spec: SWEEP_BLOCK_FLAGS });
  const errors: string[] = repeated.flatMap((values) => (values.isErr() ? values.error : []));
  if (parsed.isErr()) {
    return err([...errors, ...parsed.error]);
  }
  const flags = sweepScalarFlags({ errors, values: parsed.value.values });
  const [details = [], folds = [], prefixes = [], sentences = []] = repeated.map((values) => values.unwrapOr([]));
  errors.push(...headlineSentenceIssues({ field: "--headline-sentence", sentences }));
  if (folds.length === 0) {
    errors.push("--fold <text> is required at least once: each becomes one list in the recent block's fold");
  }
  const { alignment, foldSummary, formPath, handoff, model, pinnedAt, workspace } = flags;
  if (
    errors.length > 0 ||
    formPath === undefined ||
    workspace === undefined ||
    handoff === undefined ||
    model === undefined ||
    pinnedAt === undefined ||
    alignment === undefined ||
    foldSummary === undefined
  ) {
    return err(errors);
  }
  return ok({
    dryRun: parsed.value.values["dry-run"] === true,
    formPath,
    input: {
      alignment: { details, headline: alignment, intake: flags.intake, summary: flags.alignmentSummary },
      dropCardPrefixes: prefixes,
      earlierSummary: flags.earlierSummary,
      header: {
        handoff,
        lede: flags.lede,
        model,
        pinnedAt,
        sleeping: flags.sleeping,
        workspace,
      },
      keepRecent: flags.keepRecent,
      recent: { foldSummary, folds, sentences },
    },
  });
}

/**
 * Every single-value flag `sweep-block` takes, read in one place.
 *
 * A required flag that is missing leaves its field `undefined` and appends its own refusal to `errors`, so
 * one run names all of them rather than the first.
 *
 * @param values the parsed single-value flags
 * @param errors where each refusal is recorded
 * @returns each flag's value, with the two typed ones already converted
 */
function sweepScalarFlags({ values, errors }: { values: ParsedFlags["values"]; errors: string[] }): {
  formPath: string | undefined;
  workspace: string | undefined;
  handoff: string | undefined;
  model: string | undefined;
  pinnedAt: string | undefined;
  alignment: string | undefined;
  foldSummary: string | undefined;
  lede: string | undefined;
  alignmentSummary: string | undefined;
  intake: string | undefined;
  earlierSummary: string | undefined;
  keepRecent: number;
  sleeping: boolean;
} {
  /** One flag's text, bound to this call's values and error list. Empty or missing is recorded, not thrown. */
  const text = ({ name, required }: { name: string; required: boolean }): string | undefined =>
    textFlag({ errors, name, required, values });
  return {
    alignment: text({ name: "alignment", required: true }),
    alignmentSummary: text({ name: "alignment-summary", required: false }),
    earlierSummary: text({ name: "earlier-summary", required: false }),
    foldSummary: text({ name: "fold-summary", required: true }),
    formPath: text({ name: "form", required: true }),
    handoff: text({ name: "handoff", required: true }),
    intake: text({ name: "intake", required: false }),
    keepRecent: keepRecentOf({ errors, raw: text({ name: "keep-recent", required: false }) }),
    lede: text({ name: "lede", required: false }),
    model: text({ name: "model", required: true }),
    pinnedAt: text({ name: "pinned-at", required: true }),
    sleeping: sleepingOf({ errors, raw: text({ name: "sleeping", required: true }) }),
    workspace: text({ name: "workspace", required: true }),
  };
}

/**
 * Parse `briefing fold-caps`' argv tail. It edits the form in place, so `out` is the form's own path.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed arguments, or the refusals
 */
export function parseBriefingFoldCapsArgs({ rest }: { rest: readonly string[] }): Result<BriefingFormPassArgs> {
  const parsed = parseFlags({ args: rest, spec: FOLD_CAPS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];
  const formPath = textFlag({ errors, name: "form", required: true, values: parsed.value.values });
  if (formPath === undefined) {
    return err(errors);
  }
  return ok({ dryRun: parsed.value.values["dry-run"] === true, formPath, out: formPath });
}

/**
 * Parse `briefing recut`'s argv tail. `--out` is required and may name the form itself.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed arguments, or the refusals
 */
export function parseBriefingRecutArgs({ rest }: { rest: readonly string[] }): Result<BriefingFormPassArgs> {
  const parsed = parseFlags({ args: rest, spec: RECUT_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];
  const formPath = textFlag({ errors, name: "form", required: true, values: parsed.value.values });
  const out = textFlag({ errors, name: "out", required: true, values: parsed.value.values });
  if (formPath === undefined || out === undefined) {
    return err(errors);
  }
  return ok({ dryRun: parsed.value.values["dry-run"] === true, formPath, out });
}

/**
 * Parse `briefing card`'s argv tail: exactly one of `--row` and `--drop`, `--replace` only beside `--row`,
 * `--settled-by` only beside `--drop`. Every problem is reported at once.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed arguments, or the refusals
 */
export function parseBriefingCardArgs({ rest }: { rest: readonly string[] }): Result<BriefingCardArgs> {
  const parsed = parseFlags({ args: rest, spec: CARD_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const openPagesPath = textFlag({ errors, name: "open-pages", required: true, values });
  const rowSource = textFlag({ errors, name: "row", required: false, values });
  const url = textFlag({ errors, name: "drop", required: false, values });
  const settledBy = textFlag({ errors, name: "settled-by", required: false, values });
  const home = textFlag({ errors, name: "home", required: false, values });
  const replace = values["replace"] === true;
  errors.push(
    ...cardArmProblems({
      dropGiven: values["drop"] !== undefined,
      replace,
      rowGiven: values["row"] !== undefined,
      settledBy: values["settled-by"] !== undefined,
    }),
  );
  if (openPagesPath === undefined || errors.length > 0) {
    return err(errors);
  }
  const common = { dryRun: values["dry-run"] === true, home, json: values["json"] === true, openPagesPath };
  if (url !== undefined) {
    return ok({ ...common, mode: "drop", settledBy, url });
  }
  // An invariant, not a guess: with no refusal recorded, exactly one arm was given and its value was non-empty,
  // and it is not --drop.
  return ok({ ...common, mode: "place", replace, rowSource: rowSource! });
}

/**
 * What is wrong with the combination of arm flags `briefing card` was given, one line each.
 *
 * @param rowGiven whether `--row` appeared at all, empty value included
 * @param dropGiven whether `--drop` appeared at all, empty value included
 * @param replace whether `--replace` was set
 * @param settledBy whether `--settled-by` appeared at all
 * @returns every refusal, empty when the combination is one the verb runs
 */
function cardArmProblems({
  rowGiven,
  dropGiven,
  replace,
  settledBy,
}: {
  rowGiven: boolean;
  dropGiven: boolean;
  replace: boolean;
  settledBy: boolean;
}): readonly string[] {
  const problems: string[] = [];
  if (rowGiven && dropGiven) {
    problems.push("--row and --drop are exclusive: --row places one row, --drop removes one");
  } else if (!rowGiven && !dropGiven) {
    problems.push("one of --row <path|-> or --drop <url> is required");
  }
  if (replace && !rowGiven) {
    problems.push("--replace swaps a --row in place, so it is only accepted beside --row");
  }
  if (settledBy && !dropGiven) {
    problems.push("--settled-by names the board row settling a --drop url, so it is only accepted beside --drop");
  }
  return problems;
}
