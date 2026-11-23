/**
 * THE PRUNER: which board rows still earn their keep, and which the register has already decided are done.
 *
 * The rule: backlogs drift from reality because nobody re-reads the whole backlog when work is done, so when
 * work is done the board is swept to update every skill and to prune whatever is irrelevant or superseded, and
 * the pruning is aggressive about deleting what provides no value. The top-priority list is never taken as a
 * queue while it is stale; the pruning lands first and trims it down.
 *
 * ## The measurement that decided the design, and it is not the one the rule implies
 *
 * The obvious reading is that board drift is a property of ROWS — dated, duplicated, superseded — and that
 * the fix is a text heuristic. Measured, it is overwhelmingly a property of READERS.
 *
 * MEASURED over the 121 p0 rows a status page rendered as "waiting" and offered the owner as the fleet's
 * queue: **113 carry `settlement: answered`**, and **111 of those were already settled on disk before that
 * page was published**. The queue the owner was handed was ~92% finished work.
 * Reproduce by resolving each slug in that page's `<ol class=p0>` against its own front-matter:
 * `grep -c '^settlement:' ~/.slopweaver/handovers/<slug>.md`, and compare each file's mtime against the
 * page's own `index.html`.
 *
 * {@link ./derivedRowState.ts} names the cause in its own header: two readers of one row give different
 * answers, because every cheaper reader filters on the `status:` LINE and that line is never written by
 * anything — measured at 25 such rows one day and 60 the next, and 111 on one priority band alone. The derivation exists; the pruner is the reader that moves onto it.
 *
 * So this module's first job is to be the ONE reader that answers "what is actually left" off the derived
 * state, and only its small tail is text judgement.
 *
 * ## Conclusive and candidate are different TYPES, not a confidence score
 *
 * That split is the whole safety property. A pruner that settles on a text heuristic and is believed is worse
 * than the drift it replaces: today a stale row costs a reader thirty seconds, while a pruner that closes
 * `ten-more-vulnerability-prs-3-mar` because the slug ends in a past date costs the owner work they asked
 * for, silently, behind a machine-written witness that reads convincingly.
 *
 * `ten-more-vulnerability-prs-3-mar` and `people-waiting-on-the-owner-3-mar-and-every-open-ask` are
 * the pair that proves no syntactic rule can separate them: both name the same day, both were asked on it. The
 * first is day-STAMPED — ten dependency pull requests are as deliverable today as they were then. The second
 * is day-SCOPED — a picture of one day, undeliverable later. Only a session can tell, so
 * {@link PRUNE_EXPIRED_DAY_SCOPE} computes the CANDIDATE and never the act. That is the aggression the rule
 * asks for done honestly: propose hard and cheaply where otherwise nobody re-reads the backlog at all.
 *
 * ## Two rails above every rule
 *
 * A row carrying an owner `ruling`, and a row `paused` on a person, are never pruned — the owner's word outranks the
 * rule, and "paused on someone is a state, not a countdown". Both read {@link PRUNE_KEEP} naming that as the
 * reason, so the survivor list says WHY each survivor survived rather than just listing it.
 *
 * ## Why there is no actuator here, unlike `./reap.ts`
 *
 * `reap.ts`'s header names "a detector with no actuator" as the defect it existed to fix, so the absence is a
 * decision rather than an omission. The 111-row class needs no actuator at all — those rows are already
 * terminal and the defect was the reader, which this module IS the fix for. The performable class needs a
 * `settlement:`, and `handover settle` already writes one behind two gates a session must not bypass (the
 * lessons gate and the checks-read gate, `../cli/commands/handover/lessonsGate.ts` and `./checksReadGate.ts`).
 * Re-implementing the write here would weaken both, so each performable verdict carries the `settle` command
 * instead, as `performWith` on the conclusive arm of {@link PruneVerdict}. It is never given a `--card`: a relay
 * row about an open hand card needs a disposition only a session can judge, so settle refuses it and names the card.
 *
 * Pure: takes already-composed candidates and an explicit `nowIso`. No filesystem, no clock, no I/O.
 */

import type { BoardSection, RunDisposition } from "./boardTypes.js";
import type { DerivedRowState } from "./derivedRowState.js";
import type { DocStatus } from "./doc.js";
import { pruneSettleLine } from "./pruneSettleLine.js";
import type { RelayTakenUp } from "./relayTakenUp.js";
import type { BoardPriority, BoardRowKind } from "./rowKind.js";
import { rulingAnchor } from "./ruling.js";

/** The register has already decided this row: nothing to perform, it simply is not live work. */
export const PRUNE_SETTLED = "settled";
/** A `closed` event says the work shipped, and the ask row never got the settlement that takes it off. */
export const PRUNE_SHIPPED_UNSETTLED = "shipped-unsettled";
/** A voice relay row the chair already took up — a row cut from it, or its intake mark — never settled. */
export const PRUNE_RELAY_TAKEN_UP = "relay-taken-up";
/** The slug names a day that has passed, and that day is when the row was asked — a DAY-SCOPED deliverable. */
export const PRUNE_EXPIRED_DAY_SCOPE = "expired-day-scope";
/** The slug is another row's slug plus a trailing numeral, and that base row is already terminal. */
export const PRUNE_DUPLICATE_SIBLING = "duplicate-sibling";
/** Nothing fired: this row is a survivor, and the witness says why it survived. */
export const PRUNE_KEEP = "keep";

/** Every verdict this engine can reach, in the order its rules are asked. */
export const PRUNE_VERDICT_KINDS = [
  PRUNE_SETTLED,
  PRUNE_SHIPPED_UNSETTLED,
  PRUNE_RELAY_TAKEN_UP,
  PRUNE_EXPIRED_DAY_SCOPE,
  PRUNE_DUPLICATE_SIBLING,
  PRUNE_KEEP,
] as const;

/** One verdict this engine can reach. */
export type PruneVerdictKind = (typeof PRUNE_VERDICT_KINDS)[number];

/** The verdicts the REGISTER decided — the only ones an actuator may ever perform. */
type ConclusivePruneKind = typeof PRUNE_SETTLED | typeof PRUNE_SHIPPED_UNSETTLED | typeof PRUNE_RELAY_TAKEN_UP;

/** Every verdict a rule reached by reading TEXT, plus the survivor — none of them performable. */
type CandidatePruneKind = typeof PRUNE_EXPIRED_DAY_SCOPE | typeof PRUNE_DUPLICATE_SIBLING | typeof PRUNE_KEEP;

/** One board row offered to the pruner, with everything the decision needs already composed. */
export interface PruneCandidate {
  readonly slug: string;
  readonly rowKind: BoardRowKind;
  readonly priority: BoardPriority;
  /** When the owner asked for it. Absent on an ordinary doc row, which is why day-scope cannot judge one. */
  readonly askedIso: string | undefined;
  /** The row's own `status:` line — read ONLY to spot the paused rail, never to decide whether it is live. */
  readonly authoredStatus: DocStatus;
  readonly derived: DerivedRowState;
  readonly run: RunDisposition;
  readonly section: BoardSection;
  /**
   * What the chair's own registers say became of this row when it is a voice relay — composed by the caller, which
   * reads the intake ledger, so this core stays pure. Undefined for every other row and for a relay nothing took up.
   */
  readonly relayTakenUp: RelayTakenUp | undefined;
}

/** The fields both arms of {@link PruneVerdict} carry, whatever decided them. */
interface PruneVerdictCommon {
  readonly slug: string;
  /**
   * The checkable thing behind the verdict — a settlement and its witness, a closed event's summary and
   * instant, the two dates that fired the day-scope rule, or the base slug and its terminal.
   *
   * Never optional and never empty: a bare verdict is the unfalsifiable output that makes a reader stop
   * reading, and `cross-session-messages.md` § "Anchoring a fact" is the rule it would break.
   */
  readonly witness: string;
}

/**
 * What the pruner decided about one row, and the checkable thing behind it.
 *
 * **A DISCRIMINATED UNION on `conclusive`, not a record with a boolean field on it**, and that is the whole
 * safety property expressed where a reader cannot miss it. The first draft of this type carried `conclusive:
 * boolean` beside a `performWith` that was populated on candidate verdicts too — so the invariant "only a
 * register-decided verdict is performable" lived in rule ORDER rather than in the type, and a caller filtering
 * on `performWith` instead of on `conclusive` would have acted on a text rule without changing a line of this
 * file. The review pass on this very diff found exactly that: the verb's own PERFORM block filtered on
 * `performWith` and printed a copy-pasteable `settle` command for an `expired-day-scope` row.
 *
 * Now the field does not exist on the candidate arm at all. A candidate carries `proposeWith` — the same
 * command text, named for what it is — so an actuator reaching for `performWith` cannot see one, and adding a
 * flag that performs a candidate means editing this union rather than forgetting to.
 */
export type PruneVerdict =
  /** The register decided this row. `performWith` is absent when there is nothing left to perform. */
  | (PruneVerdictCommon & {
      readonly conclusive: true;
      readonly kind: ConclusivePruneKind;
      readonly performWith: string | undefined;
    })
  /** A rule read text, or nothing fired. Never performable — the command is a PROPOSAL a session weighs. */
  | (PruneVerdictCommon & {
      readonly conclusive: false;
      readonly kind: CandidatePruneKind;
      readonly proposeWith: string | undefined;
    });

/** What one pass over the board decided, with the rows it could not judge counted rather than dropped. */
export interface PrunePass {
  readonly verdicts: readonly PruneVerdict[];
  /** The survivors, in the order the candidates arrived — the trimmed board this whole verb exists to print. */
  readonly survivors: readonly PruneVerdict[];
  /** How many rows each verdict claimed, keyed by kind, every kind present even at zero. */
  readonly counts: Readonly<Record<PruneVerdictKind, number>>;
  /** How many candidates arrived, so a reader can check the counts add up rather than trust them. */
  readonly considered: number;
}

/** Month names as a slug spells them, index 0 = January — the table {@link dayNamedInSlug} reads. */
const SLUG_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

/** How many days may separate a slug's named day from the row's asked day and still read as day-SCOPED. */
const DAY_SCOPE_TOLERANCE_DAYS = 2;

/** One day in milliseconds, so the tolerance above is stated in days and compared in millis. */
const MS_PER_DAY = 86_400_000;

/**
 * The largest trailing numeral a slug may carry and still read as a sibling rather than as a turn id.
 *
 * The regex below captures `\d+` rather than a single digit ON PURPOSE, so this bound is the thing that
 * decides and not a side effect of the pattern: the first draft captured `(\d)` and left the `> MAX` half of
 * the guard unreachable, which the review pass on this diff caught. A check that cannot fire reads exactly
 * like a check that does.
 */
const MAX_SIBLING_ORDINAL = 9;

/**
 * The calendar day a slug names, resolved into the year the row was asked in.
 *
 * The year comes from `askedIso` rather than from the slug, because no slug on this board carries one: the
 * shape the fleet writes is `…-8-sep`, `…-17-sep`. A day in the same month as the ask is the same year as the
 * ask; the tolerance check in {@link dayScopeWitness} is what stops a December/January pair being compared
 * across a boundary, since two days that far apart never satisfy it.
 *
 * @param slug the row's slug
 * @param askedIso when the row was asked, supplying the year
 * @returns the named day's epoch millis at UTC midnight, or undefined when the slug names no day
 */
function dayNamedInSlug({ slug, askedIso }: { slug: string; askedIso: string }): number | undefined {
  const match = /(?:^|-)(\d{1,2})-([a-z]{3})(?:-|$)/.exec(slug);
  if (match === null) {
    return undefined;
  }
  const dayText = match[1];
  const monthText = match[2];
  if (dayText === undefined || monthText === undefined) {
    return undefined;
  }
  const monthIndex = SLUG_MONTHS.findIndex((month) => month === monthText);
  if (monthIndex < 0) {
    return undefined;
  }
  const day = Number.parseInt(dayText, 10);
  if (day < 1 || day > 31) {
    return undefined;
  }
  const asked = Date.parse(askedIso);
  if (Number.isNaN(asked)) {
    return undefined;
  }
  return Date.UTC(new Date(asked).getUTCFullYear(), monthIndex, day);
}

/**
 * The day-scope witness for a row, or undefined when the rule does not fire.
 *
 * Two conditions, and both are load-bearing. The named day must have ENDED, or there is nothing expired
 * about it — `named` is that day's opening midnight, so a row naming today is still live until the next one.
 * And it must sit within {@link DAY_SCOPE_TOLERANCE_DAYS} of the ask, which is what makes the row a
 * candidate for having been about that day rather than merely stamped with it — a slug naming a date weeks
 * off its ask is citing something, not scoping itself.
 *
 * @param slug the row's slug
 * @param askedIso when the row was asked
 * @param nowIso the instant the pass is judged at
 * @returns the witness naming both days, or undefined
 */
function dayScopeWitness({
  slug,
  askedIso,
  nowIso,
}: {
  slug: string;
  askedIso: string;
  nowIso: string;
}): string | undefined {
  const named = dayNamedInSlug({ askedIso, slug });
  const now = Date.parse(nowIso);
  const asked = Date.parse(askedIso);
  if (named === undefined || Number.isNaN(now) || Number.isNaN(asked)) {
    return undefined;
  }
  if (named + MS_PER_DAY > now) {
    return undefined;
  }
  if (Math.abs(named - asked) > DAY_SCOPE_TOLERANCE_DAYS * MS_PER_DAY) {
    return undefined;
  }
  const namedDay = new Date(named).toISOString().slice(0, 10);
  const askedDay = new Date(asked).toISOString().slice(0, 10);
  return `the slug names ${namedDay}, asked ${askedDay}, now ${nowIso.slice(0, 10)} — day-scoped and that day has passed`;
}

/** Whether a row is terminal enough to make a numbered sibling of it a duplicate candidate. */
function isTerminal({ candidate }: { candidate: PruneCandidate }): boolean {
  if (candidate.derived.settlement !== undefined) {
    return true;
  }
  return candidate.run.kind === "closed";
}

/**
 * The duplicate-sibling witness for a row, or undefined when the rule does not fire.
 *
 * The base row must be ON THE BOARD and already terminal, and that requirement is what makes a text rule
 * safe here: dozens of slugs end in a numeral that is a turn id (`…-<turn>-<item>`), and stripping it
 * yields a base slug no row claims, so the rule never fires on one.
 *
 * @param candidate the row being judged
 * @param bySlug every candidate in the pass, keyed by slug
 * @returns the witness naming the base row and its terminal, or undefined
 */
function siblingWitness({
  candidate,
  bySlug,
}: {
  candidate: PruneCandidate;
  bySlug: ReadonlyMap<string, PruneCandidate>;
}): string | undefined {
  const match = /^(.+)-(\d+)$/.exec(candidate.slug);
  if (match === null) {
    return undefined;
  }
  const base = match[1];
  const ordinalText = match[2];
  if (base === undefined || ordinalText === undefined) {
    return undefined;
  }
  const ordinal = Number.parseInt(ordinalText, 10);
  if (ordinal < 2 || ordinal > MAX_SIBLING_ORDINAL) {
    return undefined;
  }
  const baseRow = bySlug.get(base);
  if (baseRow === undefined || !isTerminal({ candidate: baseRow })) {
    return undefined;
  }
  const terminal =
    baseRow.derived.settlement === undefined ? "a closed event" : `settlement: ${baseRow.derived.settlement}`;
  return `base row ${base} is terminal (${terminal}) and this is sibling ${ordinal}`;
}

/** A survivor, carrying the reason it survived. The one verdict four separate rules all reach. */
function keepVerdict({ candidate, witness }: { candidate: PruneCandidate; witness: string }): PruneVerdict {
  return { conclusive: false, kind: PRUNE_KEEP, proposeWith: undefined, slug: candidate.slug, witness };
}

/**
 * What the REGISTER decided about this row, or undefined when it has decided nothing.
 *
 * Split out of {@link pruneVerdictOf} so the conclusive half — the only half an actuator may ever perform —
 * is one function a reader can check in full, and so the whole judge stays inside `max-function-lines`.
 */
function registerVerdictOf({ candidate }: { candidate: PruneCandidate }): PruneVerdict | undefined {
  const settlement = candidate.derived.settlement;
  if (settlement !== undefined) {
    const witness = candidate.derived.settlementWitness;
    const shown = witness === undefined ? "no witness recorded" : witness.slice(0, 120);
    return {
      conclusive: true,
      kind: PRUNE_SETTLED,
      performWith: undefined,
      slug: candidate.slug,
      witness: `settlement: ${settlement} — ${shown}`,
    };
  }
  if (candidate.run.kind === "closed" && candidate.rowKind === "ask") {
    const summary = candidate.run.summary;
    return {
      conclusive: true,
      kind: PRUNE_SHIPPED_UNSETTLED,
      performWith: pruneSettleLine({ slug: candidate.slug, summary }),
      slug: candidate.slug,
      witness: `closed ${candidate.run.atIso} — ${summary.slice(0, 120)}`,
    };
  }
  return undefined;
}

/** Whichever rail protects this row, or undefined when neither does. Both outrank every text rule below. */
function railVerdictOf({ candidate }: { candidate: PruneCandidate }): PruneVerdict | undefined {
  const ruling = candidate.derived.ruling;
  if (ruling !== undefined) {
    const anchor = rulingAnchor({ evidence: ruling });
    return keepVerdict({
      candidate,
      witness: `the owner ruled on this row (${anchor}) — their word outranks every rule below`,
    });
  }
  if (candidate.authoredStatus === "paused" || candidate.section === "PAUSED") {
    return keepVerdict({
      candidate,
      witness: "paused on a person — a state, not a countdown; the board remembers it",
    });
  }
  return undefined;
}

/** What a TEXT rule proposes about this row, or undefined when neither fires. Never conclusive. */
function textRuleVerdictOf({
  candidate,
  bySlug,
  nowIso,
}: {
  candidate: PruneCandidate;
  bySlug: ReadonlyMap<string, PruneCandidate>;
  nowIso: string;
}): PruneVerdict | undefined {
  const askedIso = candidate.askedIso;
  const expired = askedIso === undefined ? undefined : dayScopeWitness({ askedIso, nowIso, slug: candidate.slug });
  if (expired !== undefined) {
    return {
      conclusive: false,
      kind: PRUNE_EXPIRED_DAY_SCOPE,
      proposeWith: pruneSettleLine({ slug: candidate.slug, summary: expired }),
      slug: candidate.slug,
      witness: expired,
    };
  }
  const sibling = siblingWitness({ bySlug, candidate });
  if (sibling !== undefined) {
    return {
      conclusive: false,
      kind: PRUNE_DUPLICATE_SIBLING,
      proposeWith: pruneSettleLine({ slug: candidate.slug, summary: sibling }),
      slug: candidate.slug,
      witness: sibling,
    };
  }
  return undefined;
}

/**
 * Judge ONE board row, asking every rule in {@link PRUNE_VERDICT_KINDS} order and stopping at the first match.
 *
 * The order is the contract, and it is this function's whole content: the register decides first, because a
 * terminal row needs no protecting; then the two rails, because the owner's word and a person's pause outrank any
 * heuristic; then a voice relay the chair's own registers say it took up (`./relayTakenUp.ts`), conclusive because
 * a register decided it, but asked after the rails so the owner's ruling on a relay still keeps it; then the text rules,
 * which can only ever propose.
 *
 * @param candidate the row, with its derived state and run disposition already composed
 * @param bySlug every candidate in this pass, keyed by slug, so the sibling rule can resolve a base row
 * @param nowIso the instant the pass is judged at
 * @returns the verdict and its witness
 */
export function pruneVerdictOf({
  candidate,
  bySlug,
  nowIso,
}: {
  candidate: PruneCandidate;
  bySlug: ReadonlyMap<string, PruneCandidate>;
  nowIso: string;
}): PruneVerdict {
  const register = registerVerdictOf({ candidate });
  if (register !== undefined) {
    return register;
  }
  const rail = railVerdictOf({ candidate });
  if (rail !== undefined) {
    return rail;
  }
  const relay = candidate.relayTakenUp;
  if (relay !== undefined) {
    return {
      conclusive: true,
      kind: PRUNE_RELAY_TAKEN_UP,
      performWith: pruneSettleLine({ settlement: relay.settlement, slug: candidate.slug, summary: relay.witness }),
      slug: candidate.slug,
      witness: relay.because,
    };
  }
  const textRule = textRuleVerdictOf({ bySlug, candidate, nowIso });
  if (textRule !== undefined) {
    return textRule;
  }
  return keepVerdict({ candidate, witness: `${candidate.section} — no prune rule fired` });
}

/**
 * Judge a whole pass, returning every verdict, the survivors, and the per-kind counts.
 *
 * @param candidates the rows to judge, already filtered to whatever slice the caller cares about
 * @param nowIso the instant the pass is judged at
 * @returns the pass, whose `considered` lets a reader check the counts add up rather than trust them
 */
export function prunePass({
  candidates,
  nowIso,
}: {
  candidates: readonly PruneCandidate[];
  nowIso: string;
}): PrunePass {
  const bySlug = new Map(candidates.map((candidate) => [candidate.slug, candidate]));
  const verdicts = candidates.map((candidate) => pruneVerdictOf({ bySlug, candidate, nowIso }));
  const counts: Record<PruneVerdictKind, number> = {
    [PRUNE_DUPLICATE_SIBLING]: 0,
    [PRUNE_EXPIRED_DAY_SCOPE]: 0,
    [PRUNE_KEEP]: 0,
    [PRUNE_RELAY_TAKEN_UP]: 0,
    [PRUNE_SETTLED]: 0,
    [PRUNE_SHIPPED_UNSETTLED]: 0,
  };
  verdicts.forEach((verdict) => {
    counts[verdict.kind] += 1;
  });
  return {
    considered: candidates.length,
    counts,
    survivors: verdicts.filter((verdict) => verdict.kind === PRUNE_KEEP),
    verdicts,
  };
}

/**
 * One line saying what a pass decided, naming the trim rather than leaving a reader to subtract two numbers.
 *
 * @param pass what {@link prunePass} returned
 * @returns the summary line
 */
export function pruneSummary({ pass }: { pass: PrunePass }): string {
  const conclusive =
    pass.counts[PRUNE_SETTLED] + pass.counts[PRUNE_SHIPPED_UNSETTLED] + pass.counts[PRUNE_RELAY_TAKEN_UP];
  const candidates = pass.counts[PRUNE_EXPIRED_DAY_SCOPE] + pass.counts[PRUNE_DUPLICATE_SIBLING];
  return (
    `${pass.considered} row(s) read, ${pass.counts[PRUNE_KEEP]} survive — ` +
    `${conclusive} the register already decided, ${candidates} candidate(s) needing a session's judgement`
  );
}
