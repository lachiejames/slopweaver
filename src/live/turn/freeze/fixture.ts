/**
 * What a frozen turn REPLAY FIXTURE is, on disk — the manifest, the event selection, and the one
 * substitution that makes a committed fixture relocatable.
 *
 * A fixture is a state home with everything but ONE ask's record set removed, redacted by
 * `./redact.ts`, and a `fixture.json` beside it saying what was kept, what was withheld and at which
 * instant the replay must judge it. The replay lane materialises it into a throwaway home and runs the real
 * verbs against that — see `.claude/rules/testing.md` § the replay lane.
 *
 * Pure: every function here takes text and returns text. Reading and writing is `../../../cli/commands/turn/freeze.ts`.
 */
import { z } from "zod";

import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { HOME_PLACEHOLDER } from "./redact.js";

/** The manifest layout version. Bump only alongside a reader that understands both. */
export const FIXTURE_SCHEMA_VERSION = 1;

/** The manifest file's name inside a fixture directory. */
export const FIXTURE_MANIFEST_FILE = "fixture.json";

/** The sub-directory a fixture's redacted state home lives in. */
export const FIXTURE_HOME_DIR = "home";

/** Everything a replay needs to know about one frozen incident, without reading the incident itself. */
export interface FixtureManifest {
  readonly schemaVersion: number;
  /** The fixture's own slug — its directory name, and what a test names it by. */
  readonly slug: string;
  /** What went wrong, in the freezer's own words. Free prose; never machine-read. */
  readonly incident: string;
  /**
   * Which `docs/recurring-failure-register.md` classes this fixture regresses — the register side of the
   * join, so a failure class can say which frozen incident holds it down and a fixture can say what it is
   * really about.
   *
   * REQUIRED and possibly EMPTY rather than optional. Optional would give three states — absent, `undefined`
   * and `[]` — for a two-state question, and under `exactOptionalPropertyTypes` it would force the same
   * `...(x === undefined ? {} : { x })` spread `through` already needs at its one construction site. Empty
   * is the common and correct answer: most frozen turns are not instances of a named register class, and a
   * forced declaration would be filler.
   *
   * Freezer-supplied, from a CLOSED vocabulary the register commits — unlike `incident`, which is free prose
   * and is therefore redacted. A class name cannot carry a private id, so this field is deliberately NOT put
   * through `./redact.ts`: redacting it would map id-shaped substrings to synthetics and destroy the join it
   * exists for. `turn freeze --regresses` refuses a value the register does not carry.
   */
  readonly regresses: readonly string[];
  /**
   * The frozen ask, in its SYNTHETIC identity — the real one is not recoverable from here.
   *
   * Synthetic ids are referential WITHIN one fixture and meaningless across two: each freeze mints its own
   * map in first-appearance order, so `U_FIXTURE_02` in one fixture and `U_FIXTURE_02` in another are not
   * the same person, and nothing should ever join them.
   */
  readonly ask: {
    readonly channel: string;
    readonly messageTs: string;
    readonly threadTs: string;
    /** Who addressed the bot — the `captured` event's own `userId`, or `(absent)` when it was never captured. */
    readonly askedBy: string;
  };
  /** When the freeze ran. */
  readonly frozenAtIso: string;
  /**
   * The instant a replay must judge this fixture at — the last kept event's own timestamp.
   *
   * A fixture is a frozen world, so the real clock is the wrong oracle for it: every lease in a record set
   * expires the moment the fixture is a day old, and a replay judged by the wall clock would report
   * `lease-expired` for every ask it ever holds. Derived rather than chosen — the last event's time is by
   * construction inside the lease that event opened.
   *
   * `turn freeze --not-after <iso>` overrides that derivation, because a defect that fires between two
   * lifecycle events leaves no row to derive from. When it is given, this is that instant.
   */
  readonly replayNowIso: string;
  /**
   * The lifecycle kind the freeze stopped at, when `--through` was given.
   *
   * Absent means the whole log was kept. Present means the fixture is the state at the moment BEFORE the
   * defect fired, which is what makes replaying the real verb over it a test of the fix rather than of the
   * bug's own output.
   */
  readonly through?: string | undefined;
  /** The kinds of the events `--through` and `--not-after` dropped, in log order. The withheld half, stated. */
  readonly withheldEventKinds: readonly string[];
  /** Every file in the fixture home, fixture-relative, in write order. */
  readonly files: readonly string[];
  /** How many distinct real ids the freeze mapped to synthetics. Never the map itself. */
  readonly syntheticIdCount: number;
  /**
   * How many review rounds THIS FIXTURE carries — one per verdict file in it, `0` when it carries none.
   *
   * Counted off the frozen file list rather than off the live review directory, and the difference is not
   * academic: a fixture cut with `--not-after` deliberately withholds every round that ran after the
   * instant it names, so the ask's own round count and the fixture's are different numbers. Measured on ask
   * `C0SYN000008/1789046247.801199` — four rounds on disk, two in the fixture, and this field announced
   * four. A manifest is the one thing a replay reads before trusting anything, so a count it takes from
   * somewhere the fixture does not is worse than no count.
   */
  readonly reviewRounds: number;
  /** Files deliberately NOT frozen, and why — prose the next reader needs. */
  readonly excluded: readonly string[];
}

/**
 * The strict parse-edge schema for a fixture manifest.
 *
 * @internal
 */
export const fixtureManifestSchema = z
  .object({
    ask: z
      .object({
        askedBy: z.string().min(1),
        channel: z.string().min(1),
        messageTs: z.string().min(1),
        threadTs: z.string().min(1),
      })
      .strict(),
    excluded: z.array(z.string().min(1)).readonly(),
    files: z.array(z.string().min(1)).readonly(),
    frozenAtIso: z.string().min(1),
    incident: z.string().min(1),
    regresses: z.array(z.string().min(1)).readonly(),
    replayNowIso: z.string().min(1),
    reviewRounds: z.number().int().min(0),
    schemaVersion: z.literal(FIXTURE_SCHEMA_VERSION),
    slug: z.string().min(1),
    syntheticIdCount: z.number().int().min(0),
    through: z.string().min(1).optional(),
    withheldEventKinds: z.array(z.string().min(1)).readonly(),
  })
  .strict() satisfies z.ZodType<FixtureManifest>;

/**
 * Parse an already-decoded fixture manifest.
 *
 * @param value the decoded JSON value
 * @returns the validated manifest, or every schema violation
 */
export function parseFixtureManifest({ value }: { value: unknown }): Result<FixtureManifest> {
  const parsed = fixtureManifestSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(parsed.error.issues.map((issue) => issue.message));
}

/**
 * One ask-lifecycle log line, kept as raw text so a freeze never has to understand every event kind.
 *
 * @internal
 */
export interface SelectedEvents {
  /** The lines belonging to this ask, in log order, up to and including `--through`. */
  readonly kept: readonly string[];
  /** The `kind` of every line dropped after `--through`, in log order. */
  readonly withheldKinds: readonly string[];
}

/**
 * Select one ask's own lifecycle lines out of the whole append-only log, optionally truncating after the
 * last event of a named kind.
 *
 * Truncation is what makes a fixture a REPLAY fixture rather than a recording. Freezing the
 * dispatch-orphan ask whole would carry the `dispatch-failed` the pre-fix code wrote, and replaying today's
 * sweep over that only proves the sweep can read a bad event. Freezing it through `dispatched` carries the
 * state at the moment before the defect fired, and the real verb's behaviour over THAT is the thing under
 * test.
 *
 * `notAfter` is the other half of the same idea, for a defect that fired BETWEEN two lifecycle events rather
 * than at one. A worker session that dies mid-response writes no row at all, so no `--through` kind can name
 * the moment before it — measured on ask `C0SYN000008/1789046247.801199`, which has four rows and died 49
 * minutes after the third. Both cuts apply when both are given, and both report what they withheld.
 *
 * @param text the whole `asks.jsonl`
 * @param channel the ask's channel id, as it appears on disk
 * @param messageTs the ask's addressing message timestamp
 * @param notAfter drop every line whose own `tsIso` is later than this instant, or `undefined` for no such cut
 * @param through the last lifecycle kind to keep, or `undefined` to keep every line
 * @returns the kept lines and the kinds withheld after them
 */
export function selectAskEvents({
  text,
  channel,
  messageTs,
  notAfter,
  through,
}: {
  text: string;
  channel: string;
  messageTs: string;
  notAfter?: string | undefined;
  through: string | undefined;
}): SelectedEvents {
  const mine = text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => {
      const value: unknown = safeJson({ line });
      return isRecord(value) && value["channel"] === channel && value["messageTs"] === messageTs;
    });
  const byKind = truncateAtKind({ lines: mine, through });
  const cut = truncateAtInstant({ lines: byKind.kept, notAfter });
  return { kept: cut.kept, withheldKinds: [...cut.withheldKinds, ...byKind.withheldKinds] };
}

/**
 * The `--through` half of {@link selectAskEvents}: keep up to and including the last line of a named kind.
 *
 * @param lines the ask's own lines, in log order
 * @param through the last lifecycle kind to keep, or `undefined` to keep every line
 * @returns the kept lines and the kinds withheld after them
 */
function truncateAtKind({ lines, through }: { lines: readonly string[]; through: string | undefined }): SelectedEvents {
  if (through === undefined) {
    return { kept: lines, withheldKinds: [] };
  }
  const lastIndex = lines.findLastIndex((line) => kindOf({ line }) === through);
  if (lastIndex === -1) {
    return { kept: lines, withheldKinds: [] };
  }
  return {
    kept: lines.slice(0, lastIndex + 1),
    withheldKinds: lines.slice(lastIndex + 1).map((line) => withheldKindOf({ line })),
  };
}

/** The model id a projected predecessor carries — it says what the record IS rather than naming a model. */
const PROJECTED_MODEL_ID = "projected-predecessor";

/**
 * One ANSWERED completion of another ask in the same thread, rebuilt from named fields only.
 *
 * **A predecessor line is PROJECTED, never copied, and that is the rule rather than a precaution.** Every
 * other line a fixture keeps belongs to the ask being frozen, so the freeze's own `--through`/`--not-after`
 * window and the operator's judgement already bound what is in it. A predecessor belongs to somebody else's
 * turn: keeping its bytes would carry that turn's `secondaryFailures` prose and whatever its `provenance`
 * happened to hold into a git-tracked file nobody reviewed for it. So this rebuilds the record out of the
 * six fields a supersession replay actually reads (`../supersession/completionReader.ts`) and drops the
 * rest — `secondaryFailures` becomes the empty list rather than being carried, because a diagnostic about
 * an unrelated turn is not a fact this fixture is about.
 *
 * It keeps only the ANSWERED arm, for the same reason: an answer is the only thing a correction can
 * supersede, so a withheld or failed predecessor would be bytes with no replay that reads them.
 */
function projectedPredecessorLine({
  channel,
  line,
  threadTs,
}: {
  channel: string;
  line: string;
  threadTs: string;
}): string | undefined {
  const value: unknown = safeJson({ line });
  const completion = isRecord(value) ? value["completion"] : undefined;
  const askIdentity = isRecord(completion) ? completion["askIdentity"] : undefined;
  const primary = isRecord(completion) ? completion["primary"] : undefined;
  if (!isRecord(value) || !isRecord(completion) || !isRecord(askIdentity) || !isRecord(primary)) {
    return undefined;
  }
  if (askIdentity["channel"] !== channel || askIdentity["threadTs"] !== threadTs) {
    return undefined;
  }
  if (primary["kind"] !== "answered" || typeof primary["answerTs"] !== "string") {
    return undefined;
  }
  return JSON.stringify({
    completion: {
      askIdentity: {
        channel: askIdentity["channel"],
        messageTs: askIdentity["messageTs"],
        threadTs: askIdentity["threadTs"],
      },
      primary: { answerTs: primary["answerTs"], kind: "answered" },
      // A CONSTANT, not the predecessor's own model: `../envelope.ts`'s parse requires a string here and
      // nothing a supersession judges reads it (`../supersession/completionReader.ts` projects four fields,
      // and this is not one). `modelId` is absent from the redactor's allowlist anyway, so forwarding the
      // real one would only produce `[REDACTED]` while implying the fixture carries a fact it does not.
      provenance: { modelId: PROJECTED_MODEL_ID },
      secondaryFailures: [],
      turnId: completion["turnId"],
      workingTs: completion["workingTs"],
    },
    kind: "turn-completed",
    schemaVersion: 1,
    tsIso: value["tsIso"],
  });
}

/**
 * One ask's own lines out of the shared turn-completion ledger, plus the answered turns it may SUPERSEDE,
 * cut at the freeze's window.
 *
 * The ledger is the second shared append-only log a fixture rewrites rather than copies, for the reason
 * `asks.jsonl` is: it holds every turn on the machine. It is the ONLY record of the cards a non-answered turn
 * left in its thread — a working checklist's `workingTs`, a failure or held notice's `noticeTs` — which is what
 * `../earlierCards.ts` reaps once an answer posts. A fixture without it could replay the incident
 * only as a thread with nothing standing in it.
 *
 * **`threadTs` widens it to the THREAD, and only for answered predecessors.** A correction is routinely a new
 * tag — its own `messageTs` — replying where an earlier tag was answered, so the answer it supersedes was
 * recorded against a DIFFERENT ask and the ask-keyed filter above cannot see it. Without those rows a replay
 * of a correction turn refuses every supersession on `NO_SUCH_ANSWER` and proves nothing. Passing `undefined`
 * keeps the original ask-only behaviour exactly, which is what every freeze that is not about a correction
 * wants. What crosses the boundary is bounded by {@link projectedPredecessorLine}, not by trust.
 *
 * Cut by the event's own `tsIso` against the window {@link selectAskEvents} closed, never by `--through`
 * directly: a completion has no lifecycle kind, and the instant is the fact both logs share. The cut applies
 * to a predecessor exactly as it does to the ask's own line — a fixture must not carry an answer that had
 * not been posted yet at the moment it claims to hold.
 *
 * @param text the raw completion ledger
 * @param channel the ask's channel, as it appears on disk
 * @param messageTs the ask's addressing timestamp
 * @param threadTs the thread whose answered turns may also be kept, PROJECTED; absent keeps only this ask's
 * @param notAfterIso the instant this freeze's window closes at
 * @returns the kept lines, in ledger order
 */
export function selectCompletionLines({
  text,
  channel,
  messageTs,
  threadTs,
  notAfterIso,
}: {
  text: string;
  channel: string;
  messageTs: string;
  threadTs?: string | undefined;
  notAfterIso: string;
}): readonly string[] {
  const closes = Date.parse(notAfterIso);
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => Number.isNaN(closes) || !afterInstant({ closes, line }))
    .flatMap((line) => {
      const value: unknown = safeJson({ line });
      const completion = isRecord(value) ? value["completion"] : undefined;
      const askIdentity = isRecord(completion) ? completion["askIdentity"] : undefined;
      const mine =
        isRecord(askIdentity) && askIdentity["channel"] === channel && askIdentity["messageTs"] === messageTs;
      if (mine) {
        return [line];
      }
      if (threadTs === undefined) {
        return [];
      }
      const projected = projectedPredecessorLine({ channel, line, threadTs });
      return projected === undefined ? [] : [projected];
    });
}

/**
 * Whether a DURABLE file recording an event of `markerKind` belongs to the half of the incident `--through`
 * cut off.
 *
 * `--through` truncates the append-only lifecycle log, but a turn's durable files are separate documents
 * that are simply COPIED, and several of them are written by the very ending the truncation exists to
 * exclude. Measured on the `rewrite-after-clean-verdict-loses-the-lease` freeze: `--through dispatched`
 * withheld the `failed` lifecycle event and then copied the ask's turn-marker file, which reads
 * `"kind": "failed"` — so the fixture claimed to be the state before the defect fired while carrying the
 * marker the defect wrote. Two replay lanes already work around that by hand-clearing the marker after
 * materialising, which is the workaround this closes.
 *
 * The turn marker is the one durable file that declares a lifecycle-shaped `kind` of its own, so this is a
 * test it can answer directly rather than a heuristic over timestamps.
 *
 * @param markerKind the `kind` the durable file declares, or `undefined` when it declares none
 * @param withheldKinds the lifecycle kinds `--through` dropped, from {@link selectAskEvents}
 * @returns whether the file records something this freeze deliberately cut off
 */
export function recordsAWithheldKind({
  markerKind,
  withheldKinds,
}: {
  markerKind: string | undefined;
  withheldKinds: readonly string[];
}): boolean {
  return markerKind !== undefined && withheldKinds.includes(markerKind);
}

/**
 * The `--not-after` half of {@link selectAskEvents}: drop every line stamped later than an instant.
 *
 * A line that declares no readable `tsIso` is KEPT. The alternative — dropping what cannot be dated — would
 * quietly shrink a fixture on a record shape this cut was never about, and the conservative answer matches
 * what `turn freeze`'s own file windowing does with an undated file.
 *
 * @param lines the ask's own lines, in log order
 * @param notAfter the instant the window closes at, or `undefined` for no cut
 * @returns the kept lines and the kinds withheld after them
 */
function truncateAtInstant({
  lines,
  notAfter,
}: {
  lines: readonly string[];
  notAfter: string | undefined;
}): SelectedEvents {
  if (notAfter === undefined) {
    return { kept: lines, withheldKinds: [] };
  }
  const closes = Date.parse(notAfter);
  if (Number.isNaN(closes)) {
    return { kept: lines, withheldKinds: [] };
  }
  const kept: string[] = [];
  const withheldKinds: string[] = [];
  for (const line of lines) {
    if (afterInstant({ closes, line })) {
      withheldKinds.push(withheldKindOf({ line }));
      continue;
    }
    kept.push(line);
  }
  return { kept, withheldKinds };
}

/**
 * Whether one log line is stamped later than the instant a window closes at.
 *
 * A line that declares no readable `tsIso` is NOT after it — see {@link truncateAtInstant} for why an
 * undated line is kept rather than dropped. Written as an `if` on the absent case rather than as a coalesce
 * into an empty string, which is a substitution nobody reading the comparison would see.
 *
 * @param closes the window's closing instant, already parsed to epoch milliseconds
 * @param line the raw JSONL line
 * @returns whether this line falls outside the window
 */
function afterInstant({ closes, line }: { closes: number; line: string }): boolean {
  const declared = stampOf({ line });
  if (declared === undefined) {
    return false;
  }
  const stamp = Date.parse(declared);
  return !Number.isNaN(stamp) && stamp > closes;
}

/**
 * The kind a withheld line is REPORTED under — its own `kind`, or the stated stand-in for a line that
 * declares none. The stand-in is named by an `if` here rather than coalesced at each of the two call sites,
 * so a reader sees that a substitution happens at all.
 *
 * @param line the raw JSONL line
 * @returns the kind to record in `withheldEventKinds`
 */
function withheldKindOf({ line }: { line: string }): string {
  const kind = kindOf({ line });
  if (kind === undefined) {
    return "(unparseable)";
  }
  return kind;
}

/**
 * One log line's own `tsIso`, or `undefined` when the line will not parse or declares none.
 *
 * @param line the raw JSONL line
 * @returns the event's instant
 */
function stampOf({ line }: { line: string }): string | undefined {
  const value: unknown = safeJson({ line });
  if (!isRecord(value)) {
    return undefined;
  }
  const stamp = value["tsIso"];
  return typeof stamp === "string" ? stamp : undefined;
}

/**
 * One log line's `kind`, or `undefined` when the line will not parse or declares none.
 *
 * @param line the raw JSONL line
 * @returns the event kind
 */
export function kindOf({ line }: { line: string }): string | undefined {
  const value: unknown = safeJson({ line });
  if (!isRecord(value)) {
    return undefined;
  }
  const kind = value["kind"];
  return typeof kind === "string" ? kind : undefined;
}

/**
 * `JSON.parse` that answers `undefined` rather than throwing — a malformed line in an append-only log is an
 * ordinary thing to skip, not an error to abort a freeze on.
 *
 * @param line the raw text
 * @returns the parsed value, or `undefined`
 */
function safeJson({ line }: { line: string }): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/**
 * Put a real home back where the freeze wrote {@link HOME_PLACEHOLDER} — the materialisation half of the
 * relocatable-fixture trick.
 *
 * @param text the frozen file's contents
 * @param home the absolute path of the throwaway home this fixture is being materialised into
 * @returns the contents with every placeholder resolved
 */
export function substituteHome({ text, home }: { text: string; home: string }): string {
  return text.split(HOME_PLACEHOLDER).join(home);
}
