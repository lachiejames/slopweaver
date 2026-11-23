/**
 * The pure half of the probe family: every parser, with no I/O anywhere — the rendered lines are
 * `./probeLines.ts`.
 *
 * Split from the shells for the reason every `*Core.ts` in this directory is: a parser that reaches
 * nothing can be asserted exactly, and the seven shapes' arithmetic is the part of this verb family most
 * worth asserting exactly.
 *
 * ## Repeated flags, and why the terms are positional
 *
 * `src/cli/parseFlags.ts` runs Node's `parseArgs` non-strict and folds each flag to ONE value — a
 * repeated `--term` keeps the last and silently loses the rest, which on a verb whose whole purpose is
 * fanning N keywords would be a defect that looks like a working command. So keywords arrive as
 * POSITIONALS, which `parseFlags` already returns as a list, and a quoted phrase stays one keyword.
 * `--regex` is the one repeatable-looking flag and it is deliberately single: a probe counts one
 * caller-authored regex, and a caller with two runs the verb twice.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { StoreErrors } from "../../../store/errors.js";
import { AROUND_MODES, type AroundMode, DEFAULT_PEEK_CHARS } from "../../../store/probe/disclose.js";
import { GROUP_FACETS, type GroupFacet, type ProbePlan } from "../../../store/probe/run.js";
import { PROBE_SHAPES, type ProbeShape } from "../../../store/probe/shapes.js";
import type { ProbeSubject } from "../../../store/probe/sql.js";
import { parseSlackAddress, type SlackAddress } from "../../../store/slackIds.js";
import { parseFlags } from "../../parseFlags.js";
import { type Parsed, refusalLines, StoreCommandErrors } from "./errors.js";

/** How many record ids a cell is enumerated with when the caller names no cap. */
export const DEFAULT_ENUMERATE_AT_OR_BELOW = 40;

/** How many ids one enumerated cell returns when the caller names no limit. */
const DEFAULT_IDS = 10;

/**
 * A whole-store, human-authored probe at the default caps — what `store detect` sizes its wave on.
 *
 * Human-only for the reason every ladder rung starts there: a lead a renovate bot or an alert
 * channel inflated is a lead no detective should be spent on before widening.
 */
export const HUMAN_WHOLE_STORE_PROBE: Omit<ProbePlan, "subjects"> = {
  enumerateAtOrBelow: DEFAULT_ENUMERATE_AT_OR_BELOW,
  ids: DEFAULT_IDS,
  includeBots: false,
  source: undefined,
};

/**
 * How many records one `hits` page holds when the caller names no limit.
 *
 * @internal
 */
export const DEFAULT_HITS_LIMIT = 25;

/**
 * How many groups a `groups` read returns when the caller names no limit.
 *
 * @internal
 */
export const DEFAULT_GROUPS_LIMIT = 20;

/** What a `store probe` invocation asked for. */
export interface ProbeArgs {
  readonly subjects: readonly ProbeSubject[];
  readonly source: string | undefined;
  readonly enumerateAtOrBelow: number;
  readonly ids: number;
  readonly includeBots: boolean;
  readonly json: boolean;
}

/** What a `store groups` invocation asked for. */
export interface GroupsArgs {
  readonly term: string;
  readonly shape: ProbeShape;
  readonly facet: GroupFacet;
  readonly limit: number;
  readonly includeBots: boolean;
  readonly json: boolean;
}

/** What a `store hits` invocation asked for. */
export interface HitsArgs {
  readonly term: string;
  readonly shape: ProbeShape;
  readonly source: string | undefined;
  readonly limit: number;
  readonly offset: number;
  readonly includeBots: boolean;
  readonly json: boolean;
}

/**
 * The two boolean flags that set a search rung's bot scope — every search verb's spec lists both.
 *
 * @internal
 */
export const BOT_SCOPE_FLAGS: readonly string[] = ["include-bots", "exclude-bots"];

/**
 * Whether a search widened to bot-authored rows.
 *
 * Human-only is the DEFAULT (detectives start human-only and widen, the way Slack search
 * excludes automations), so `--exclude-bots` changes nothing — it is accepted because it is the spelling they
 * used for the default, and a detective that types it should not be refused for being explicit. Both at
 * once is the one contradiction, and it is refused rather than resolved by picking one.
 *
 * @param values every parsed flag
 * @returns whether bots are included, or the refusal for asking both ways
 */
function botScope({ values }: { values: Readonly<Record<string, string | boolean>> }): Parsed<boolean> {
  const include = values["include-bots"] === true;
  if (include && values["exclude-bots"] === true) {
    return err(StoreCommandErrors.botScopeContradictory());
  }
  return ok(include);
}

/** What a `store peek` invocation asked for. */
export interface PeekArgs {
  readonly ids: readonly string[];
  readonly match: string | undefined;
  readonly chars: number;
  readonly json: boolean;
}

/** What a `store open` invocation asked for. */
export interface OpenArgs {
  readonly ids: readonly string[];
  readonly json: boolean;
}

/** What a `store around` invocation asked for. */
export interface AroundArgs {
  /** What the caller typed, resolved to the thing it addresses — a row id or Slack's own coordinates. */
  readonly address: SlackAddress;
  readonly mode: AroundMode;
  readonly before: number;
  readonly after: number;
  readonly chars: number;
  readonly json: boolean;
}

/**
 * Read one flag as a positive integer, or say why it is not one.
 *
 * @param values every parsed flag
 * @param name which flag
 * @param fallback what it is when absent
 * @returns the number, or the refusal
 */
function positiveInt({
  values,
  name,
  fallback,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
  fallback: number;
}): Parsed<number> {
  const raw = values[name];
  if (raw === undefined) {
    return ok(fallback);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return err(StoreCommandErrors.wholeNumberRequired({ flag: name, got: String(raw) }));
  }
  return ok(parsed);
}

/**
 * Read the comma-separated `--id` list every record verb takes.
 *
 * @param values every parsed flag
 * @returns the ids, or the refusal when none were given
 */
function idList({ values }: { values: Readonly<Record<string, string | boolean>> }): Parsed<readonly string[]> {
  const raw = values["id"];
  if (typeof raw !== "string" || raw.length === 0) {
    return err(StoreCommandErrors.idsMissing());
  }
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return ids.length === 0 ? err(StoreCommandErrors.idListEmpty({ got: raw })) : ok(ids);
}

/**
 * Read the `--shape` flag against the closed vocabulary.
 *
 * @param values every parsed flag
 * @returns the shape, or the refusal listing the seven
 */
function shapeOf({ values }: { values: Readonly<Record<string, string | boolean>> }): Parsed<ProbeShape> {
  const raw = values["shape"];
  if (typeof raw !== "string") {
    return err(StoreCommandErrors.shapeMissing({ known: PROBE_SHAPES }));
  }
  const found = PROBE_SHAPES.find((shape) => shape === raw);
  return found === undefined ? err(StoreCommandErrors.shapeUnknown({ got: raw, known: PROBE_SHAPES })) : ok(found);
}

/**
 * Parse `store probe`.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parseProbeArgs({ rest }: { rest: readonly string[] }): Parsed<ProbeArgs> {
  const flags = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["json", ...BOT_SCOPE_FLAGS], string: ["source", "regex", "enumerate-at-or-below", "ids"] },
  });
  if (flags.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: flags.error }));
  }
  const { values, positionals } = flags.value;
  const regex = typeof values["regex"] === "string" ? values["regex"] : undefined;
  const subjects: ProbeSubject[] = positionals.map((term) => ({ kind: "term", term }));
  if (regex !== undefined) {
    subjects.push({ kind: "regex", pattern: regex });
  }
  if (subjects.length === 0) {
    return err(StoreCommandErrors.probeSubjectMissing());
  }
  const cap = positiveInt({ fallback: DEFAULT_ENUMERATE_AT_OR_BELOW, name: "enumerate-at-or-below", values });
  const ids = positiveInt({ fallback: DEFAULT_IDS, name: "ids", values });
  const bots = botScope({ values });
  if (cap.isErr() || ids.isErr() || bots.isErr()) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: refusalLines({ results: [cap, ids, bots] }) }));
  }
  return ok({
    enumerateAtOrBelow: cap.value,
    ids: ids.value,
    includeBots: bots.value,
    json: values["json"] === true,
    source: typeof values["source"] === "string" ? values["source"] : undefined,
    subjects,
  });
}

/**
 * Parse `store groups`.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parseGroupsArgs({ rest }: { rest: readonly string[] }): Parsed<GroupsArgs> {
  const flags = parseFlags({
    args: rest,
    spec: { boolean: ["json", ...BOT_SCOPE_FLAGS], string: ["term", "shape", "facet", "limit"] },
  });
  if (flags.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: flags.error }));
  }
  const { values } = flags.value;
  const term = values["term"];
  const shape = shapeOf({ values });
  const limit = positiveInt({ fallback: DEFAULT_GROUPS_LIMIT, name: "limit", values });
  const bots = botScope({ values });
  const rawFacet = values["facet"];
  const facet = GROUP_FACETS.find((known) => known === rawFacet);
  const refusals = [
    ...(typeof term === "string" && term.length > 0 ? [] : ["--term is required"]),
    ...refusalLines({ results: [shape] }),
    ...(facet === undefined ? [`--facet must be one of ${GROUP_FACETS.join(", ")}`] : []),
    ...refusalLines({ results: [limit, bots] }),
  ];
  if (refusals.length > 0 || !shape.isOk() || facet === undefined || !limit.isOk() || !bots.isOk()) {
    return err(StoreCommandErrors.verbRefused({ reasons: refusals, verb: "store groups" }));
  }
  return ok({
    facet,
    includeBots: bots.value,
    json: values["json"] === true,
    limit: limit.value,
    shape: shape.value,
    term: String(term),
  });
}

/**
 * Parse `store hits`.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parseHitsArgs({ rest }: { rest: readonly string[] }): Parsed<HitsArgs> {
  const flags = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["json", ...BOT_SCOPE_FLAGS], string: ["term", "shape", "source", "limit", "offset"] },
  });
  if (flags.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: flags.error }));
  }
  const { values } = flags.value;
  const term = values["term"];
  const shape = shapeOf({ values });
  const limit = positiveInt({ fallback: DEFAULT_HITS_LIMIT, name: "limit", values });
  const offset = positiveInt({ fallback: 0, name: "offset", values });
  const bots = botScope({ values });
  const refusals = [
    ...(typeof term === "string" && term.length > 0 ? [] : ["--term is required"]),
    ...refusalLines({ results: [shape, limit, offset, bots] }),
  ];
  if (refusals.length > 0 || !shape.isOk() || !limit.isOk() || !offset.isOk() || !bots.isOk()) {
    return err(StoreCommandErrors.verbRefused({ reasons: refusals, verb: "store hits" }));
  }
  return ok({
    includeBots: bots.value,
    json: values["json"] === true,
    limit: limit.value,
    offset: offset.value,
    shape: shape.value,
    source: typeof values["source"] === "string" ? values["source"] : undefined,
    term: String(term),
  });
}

/**
 * Parse `store peek`.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parsePeekArgs({ rest }: { rest: readonly string[] }): Parsed<PeekArgs> {
  // `source` is accepted and unused on purpose. A `dd:` id already decides which backend answers, so the
  // flag is redundant here — but a detective that just typed it on `probe` and `hits` will type it again,
  // and refusing the natural next command with "unknown flag: --source" is the shared vocabulary failing at
  // exactly the point it was supposed to help. MEASURED by self-review before this landed.
  const flags = parseFlags({ args: rest, spec: { boolean: ["json"], string: ["id", "match", "chars", "source"] } });
  if (flags.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: flags.error }));
  }
  const { values } = flags.value;
  const ids = idList({ values });
  const chars = positiveInt({ fallback: DEFAULT_PEEK_CHARS, name: "chars", values });
  if (ids.isErr() || chars.isErr()) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: refusalLines({ results: [ids, chars] }) }));
  }
  return ok({
    chars: chars.value,
    ids: ids.value,
    json: values["json"] === true,
    match: typeof values["match"] === "string" ? values["match"] : undefined,
  });
}

/**
 * Parse `store open`.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parseOpenArgs({ rest }: { rest: readonly string[] }): Parsed<OpenArgs> {
  // `source` is accepted and unused, for the reason `parsePeekArgs` states.
  const flags = parseFlags({ args: rest, spec: { boolean: ["json"], string: ["id", "source"] } });
  if (flags.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: flags.error }));
  }
  const ids = idList({ values: flags.value.values });
  return ids.isErr() ? err(ids.error) : ok({ ids: ids.value, json: flags.value.values["json"] === true });
}

/**
 * The `--id` an around read was given, resolved to the thing it addresses.
 *
 * An absent flag is the same failure as an empty one — no address was given — so both are
 * `StoreErrors.addressEmpty()` rather than a second message worded here. Every refusal in this file is
 * built by the store's own factories and flattened to this parser's list, because a CLI parser's failures
 * are only ever displayed.
 *
 * @param id whatever `--id` carried, which may be absent or a bare boolean
 * @returns the address, or the reason it is not one
 */
function aroundAddress({ id }: { id: string | boolean | undefined }): Result<SlackAddress> {
  if (typeof id !== "string") {
    return err([StoreErrors.addressEmpty().message]);
  }
  return parseSlackAddress({ value: id }).mapErr((refusal) => [refusal.message]);
}

/**
 * Which of the three walks a read asked for.
 *
 * @param asked whatever `--mode` carried, which may be absent
 * @returns the mode, or the refusal naming the three that exist
 */
function aroundMode({ asked }: { asked: string | boolean | undefined }): Result<AroundMode> {
  // `conversation` is the default because it is the mode that answers the question a person holds; it is a
  // strict superset of `thread`, so promoting it costs an existing caller nothing.
  const wanted = typeof asked === "string" ? asked : "conversation";
  const mode = AROUND_MODES.find((known) => known === wanted);
  if (mode === undefined) {
    return err([StoreErrors.unknownMode({ asked: wanted, known: AROUND_MODES }).message]);
  }
  return ok(mode);
}

/**
 * Parse `store around`.
 *
 * `--id` is resolved here rather than in the shell, so a mistyped Slack link is a named refusal before a
 * connection is opened — the same reason `store/query.ts` validates a source against its enum first.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parseAroundArgs({ rest }: { rest: readonly string[] }): Parsed<AroundArgs> {
  const flags = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["json"], string: ["id", "mode", "before", "after", "chars"] },
  });
  if (flags.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: flags.error }));
  }
  const { values } = flags.value;
  const address = aroundAddress({ id: values["id"] });
  const mode = aroundMode({ asked: values["mode"] });
  const before = positiveInt({ fallback: 5, name: "before", values });
  const after = positiveInt({ fallback: 5, name: "after", values });
  const chars = positiveInt({ fallback: DEFAULT_PEEK_CHARS, name: "chars", values });
  // Every refusal is collected before any is returned, so one invocation reports every mistake rather
  // than making a caller fix them one flag per run.
  if (address.isErr() || mode.isErr() || before.isErr() || after.isErr() || chars.isErr()) {
    const reasons = refusalLines({ results: [address, mode, before, after, chars] });
    return err(StoreCommandErrors.argumentsRefused({ reasons }));
  }
  return ok({
    address: address.value,
    after: after.value,
    before: before.value,
    chars: chars.value,
    json: values["json"] === true,
    mode: mode.value,
  });
}
