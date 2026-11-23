/**
 * Shared machinery every run-lifecycle verb needs: flag parsing, the one resolver that turns argv into a
 * {@link RunContext}, the ownership/phase guards a mutating verb must pass, and the clock. Split out of
 * `lifecycleRun.ts` so each verb file ({@link ./lifecycleRunOwnership}, {@link ./lifecycleRunOrphan},
 * {@link ./lifecycleRunQuestions}, {@link ./lifecycleRunVerbs}) can depend on this without depending on each
 * other — none of them import one another, only this.
 *
 * One shared resolver, because every verb in `SPECS` below needs the same things — the doc, its probes and its
 * journal — and a copy per verb would drift. {@link nowIso} is where the `lifecycleRun*` files read the clock. The
 * filesystem is not this file's alone: `runContext` in `lifecycle.ts` reads the doc and journal, and the sibling
 * verb files read and append to the board and journal themselves.
 */

import { resolve as absolutePath } from "node:path";

import { hasUnansweredDispatch } from "../../../handover/attention.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { ownershipAmbiguousLines } from "../../../handover/ledger.js";
import { parkedReleaseOpensFinish } from "../../../handover/parkedFinish.js";
import {
  currentSessionId,
  foreignRunLine,
  type RunOwnership,
  type RunWriter,
  runOwnership,
  shellValue,
  type WriterLiveness,
} from "../../../handover/runOwner.js";
import { ALLOW_STALE_JOURNAL_ENV, staleJournalHatchOpen, staleJournalRefusal } from "../../../handover/staleReader.js";
import { scanBoard } from "../../../handover/store.js";
import { classifyWriterLiveness } from "../../../handover/writerLiveness.js";
import { logger } from "../../../lib/logger.js";
import { codexThreadObserver } from "../../../measurement/codexOpenFiles.js";
import { isAlive } from "../../../measurement/measure.js";
import { defaultSessionsDir, discoverSessions, sessionLiveness } from "../../../measurement/sessions.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  booleanFlagsOf,
  type FlagSpec,
  type ParsedFlags,
  parseFlags,
  stringFlagOr,
  stringFlagsOf,
} from "../../parseFlags.js";
import { isContextError, type RunContext, runContext } from "./lifecycle.js";
import { lifecycleProbeSeams, parseProbedTree } from "./lifecycleProbeSeams.js";
import { phaseRefusal } from "./phaseRefusal.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

/** Flags shared by every lifecycle verb. */
const COMMON: readonly string[] = ["base", "dir", "home"];
/** `handover finish`'s own string flags, beside {@link COMMON}. */
const FINISH_STRINGS: readonly string[] = ["lessons", "park-index", "parked-at", "probed-repo", "probed-tree"];

/** The stakes an ask carries beside its shape — risk, blast radius and the still-real check. */
const STAKES_FLAGS: readonly string[] = ["risk", "blast-radius", "still-real"];

/** Per-verb flag specs. Each verb's own text flag is what distinguishes it. */
const SPECS: Readonly<Record<string, FlagSpec>> = {
  abandon: { string: [...COMMON, "why"] },
  amend: { string: [...COMMON, "why"] },
  answer: { string: [...COMMON, "answer"] },
  // `--problem`, `--options` and `--lean` are the SHAPE an ask must carry.
  // One `--options` flag holding one option per LINE rather than a repeated flag: `../../parseFlags.ts` keeps
  // values in a `Record<string, string | boolean>`, so widening it for this verb would change how every verb
  // in the tree parses argv — and the comma idiom cannot carry an option, whose text contains commas.
  // `--action` carries a whole JSON document (`./askActionFlag.ts`) because an action is a dozen fields,
  // several repeated, and this parser keeps one value per flag.
  // `--example` IS repeatable — one per related ask folded onto the card, read in order by `repeatedFlagValues` —
  // and `--example-gap` is its one-line alternative (`../../../handover/askExamples.ts`).
  // `--read-owner-words` names, comma-separated, every later row of the owner's words the seat has read
  // (`../../../handover/laterOwnerWords.ts`).
  ask: {
    repeatable: ["example"],
    string: [
      ...COMMON,
      "question",
      "problem",
      "options",
      "lean",
      ...STAKES_FLAGS,
      "action",
      "example",
      "example-gap",
      "read-owner-words",
    ],
  },
  claim: { boolean: ["force"], string: [...COMMON, "why"] },
  // `--still-real` restates the check the card prints under the question, which a correction otherwise keeps.
  correct: { string: [...COMMON, "question", "why", "still-real"] },
  // `--park-index` with `--parked-at` binds the finish to ONE park: `handover wake` asks about a park, and a re-park
  // landing while its finish runs is a different park the append must not close.
  // `--probed-repo` and `--probed-tree` name the `repo:` and the tree the wake proved the merge in; a doc naming
  // another repo refuses (`probedRepoMoved`), and probes classified onto another tree read not-evaluated.
  finish: { boolean: ["probe", "dry-run", "beside-question"], string: [...COMMON, ...FINISH_STRINGS] },
  // No `--question`: an offer attaches to the question already open, which is the whole point of the verb.
  offer: { string: [...COMMON, "problem", "lean", ...STAKES_FLAGS, "action"] },
  // The question it parks on is the one already open, and the screen is read, never typed. `--wake-at` and
  // `--wake-on-checks` name what brings it back instead, for a seat waiting on a clock or CI rather than on the owner.
  park: { string: [...COMMON, "workspace", "wake-at", "wake-on-checks", "read-owner-words"] },
  // Only `--still-real`: a reconfirm restates nothing, so the check it re-ran is all it carries.
  reconfirm: { string: [...COMMON, "still-real"] },
  release: { string: [...COMMON, "why"] },
  resume: { boolean: ["probe"], string: [...COMMON] },
  "sign-off": { string: [...COMMON, "by", "note"] },
  start: { boolean: ["probe"], string: [...COMMON, "branch"] },
  // Only `--why`: a withdrawal names the open question itself, so the check that dissolved it is all it carries.
  withdraw: { string: [...COMMON, "why"] },
};

/** `--`-prefixed flag names per verb, for the help-truth ratchet. */
export const HANDOVER_LIFECYCLE_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(SPECS).map(([verb, spec]) => [
    verb,
    [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`).toSorted(),
  ]),
);

/** A verb's declared flag names; a verb with no spec entry declares none, so its usage line names none. */
function declaredFlagNames({ verb }: { verb: string }): readonly string[] {
  const names = HANDOVER_LIFECYCLE_FLAG_NAMES[verb];
  if (names === undefined) {
    return [];
  }
  return names;
}

/** The spec a verb parses with; a verb with no entry still takes the routing flags every lifecycle verb shares. */
function verbSpec({ verb }: { verb: string }): FlagSpec {
  const spec = SPECS[verb];
  if (spec === undefined) {
    return { string: [...COMMON] };
  }
  return spec;
}

/**
 * The usage line for one verb, built from its REAL flag spec.
 *
 * The manifest deliberately does NOT call this — it carries literals, so listing the verb surface never loads a
 * command module. This exists so the help-truth ratchet can compare those literals against the parser.
 *
 * @param verb the verb name
 * @returns the usage line
 */
export function lifecycleUsage({ verb }: { verb: string }): string {
  const flags = declaredFlagNames({ verb });
  // Every STRING flag takes a value — derived from the spec, so a verb's new flag cannot render as a bare switch.
  const spec = SPECS[verb];
  const withValue = new Set(spec === undefined ? [] : stringFlagsOf({ spec }).map((name) => `--${name}`));
  const rendered = flags.map((flag) => (withValue.has(flag) ? `[${flag} <value>]` : `[${flag}]`)).join(" ");
  return `usage: slopweaver handover ${verb} <slug> ${rendered}`;
}

/**
 * Parse one lifecycle verb's flags.
 *
 * @param verb which verb's spec to use
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the errors
 */
export function parseLifecycleArgs({
  verb,
  rest,
}: {
  verb: string;
  rest: readonly string[];
}): ReturnType<typeof parseFlags> {
  // Positionals ARE allowed: every lifecycle verb takes the slug as one. Without this the parser rejects the
  // slug as a stray argument, which makes the whole verb family unreachable.
  return parseFlags({ allowPositionals: true, args: rest, spec: verbSpec({ verb }) });
}

/**
 * One declared string flag, or `undefined`.
 *
 * @param parsed the parsed flags to read from
 * @param name the flag's name, without its leading `--`
 * @returns the flag's string value, or `undefined` when absent or not a string
 */
export function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The caller's non-default routing flags, for embedding in recommended invocations.
 *
 * A suggestion that omits the `--home`/`--dir` this invocation was routed with recommends a command that
 * reads a DIFFERENT board — an r3 review pass pasted one against a configured board and got "no doc on the
 * board claims the slug". Empty on the defaults, so default-path suggestion text is unchanged.
 *
 * @param parsed this invocation's parsed flags, whose --home/--dir are the routing to preserve
 * @param cwd the directory a relative value resolves against — an injected SEAM rather than an option,
 *   so a test can exercise relative resolution without `process.chdir`, which a worker thread cannot do
 * @returns the rendered flag suffix, empty when the invocation ran on the defaults
 */
export function routingFlagSuffix({ parsed, cwd = process.cwd() }: { parsed: ParsedFlags; cwd?: string }): string {
  const home = stringFlag({ name: "home", parsed });
  const dir = stringFlag({ name: "dir", parsed });
  // ABSOLUTE before rendering: this invocation resolved a relative --dir against ITS cwd, and the command it
  // recommends may run in a session with a different one — an r3 pass showed `--dir board` silently reading
  // a different board over there. The absolute spelling is the path this invocation actually used.
  return `${home === undefined ? "" : ` --home ${routedValue({ cwd, emptyResolvesToCwd: true, value: home })}`}${
    dir === undefined ? "" : ` --dir ${routedValue({ cwd, emptyResolvesToCwd: false, value: dir })}`
  }`;
}

/**
 * One routing value spelled for a pasted command: the LEXICAL absolute, matching how the verbs actually
 * resolve a doc — every content read goes through `path.join`, which collapses `..` lexically before any
 * filesystem call, so the lexical spelling reproduces exactly the docs and journals this invocation resolved.
 * (Physical realpath was tried and refuted twice by review passes: `scanBoard` enumerates raw paths while
 * reading children lexically, so on a symlink-plus-dot-dot input the verb's own read is a chimera no single
 * spelling can reproduce — a pre-existing pathology of adversarial inputs, out of this change's scope.)
 *
 * The EMPTY string resolves per flag, because the verbs give it two different meanings (both found by review
 * passes, one per direction): an empty `--home` reaches `join("", "handovers")`, a cwd-relative read, so its
 * cross-session reproduction is the ABSOLUTE cwd; an empty `--dir` reaches `readdir("")`, which fails, so the
 * literal `''` is the only spelling that reproduces that outcome.
 *
 * @param value the raw --home/--dir value this invocation received
 * @param emptyResolvesToCwd whether the receiving flag treats "" as a cwd-relative read (--home) rather than a
 *   failing one (--dir)
 * @param cwd the directory a relative value resolves against — an injected SEAM rather than an option, so a
 *   test can exercise relative resolution without `process.chdir`, which a worker thread cannot do
 * @returns the pasteable spelling that resolves the same docs and journals
 */
export function routedValue({
  value,
  emptyResolvesToCwd,
  cwd = process.cwd(),
}: {
  value: string;
  emptyResolvesToCwd: boolean;
  cwd?: string;
}): string {
  if (value === "" && !emptyResolvesToCwd) {
    return shellValue({ value });
  }
  return shellValue({ value: absolutePath(cwd, value) });
}

/** What every verb needs after flag parsing: the resolved context plus where the journal lives. */
export interface Resolved {
  readonly context: RunContext;
  readonly runsDir: string;
  /** Every doc on the board, so `start`'s blocker check sees the same set the board printed. */
  readonly all: readonly HandoverDoc[];
  /**
   * Why {@link all} may be short: the scan's own failure, or each file it could not read. Carried rather than
   * dropped so a verb whose check needs the WHOLE board (`handover ask`'s later owner words) can refuse on it.
   */
  readonly boardGaps: { readonly failed: string | undefined; readonly unreadable: readonly string[] };
  readonly parsed: ParsedFlags;
  /** The resolved state home, carried so a verb reaching a second store under it need not re-derive it. */
  readonly home: string;
  /** The handovers directory `all` was scanned from, so `start` composes a dependency's row from the same place. */
  readonly handoverDir: string;
}

/**
 * Resolve the slug and flags, printing and returning the code on any failure.
 *
 * @param verb the verb being resolved
 * @param argv the full process argv
 * @returns the resolved context, or the exit code to return on a resolution failure
 */
export function resolve({ verb, argv }: { verb: string; argv: readonly string[] }): Resolved | number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: lifecycleUsage({ verb }) });
    return EXIT_OK;
  }
  const parsed = parseLifecycleArgs({ rest, verb });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: lifecycleUsage({ verb }) });
    return EXIT_USAGE;
  }
  const slug = parsed.value.positionals[0];
  if (slug === undefined) {
    logger.error({ msg: `handover ${verb}: a <slug> is required` });
    logger.error({ msg: lifecycleUsage({ verb }) });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  const paths = stateHomePaths({ home });
  const handoverDir = stringFlagOr({ fallback: paths.handovers, name: "dir", parsed: parsed.value });
  const provedTree = parseProbedTree({ text: stringFlag({ name: "probed-tree", parsed: parsed.value }) });
  if (provedTree.isErr()) {
    logger.error({ msg: `handover ${verb}: ${provedTree.error}` });
    return EXIT_USAGE;
  }
  const context = runContext({
    base: stringFlag({ name: "base", parsed: parsed.value }),
    handoverDir,
    runsDir: paths.runs,
    seams: lifecycleProbeSeams({ provedTree: provedTree.value, runCommands: parsed.value.values["probe"] === true }),
    slug,
  });
  if (isContextError(context)) {
    logger.error({ msg: `handover ${verb}: ${context.message}` });
    return context.code;
  }
  const board = scanBoard({ handoverDir });
  return {
    all: board.isOk() ? board.value.docs : [],
    boardGaps: board.isOk()
      ? { failed: undefined, unreadable: board.value.unreadable }
      : { failed: board.error.message, unreadable: [] },
    context,
    handoverDir,
    home,
    parsed: parsed.value,
    runsDir: paths.runs,
  };
}

/**
 * The phase gate for one resolved verb, with the dispatch fact it needs supplied from the same events.
 *
 * One place rather than five, because every caller must pass the SAME `dispatchPending` derivation — a call site
 * that computed it differently, or forgot it, would quietly re-open the hole where a supervisor cannot abandon
 * its own unanswered dispatch.
 *
 * @param resolved the resolved run context
 * @param verb the verb being attempted
 * @returns the refusal sentence, or `undefined` when it may proceed
 */
export function phaseRefusalFor({ resolved, verb }: { resolved: Resolved; verb: string }): string | undefined {
  return phaseRefusal({
    dispatchPending: hasUnansweredDispatch({ events: resolved.context.events }),
    phase: resolved.context.run.phase,
    verb,
  });
}

/**
 * The current instant, the one place a lifecycle verb reads the clock.
 *
 * @returns the current instant, ISO-8601
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The production adapter over the shared classifier: real pid probe, one fresh registry read per call.
 *
 * @param writer the recorded writer to classify
 * @returns the writer's liveness verdict
 */
export function writerLivenessNow({ writer }: { writer: RunWriter }): WriterLiveness {
  return classifyWriterLiveness({
    codexThread: codexThreadObserver(),
    processAlive: isAlive,
    sessionLive: ({ sessionId }) =>
      sessionLiveness({ roster: discoverSessions({ sessionsDir: defaultSessionsDir() }), sessionId }),
    writer,
  });
}

/**
 * Liveness for the current writer when there is one to ask about — `undefined` otherwise.
 *
 * @param ownership the journal's ownership verdict
 * @returns the writer's liveness, or `undefined` when nobody else holds the run
 */
export function holderLiveness({ ownership }: { ownership: RunOwnership }): WriterLiveness | undefined {
  return ownership.kind === "elsewhere" ? writerLivenessNow({ writer: ownership.writer }) : undefined;
}

/**
 * Refuse a write when the run's WRITER genuinely cannot be proven — and say what to do about it.
 *
 * The set is {@link ownershipAmbiguousLines}, not every unreadable line: a well-formed event this checkout's
 * decoder has no case for, declaring no `sessionId`, cannot change who owns a run, and treating it as though
 * it could is what wedged `ask` — the one verb a session blocked on the owner has — across 251 of the 560
 * checkouts on this machine (`../../../handover/ledger.ts` § "A word this build has never heard").
 *
 * Phase-sensitive and correctness guards are deliberately NOT routed through this: `rowEvent.ts`'s
 * `orphaned` and `ruling` guards compare the cycle's own contents, which an unknown line does change.
 *
 * @param context the resolved run context, read once
 * @param verb the verb refusing, as the operator typed it
 * @returns the exit code to return on refusal, or `undefined` when ownership is provable
 */
export function ownershipAmbiguityRefusal({
  context,
  verb,
}: {
  context: RunContext;
  verb: string;
}): number | undefined {
  const lines = ownershipAmbiguousLines({ journal: context });
  if (lines.length === 0) {
    return undefined;
  }
  if (staleJournalHatchOpen({ env: process.env[ALLOW_STALE_JOURNAL_ENV], flag: false })) {
    logger.error({
      msg: `${verb}: proceeding over undecodable journal line(s) ${lines.join(", ")} — ${ALLOW_STALE_JOURNAL_ENV} is set`,
    });
    return undefined;
  }
  for (const line of staleJournalRefusal({ journal: context, lines, verb })) {
    logger.error({ msg: line });
  }
  return EXIT_ERROR;
}

/**
 * Refuse ordinary journal writes against another session's run.
 *
 * @param resolved the resolved run context
 * @param verb the verb attempting the write
 * @returns the exit code to return on refusal, or `undefined` when the write may proceed
 */
export function mutationRefusal({ resolved, verb }: { resolved: Resolved; verb: string }): number | undefined {
  const ambiguousRefusal = ownershipAmbiguityRefusal({ context: resolved.context, verb: `handover ${verb}` });
  if (ambiguousRefusal !== undefined) {
    return ambiguousRefusal;
  }
  const readerSession = currentSessionId({ env: process.env });
  const ownership = runOwnership({
    events: resolved.context.events,
    sessionId: readerSession,
  });
  // `journalAmbiguous: false` is correct here by ordering: an unreadable journal was already refused above,
  // so this renderer only ever runs over a fully-decoded one.
  // Liveness is derived only for phases the renderer can use it in — a closed cycle renders no takeover, so
  // measuring the registry for one would be a read the guidance never consumes (r1).
  const phase = resolved.context.run.phase;
  if (parkedReleaseOpensFinish({ events: resolved.context.events, ownership, phase, verb })) {
    return undefined;
  }
  const line = foreignRunLine({
    docClaim: "one",
    flagSuffix: routingFlagSuffix({ parsed: resolved.parsed }),
    journalAmbiguous: false,
    liveness: phase === "closed" ? undefined : holderLiveness({ ownership }),
    ownership,
    phase,
    readerIdentified: readerSession !== undefined,
    slug: resolved.context.doc.slug,
  });
  if (line === undefined) {
    return undefined;
  }
  logger.error({ msg: `handover ${verb}: ${line}` });
  return EXIT_ERROR;
}
