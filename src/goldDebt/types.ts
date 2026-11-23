/**
 * What ONE gold debt is, and what settling it is — the two row shapes every other module in
 * `src/goldDebt` reads, writes or refuses. Pure data: no behaviour, no I/O, no clock.
 *
 * ## Why this register exists
 *
 * A session may land its own pull request at `silver` or `bronze` when gold genuinely was not feasible at the
 * time, and the owner wants the missing gold tracked: gold-level proof can still find bugs before they bite
 * in a live setting. So a merge below gold leaves gold OWED rather than waived, and
 * this is where the owing is written down.
 *
 * **It is not a gate, and making it one would be the defect.** The whole point is that
 * merging is NOT delayed — the debt is remembered instead. Nothing in the landing lane
 * (`src/outbound/github/mergeGuard.ts`, `src/cli/commands/github/mergeCore.ts`, the enqueue path) consults
 * this register, and `src/__tests__/unit/goldDebt/notAMergeBlocker.test.ts` is the guard that keeps it that
 * way rather than a promise in prose.
 *
 * ## A debt is IDENTIFIED by the pull request, and its id is DERIVED
 *
 * Unlike `../autonomy/types.ts`, where the acting session chooses an `actionId`, a debt is one-to-one with
 * a merged pull request: there cannot be two silver merges of one pull request. So the identity field is
 * the pull request's own URL and the key `<owner>/<repo>#<number>` is derived from it by `./pull.ts`, the
 * same way `../autonomy/label.ts` derives a label rather than storing one. Two consequences are the reason:
 * a re-record needs no id coordination between two sessions, and a row cannot name a different pull request
 * from the one it identifies.
 *
 * ## Why `grade` is a CLOSED set, where autonomy's `kind` is open
 *
 * `../autonomy/types.ts` argues at length for an open vocabulary, and the argument does not carry here. The
 * three proof grades are fixed by `skills/github/reference/pull-requests.md` (rule 1's own vocabulary, which no
 * description publishes), so a grade nothing else in this repository can read would be a row no reader could
 * act on. `gold` is refused outright: a gold merge owes nothing, and a gold
 * row could never be settled.
 *
 * ## Why `wouldBe` and `blockedOn` are free prose
 *
 * The owner ruled explicitly against pinning the sibling judgement — whether gold was feasible — to a
 * mechanical heuristic, and a structured `blockedOn` would be the same mistake facing the other way.
 * MEASURED over two real non-gold merges standing on `main`: one's condition is the owner's own
 * approval of an outward act aimed at people, and the other's is that the one Slack socket is held by the
 * standing listener arm. No enum drafted in advance holds both, and a predicate evaluating either would
 * have to model the owner's attention or the listener's process table. Reproduce the measurement with
 * `git log --format='%s' -20 origin/main | grep -o '(#[0-9]*)$'`, then read each body's
 * `proof-<grade>` badge through `slopweaver github read`.
 *
 * So the supervisor's sweep READS the open debts and judges whether a condition has passed. Nothing here
 * decides it.
 *
 * ## The capture point, and what is deliberately not built yet
 *
 * A row is written by the session that landed the pull request, told to do it by
 * `skills/github/reference/pull-requests.md`. Nothing checks that it did. The natural close is for
 * `github merge`/`enqueue` to append the row itself off the badge it already reads — a non-blocking write
 * on a fact it has in hand — and that is left out of the first cut on purpose, because adding a ledger
 * write to the landing lane is how a landing lane breaks.
 */

/** The grades a merge can leave gold owed at. `gold` is absent on purpose — a gold merge owes nothing. */
export const GOLD_DEBT_GRADES = ["silver", "bronze"] as const;

/** What a pull request merged at, when it merged below gold. */
export type GoldDebtGrade = (typeof GOLD_DEBT_GRADES)[number];

/** How a debt ended: the evidence was gathered, or it can never be gathered at all. */
export const GOLD_DEBT_VERDICTS = ["gathered", "moot"] as const;

/** What a settlement concluded. */
export type GoldDebtVerdict = (typeof GOLD_DEBT_VERDICTS)[number];

/**
 * The longest a prose field may be — `wouldBe`, `blockedOn`, `evidence` and `regrade`.
 *
 * A SERIALISATION bound rather than a prose cap, exactly as `../autonomy/types.ts`'s `AUTONOMY_WHY_MAX` is:
 * the number exists so one row cannot be a document, and it is not an instruction to write less. Held at
 * the same 4000 that register measured its real rows well inside.
 */
export const GOLD_DEBT_TEXT_MAX = 4000;

/** The longest a pull-request URL may be. */
export const GOLD_DEBT_URL_MAX = 500;

/** The longest a stored pull-request title may be. Longer titles are refused, never truncated. */
export const GOLD_DEBT_TITLE_MAX = 400;

/** The longest `bySession` may be — wide enough for the workspace, the run slug and the session id. */
export const GOLD_DEBT_SESSION_MAX = 300;

/** The longest a board-row slug may be, matching `../autonomy/types.ts`'s `AUTONOMY_RUN_MAX`. */
export const GOLD_DEBT_RUN_MAX = 200;

/** A board row slug as the board itself writes one — either case, because the board does not fold its slugs. */
export const GOLD_DEBT_RUN_PATTERN = /^[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*$/;

/** The shortest and longest a `proofCommit` may be — an abbreviated or full git object name. */
export const GOLD_DEBT_SHA_MIN = 7;
export const GOLD_DEBT_SHA_MAX = 40;

/** A git object name: lowercase hex, nothing else. */
export const GOLD_DEBT_SHA_PATTERN = /^[0-9a-f]+$/;

/**
 * One gold debt: a pull request that merged below gold, and what gold would have been.
 *
 * Every field is a scalar, for `../autonomy/types.ts`'s reason — a nested object turns a later projection
 * into a reshaping rather than one `insert … select`.
 */
export interface GoldDebtRow {
  /** The merged pull request's absolute URL. The row's IDENTITY; `./pull.ts` derives its key. */
  readonly pullRequest: string;
  /** What it merged at. Never `gold`. */
  readonly grade: GoldDebtGrade;
  /** When it merged — the fact that starts the debt. */
  readonly mergedIso: string;
  /** What gold proof WOULD be, quoted from the pull request's own why-not-gold statement. */
  readonly wouldBe: string;
  /** The condition that has to pass before that proof is gatherable. Prose — see the file overview. */
  readonly blockedOn: string;
  /** When the row was written. Never the merge instant — a debt is routinely recorded late, and may be. */
  readonly recordedIso: string;
  /** Which session wrote it down. Provenance, never proof. */
  readonly bySession: string;
  /**
   * The pull request's title when the row was written.
   *
   * Stored even though it is derivable, which is the opposite of `../autonomy/label.ts`'s call, and the
   * difference is cost: a label derived from an id is free, while a title costs a network round trip per
   * row, and the list the supervisor reads every sweep must render with no network. It goes STALE when a
   * merged pull request is retitled — harmless, because the URL beside it is the authority.
   */
  readonly title?: string;
  /** The board row the pull request landed under, when there was one. */
  readonly run?: string;
}

/**
 * The settlement of one debt, appended after the fact.
 *
 * Its own row rather than a field mutated in place, for `../autonomy/types.ts`'s reason: the register is
 * append-only, and a writer filling a field in place would destroy the property that makes a ledger worth
 * reading. `./query.ts` folds the settlement onto its debt at read time.
 */
export interface GoldDebtSettlementRow {
  /** The debt this settles, by the same pull-request URL the debt row carries. */
  readonly pullRequest: string;
  /** When it was settled. Its PRESENCE is what tells this row apart from a debt — see `./decode.ts`. */
  readonly settledIso: string;
  /** Whether the evidence was gathered, or the debt can never be paid at all. */
  readonly verdict: GoldDebtVerdict;
  /** What was gathered and where — or, on a `moot` verdict, why it can never be gathered. */
  readonly evidence: string;
  /**
   * What the merged pull request now says, and what was run to make it say so.
   *
   * REQUIRED on a `gathered` settlement and refused as empty, because the pull
   * request is re-graded post-hoc OPENLY. A settlement that records evidence while the merged description
   * still reads `silver` has hidden exactly the thing the owner needs to be able to see. On a `moot` verdict there
   * is nothing to re-grade, so it is absent rather than a sentence meaning "n/a".
   */
  readonly regrade?: string;
  /** The commit the late evidence was gathered against, when one is meaningful. */
  readonly proofCommit?: string;
  /** Which session recorded the settlement. */
  readonly bySession: string;
}

/** Either row the register may carry. Told apart by complete, disjoint validation — see `./decode.ts`. */
export type GoldDebtRecord = GoldDebtRow | GoldDebtSettlementRow;

/**
 * One debt with its settlement, when it has one — what every reader of this register actually gets.
 *
 * Two fields rather than a debt with its verdict merged in, because the halves are written at different
 * times by different sessions and a reader that cannot tell them apart has been handed a shape that hides
 * the distinction the register is about.
 */
export interface GoldDebt {
  readonly debt: GoldDebtRow;
  /** How it ended, or absent while it is still open. Latest in APPEND order — see `./query.ts`. */
  readonly settlement: GoldDebtSettlementRow | undefined;
}

/** What an append reports back: which debt, where it landed, and whether anything was written. */
export interface GoldDebtAppendReceipt {
  /** The derived `<owner>/<repo>#<number>` key of the debt the append concerned. */
  readonly debtId: string;
  readonly path: string;
  /** False when the register already held this exact row, so the append was an idempotent no-op. */
  readonly appended: boolean;
}
