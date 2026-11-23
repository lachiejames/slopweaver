/**
 * The `briefing` noun's flag specs, usage strings and shared resolution.
 *
 * `check` takes one positional, the artifact's file path, and one flag, `--home`, so a proof run can point
 * the voice rules at a throwaway state home instead of the operator's own. `render` takes the typed form
 * and, optionally, where to write the page. Both still live here rather than beside their runners so the
 * help-truth ratchet compares the manifest's literal usage line against the REAL parser rather than against
 * a copy of it.
 */
import { YOUR_LIST_MAX_ROWS } from "../../../briefing/caps.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { TICK_WINDOW_PRIOR_DAYS } from "../../../supervisor/tickStore.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type BriefingCommandError, BriefingCommandErrors } from "./errors.js";

/** How many argv entries precede the verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

/** `check`'s one flag. Named so the help-truth ratchet has a real spec to compare against. */
export const BRIEFING_CHECK_FLAG_NAMES: readonly string[] = ["--home"];

/**
 * Parse `briefing check`'s argv tail: one positional (the artifact's file path), one optional `--home`.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, positionals included
 */
export function parseBriefingCheckArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: { boolean: [], string: ["home"] } });
}

/**
 * The `<html>` positional, or `undefined` when the caller gave none.
 *
 * @param parsed the verb's parsed flags
 * @returns the file path to check
 */
export function briefingCheckPath({ parsed }: { parsed: ParsedFlags }): string | undefined {
  return parsed.positionals[0];
}

/**
 * `corrections`'s flags.
 *
 * @internal — exported for `helpTruth.test.ts`, which compares the manifest's usage line against the real
 * parser rather than a copy of it.
 */
export const BRIEFING_CORRECTIONS_FLAGS: FlagSpec = {
  boolean: ["verify", "json"],
  string: ["artifact", "previous", "page", "out", "home"],
};

/**
 * Every accepted `corrections` flag, WITH the `--`, for the help-truth ratchet.
 *
 * @internal — the ratchet's own input; nothing else names it.
 */
export const BRIEFING_CORRECTIONS_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: BRIEFING_CORRECTIONS_FLAGS }),
  ...booleanFlagsOf({ spec: BRIEFING_CORRECTIONS_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `briefing corrections`' argv tail.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags
 */
export function parseBriefingCorrectionsArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: false, args: rest, spec: BRIEFING_CORRECTIONS_FLAGS });
}

/**
 * Where `corrections` writes the stamped page: a non-empty `--out` when given, else over `--page` itself.
 *
 * @param parsed the verb's parsed flags
 * @param pagePath the `--page` the stamp is computed for
 * @returns the path the stamped page is written to
 */
export function correctionsWritePath({ parsed, pagePath }: { parsed: ParsedFlags; pagePath: string }): string {
  const out = parsed.values["out"];
  if (typeof out !== "string" || out.length === 0) {
    return pagePath;
  }
  return out;
}

/**
 * `freeze`'s flags.
 *
 * @internal — exported for `helpTruth.test.ts`, which compares the manifest's usage line against the real
 * parser rather than a copy of it.
 */
export const BRIEFING_FREEZE_FLAGS: FlagSpec = { boolean: ["json", "new"], string: ["artifact", "page", "home"] };

/**
 * Every accepted `freeze` flag, WITH the `--`, for the help-truth ratchet.
 *
 * @internal — the ratchet's own input; nothing else names it.
 */
export const BRIEFING_FREEZE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: BRIEFING_FREEZE_FLAGS }),
  ...booleanFlagsOf({ spec: BRIEFING_FREEZE_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `briefing freeze`'s argv tail.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags
 */
export function parseBriefingFreezeArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: false, args: rest, spec: BRIEFING_FREEZE_FLAGS });
}

/**
 * `render`'s flags.
 *
 * @internal — exported for `helpTruth.test.ts`, which compares the manifest's usage line against the real
 * parser rather than a copy of it.
 *
 * `--home` is here for the same reason it is on `check`: the verb runs the voice half of the gate over what
 * it just rendered, and that half reads the operator's private rules out of a state home.
 */
export const BRIEFING_RENDER_FLAGS: FlagSpec = {
  boolean: [
    "open-prs",
    "open-page-cards",
    "freshness",
    "nothing-stale",
    "autonomy-ledger",
    "owner-beliefs",
    "knowledge-quiz",
    "hand-steps",
  ],
  string: ["form", "home", "out", "your-list", "top", "open-artifacts", "sweep", "ticks", "ticks-days"],
};

/**
 * Every accepted flag, WITH the `--`, for the help-truth ratchet.
 *
 * @internal — the ratchet's own input; nothing else names it.
 */
export const BRIEFING_RENDER_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: BRIEFING_RENDER_FLAGS }),
  ...booleanFlagsOf({ spec: BRIEFING_RENDER_FLAGS }),
].map((name) => `--${name}`);

/**
 * A parsed `briefing render` invocation.
 *
 * @internal — the shape {@link parseBriefingRenderArgs} returns and `./renderRun.ts` reads.
 */
export interface BriefingRenderArgs {
  readonly formSource: string;
  /** Where the page is written. Absent means stdout, so the verb composes into a pipe. */
  readonly out: string | undefined;
  readonly home: string | undefined;
  /**
   * Where the `session-start --json` document feeding THE OWNER'S list is read from — a path, or `-` for stdin.
   *
   * Absent means the page carries no list of the owner's, which is a real state: a sweep may render before that verb
   * has run, and a page that invented the owner's queue would be worse than one that omits it.
   */
  readonly yourListSource: string | undefined;
  /**
   * Whether the correction block is projected from the proposal queue into the page.
   *
   * A BOOLEAN rather than a path, which `--your-list` and `--open-artifacts` deliberately are not, and the
   * difference is where the facts live. Those two read a document a verb wrote for this sweep; the proposal
   * queue is durable state under `$SLOPWEAVER_HOME` that any session can read at any time, exactly as the
   * autonomy register is, so there is nothing for a sweep to pass along.
   *
   * The block below react-now where the owner corrects a belief the fleet holds about them.
   */
  readonly ownerBeliefs: boolean;
  /**
   * Whether the page carries every step waiting on the owner's own hands, each with the command to paste.
   *
   * A BOOLEAN rather than a path, the same call `--owner-beliefs` one field above makes and for its
   * reason: the hand register is durable state under `$SLOPWEAVER_HOME` that any session can read at any
   * time, so there is nothing for a sweep to pass along.
   *
   * The floating note was once the only surface carrying these, and it could sit on the owner's
   * screen for ten hours unclosable and unreadable. A page cannot go stale in a way the owner cannot see.
   */
  readonly handSteps: boolean;
  /**
   * The sweep whose one quiz question is projected onto the page, absent when the run asked for none.
   *
   * A sweep ID rather than a bare boolean, which `--owner-beliefs` one field above deliberately is,
   * because the quiz ledger is keyed BY sweep: `slopweaver knowledge quiz` cuts one question per tick
   * and the render reads that sweep's row rather than choosing again.
   */
  readonly quizSweep: string | undefined;
  /** The most rows of the owner's list to show. Defaults to `YOUR_LIST_MAX_ROWS`, and may never exceed it. */
  readonly top: number | undefined;
  /**
   * Whether every open pull request in the `--your-list` document also becomes a react-now card.
   *
   * A boolean over the SAME document rather than a second path, because there is only one document: the
   * ranking's `ranked` and `dropped` arrays between them carry every open pull request of the owner's, and two
   * flags naming two files would be two reads that can disagree about the same run.
   *
   * It requires `--your-list`, which is what supplies the document — see {@link parseBriefingRenderArgs}.
   */
  readonly openPrs: boolean;
  /**
   * Whether to project the atlas-and-corpus freshness section into the fold.
   *
   * Every atlas and corpus source, with its last generation, its cadence and whether
   * it is late. Read from this machine's own state — no network — so a sweep can always ask for it.
   */
  readonly freshness: boolean;
  /**
   * Whether to project the "Nothing stale" section into the fold: everything the owner owns across five surfaces,
   * moving, waiting on a named person, or asking the owner one word. Read from local documents only; it reports and
   * never acts.
   */
  readonly nothingStale: boolean;
  /**
   * Whether every open page also becomes its own react-now CARD, on top of its row in the ranked band.
   *
   * OPT-IN rather than implied by `--open-artifacts`, and that is a deliberate choice. The projection REFUSES a page missing any of the six card fields, which is the
   * guarantee the owner's ask needs — but a document written before those fields existed carries none of them, so
   * making the cards automatic would have refused the next sweep's render outright and left the live briefing
   * un-republished until twenty-five entries were authored. The flag is what lets the seat fill the file and
   * turn the cards on in the same breath, with the refusal still absolute once it is on.
   */
  readonly openPageCards: boolean;
  /**
   * Where the sweep's list of open artifacts is read from — a path, or `-` for stdin.
   *
   * A second path rather than a flag over the `--your-list` document, which `--open-prs` deliberately is
   * not, and the difference is where the facts come from. Every open pull request is already IN that
   * document; the pages a session left open in the owner's tabs are in no document at all until a sweep writes
   * them down, so this reads that one.
   *
   * Absent means the page carries no index, which is a real state: nothing is open on the owner, or the sweep has
   * not looked. The verb never invents one — a validity mark is derived from the lock-in ledger, and there
   * is nothing to derive it about.
   */
  readonly openArtifactsSource: string | undefined;
  /**
   * Whether the autonomy ledger section is filled from the store's autonomy ledger.
   *
   * A BOOLEAN rather than a `<path|->` like the two above, and the difference is where the facts live. The owner's
   * list and the open-artifact index are documents another verb produced and handed over, so they need a
   * path. The autonomy ledger is not a document at all — it is ONE table in the store
   * (`../../../autonomy/port.ts`), written by every session in the fleet, and a flag that took a path would
   * be inviting a sweep to render one copy of it while the fleet wrote to another.
   *
   * Absent means the page carries no ledger section, which is a real state: a sweep that has not asked for
   * it. The verb never invents one.
   */
  readonly autonomyLedger: boolean;
  readonly wantsQuiz: boolean;
  readonly sweep: string | undefined;
  /**
   * Where the supervisor tick ledger is read from — a path, or `-` for stdin.
   *
   * Absent means the three narrative sections come out of the FORM, exactly as they always have. That is the
   * opt-in half: the projection lands BESIDE the authored path rather than replacing
   * it, so a pass whose ledger is not there still renders the page it always rendered. The cutover —
   * removing those three fields from the published form — is its own change, after the shadow comparison.
   *
   * A PATH rather than a boolean, unlike `--freshness` and `--autonomy-ledger` which read the state home's
   * own registers: the shadow shift renders the SAME ledger through a second invocation for comparison, and
   * a flag that could only ever mean "this machine's own file" would have nothing to point at a frozen copy.
   */
  readonly ticksSource: string | undefined;
  /**
   * How many local days BEFORE today the projection shows, absent for the ledger reader's own ceiling.
   *
   * The one lever a projection has when the page is too heavy, and it exists because MEASURED on this
   * installation a full five-day window renders to 932,162 bytes against `PAGE_TEXT_MAX_BYTES`'s 262,144 —
   * the owner's own recorded turns being 213 KB of that. A projection may not cut their words to fit, so what gives is
   * how far back the page reaches, and the page and the receipt both state how many days are not shown.
   * `../../../supervisor/tickStore.ts`'s `TICK_WINDOW_PRIOR_DAYS` carries the measurement and the ceiling.
   */
  readonly ticksPriorDays: number | undefined;
}

/**
 * Read `--top`, bounded by the cap the rendered rows are measured against.
 *
 * Bounded here rather than clamped later, for the reason the retired `session-start page` bounded its own:
 * a run asking for more rows than `../../../briefing/oneIndex.ts` would admit should say so before it reads
 * anything, instead of rendering a page the gate then refuses.
 *
 * @param raw the flag's value, absent when it was not passed
 * @returns the row count, absent for the default, or the operator-facing refusal
 */
function parseTopRows({
  raw,
}: {
  raw: string | boolean | undefined;
}): Result<number | undefined, BriefingCommandError> {
  if (raw === undefined) {
    return ok(undefined);
  }
  if (typeof raw !== "string") {
    return err(BriefingCommandErrors.flagValueMissing({ flag: "--top" }));
  }
  const top = Number.parseInt(raw, 10);
  if (!Number.isInteger(top) || top < 1 || top > YOUR_LIST_MAX_ROWS) {
    return err(BriefingCommandErrors.topOutOfRange({ max: YOUR_LIST_MAX_ROWS }));
  }
  return ok(top);
}

/**
 * Read `--ticks-days`, bounded by how many prior days the ledger reader will keep at all.
 *
 * ZERO is allowed and is a real answer: today alone, which is the smallest honest window and the one a page
 * falls back to when a longer one will not fit. The ceiling is the reader's own, so a run asking for a sixth
 * day is told so before anything is read rather than silently given five.
 *
 * @param raw the flag's value, absent when it was not passed
 * @returns the day count, absent for the reader's default, or the operator-facing refusal
 */
function parseTickDays({
  raw,
}: {
  raw: string | boolean | undefined;
}): Result<number | undefined, BriefingCommandError> {
  if (raw === undefined) {
    return ok(undefined);
  }
  if (typeof raw !== "string") {
    return err(BriefingCommandErrors.flagValueMissing({ flag: "--ticks-days" }));
  }
  const days = Number.parseInt(raw, 10);
  if (!Number.isInteger(days) || days < 0 || days > TICK_WINDOW_PRIOR_DAYS) {
    return err(BriefingCommandErrors.ticksDaysOutOfRange({ max: TICK_WINDOW_PRIOR_DAYS }));
  }
  return ok(days);
}

/**
 * Every field of an invocation that says where a section's facts come from.
 *
 * One shape rather than six locals, because {@link sourceConflict} judges them TOGETHER — three of its four
 * rules are about two fields disagreeing — and because the parsed result spreads it wholesale, so a field
 * added here cannot be silently dropped on the way out.
 *
 * @internal — the pair {@link parseBriefingRenderArgs} and {@link sourceConflict} share.
 */
interface InvocationSources {
  readonly yourListSource: string | undefined;
  readonly openPrs: boolean;
  readonly openArtifactsSource: string | undefined;
  readonly openPageCards: boolean;
  readonly freshness: boolean;
  readonly nothingStale: boolean;
  readonly autonomyLedger: boolean;
  readonly wantsQuiz: boolean;
  readonly sweep: string | undefined;
  readonly ticksSource: string | undefined;
  readonly ticksPriorDays: number | undefined;
}

/**
 * Every flag that can be handed `-`, with the name a refusal calls it.
 *
 * ONE list rather than a pair of comparisons, and that is the rule rather than a tidy-up: the check this
 * replaced compared `--your-list` against `--open-artifacts` and nothing else, so `--form -` beside either
 * of them already went unreported, and a fourth stdin reader would have gone unreported again. A list is
 * what makes adding a fifth safe — the check widens by construction instead of by somebody remembering.
 *
 * @param sources every field naming where a section's facts come from
 * @param formSource the `--form` value, which is `-` for stdin and the JSON itself otherwise
 * @returns each stdin-reading flag's name, in the order they are read
 */
function stdinConsumers({
  sources,
  formSource,
}: {
  sources: InvocationSources;
  formSource: string;
}): readonly string[] {
  return [
    { flag: "--form", value: formSource },
    { flag: "--your-list", value: sources.yourListSource },
    { flag: "--open-artifacts", value: sources.openArtifactsSource },
    { flag: "--ticks", value: sources.ticksSource },
  ]
    .filter((one) => one.value === "-")
    .map((one) => one.flag);
}

/**
 * The one refusal an invocation's SOURCES can earn, or undefined when they are coherent.
 *
 * Rules, every one of them a run that has not said where a section's facts come from. Two are a flag asking
 * for a projection of a document nobody named. One is a run naming both ledger routes, which has not decided
 * WHICH register the page is about. The last is {@link stdinConsumers} — more than one input given `-`,
 * where there is one stdin, so whichever read ran second would see an empty document and the page would
 * silently omit that section, which is the quiet wrong answer rather than a refusal.
 *
 * All of them are checked BEFORE anything is read, so a refusal costs no I/O and leaves no half-consumed
 * stream.
 *
 * @internal — one step of {@link parseBriefingRenderArgs}; no caller outside this file names it.
 *
 * @param sources every field of the invocation that names where a section's facts come from
 * @param formSource the `--form` value, which is the fourth thing that can claim stdin
 * @returns the operator-facing refusal, or undefined
 */
function sourceConflict({
  sources,
  formSource,
}: {
  sources: InvocationSources;
  formSource: string;
}): string | undefined {
  const companion = companionRefusal({ sources });
  if (companion !== undefined) {
    return companion;
  }
  const stdin = stdinConsumers({ formSource, sources });
  if (stdin.length > 1) {
    return (
      `${String(stdin.length)} inputs were given \`-\` (${stdin.join(", ")}), and there is only one stdin — ` +
      "whichever read runs second would see an empty document and the page would silently omit that section. " +
      "Pass a path, or the form's JSON itself, for all but one."
    );
  }
  return undefined;
}

/**
 * The refusal a flag earns by asking for a projection of a document nobody named, or by naming two.
 *
 * Split from {@link sourceConflict} because it is one question asked six ways — did this run say where the
 * facts come from — and together with the stdin rule it scored past the branch ceiling the
 * `cognitive-complexity` gate keeps.
 *
 * @param sources every field of the invocation that names where a section's facts come from
 * @returns the operator-facing refusal, or undefined when every flag has what it reads
 */
function companionRefusal({ sources }: { sources: InvocationSources }): string | undefined {
  if (sources.openPrs && sources.yourListSource === undefined) {
    return "--open-prs reads the same document --your-list does, so it needs --your-list <path|-> too";
  }
  if (sources.openPageCards && sources.openArtifactsSource === undefined) {
    return (
      "--open-page-cards builds one card per page out of the same document the ranked index reads, so it " +
      "needs --open-artifacts <path|-> too"
    );
  }
  if (sources.wantsQuiz && sources.sweep === undefined) {
    return (
      "--knowledge-quiz reads ONE sweep's recorded question, so it needs --sweep <tick-id> too. Cut the " +
      "question first with `slopweaver knowledge quiz --sweep <tick-id>`."
    );
  }
  if (sources.sweep !== undefined && !sources.wantsQuiz) {
    return "--sweep names the sweep whose question to render, so it means nothing without --knowledge-quiz";
  }
  if (sources.ticksPriorDays !== undefined && sources.ticksSource === undefined) {
    return "--ticks-days bounds how far back the projected narrative reaches, so it means nothing without --ticks <path|->";
  }
  return undefined;
}

/**
 * Read every source-naming flag off the parsed values.
 *
 * Its own step so {@link parseBriefingRenderArgs} reads as parse-check-build rather than carrying a dozen
 * string narrowings inline — the shape the `cognitive-complexity` gate counts.
 *
 * @param values the parsed flag values
 * @param ticksPriorDays the already-validated `--ticks-days`, absent for the reader's own ceiling
 * @returns every field of the invocation that names where a section's facts come from
 */
function readSources({
  values,
  ticksPriorDays,
}: {
  values: Record<string, string | boolean | undefined>;
  ticksPriorDays: number | undefined;
}): InvocationSources {
  const text = ({ flag }: { flag: string }): string | undefined =>
    typeof values[flag] === "string" ? values[flag] : undefined;
  return {
    autonomyLedger: values["autonomy-ledger"] === true,
    freshness: values["freshness"] === true,
    nothingStale: values["nothing-stale"] === true,
    openArtifactsSource: text({ flag: "open-artifacts" }),
    openPageCards: values["open-page-cards"] === true,
    openPrs: values["open-prs"] === true,
    sweep: text({ flag: "sweep" }),
    ticksPriorDays,
    ticksSource: text({ flag: "ticks" }),
    wantsQuiz: values["knowledge-quiz"] === true,
    yourListSource: text({ flag: "your-list" }),
  };
}

/**
 * Parse `briefing render`'s argv tail.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseBriefingRenderArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<BriefingRenderArgs, BriefingCommandError> {
  const parsed = parseFlags({ args: rest, spec: BRIEFING_RENDER_FLAGS });
  if (parsed.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const formSource = typeof values["form"] === "string" ? values["form"] : undefined;
  if (formSource === undefined) {
    return err(BriefingCommandErrors.formFlagMissing({ verb: "render" }));
  }
  const top = parseTopRows({ raw: values["top"] });
  if (top.isErr()) {
    return err(top.error);
  }
  const ticksPriorDays = parseTickDays({ raw: values["ticks-days"] });
  if (ticksPriorDays.isErr()) {
    return err(ticksPriorDays.error);
  }
  const sources = readSources({ ticksPriorDays: ticksPriorDays.value, values });
  const ownerBeliefs = values["owner-beliefs"] === true;
  const handSteps = values["hand-steps"] === true;
  const conflict = sourceConflict({ formSource, sources });
  if (conflict !== undefined) {
    return err(BriefingCommandErrors.sourcesConflict({ reason: conflict }));
  }
  return ok({
    ...sources,
    formSource,
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    out: typeof values["out"] === "string" ? values["out"] : undefined,
    handSteps,
    ownerBeliefs,
    quizSweep: sources.wantsQuiz ? sources.sweep : undefined,
    top: top.value,
  });
}
