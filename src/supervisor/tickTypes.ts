/**
 * One SWEEP TICK, recorded as a durable observation rather than retyped as prose.
 *
 * The fleet briefing's `recent`, `earlierToday` and `history` sections are the supervisor's own log of what
 * it read and did each tick, and until this ledger existed they were composed BY HAND every ~20 minutes.
 * They are derived from the ledgers the way `yourList` and the pull-request
 * cards already are, so a sweep registers and derives rather than authors — the reason being the
 * Fable draw of composing them and that deriving removes a point of failure.
 *
 * ## Why a ledger rather than reading the live registers at render time
 *
 * Because two of the three sections are the PAST. `earlierToday` and `history` describe ticks that are over,
 * and several of the sweep's own reads — the machine's load, the plan gauge, the listener's grade, a
 * session's depth — have no durable source anywhere: they are a reading of a moment, and the moment is gone.
 * A page assembled from live reads could only ever describe now, and would describe it at a dozen different
 * instants rather than at the one the supervisor actually acted on.
 *
 * So a tick row is an **observation commit**: what was read, when, whether the read succeeded, and what the
 * sweep then did about it.
 *
 * ## Three properties the shape carries, each answering a measured failure
 *
 * **1 · "Not checked" can never read as "nothing open".** Every source is a {@link SourceObservation}, whose
 * `unavailable` arm carries a diagnostic. This is the same call `../supervisor/intake.ts`'s `IntakeReport`
 * already makes for the same reason, and it is the difference between a quiet fleet and a broken probe.
 *
 * **2 · The owner's words are stored VERBATIM, not pointed at.** MEASURED on a live briefing form against
 * the same tick's `handover reconcile --json`: of the **19 owner turns** the reconciliation read in its
 * 24-hour window, **zero** appear in the authored page — not verbatim, and not as a 25-character fragment.
 * The authored narrative names the owner's turns by number and by a pointer into a per-handoff scratch
 * directory. So the condition on this work — that derivation must not lose the critical information in
 * what the owner has said — is met by carrying {@link SupervisorOwnerTurn.text}, which is the exact string
 * `../transcripts/extract.ts` stripped, rather than a reference to a file that expires.
 *
 * **3 · Judgement is STRUCTURED, so it cannot regrow into the narrative it replaced.** A free-text field
 * would be the same authored prose under a new filename. {@link SupervisorJudgement} carries a closed kind,
 * a subject, a witness and a `whyNotDerived`, and {@link SupervisorTickStats} measures its bytes against the
 * row's, so regrowth is a number somebody can watch rather than something nobody notices.
 *
 * Pure types. The store is `./tickStore.ts`, the schema `./tickSchema.ts`, and the projection into the
 * briefing form's own sections is `../briefing/narrative.ts`.
 */
import type { CeilingsReading } from "../capacity/ceilings.js";
import type { GaugeFacts } from "./tickGaugeTypes.js";
import type { TICK_ACTION_KINDS, TICK_SUBJECT_KINDS } from "./tickKinds.js";

/** The row format's version. A reader that meets an unknown one says so rather than guessing at the fields. */
export const SUPERVISOR_TICK_SCHEMA_VERSION = 1;

/**
 * Every source a tick may read, as a closed set.
 *
 * Closed rather than open because {@link REQUIRED_TICK_SOURCES} is what makes a partial capture VISIBLE: a
 * source missing from a row is a row the schema refuses, so a sweep that skipped a step says so with an
 * `unavailable` observation instead of leaving a hole a reader cannot see.
 *
 * The names are the sweep contract's own steps (`skills/supervisor/reference/sweep-contract.md`), so a
 * reader can join a row to the step that produced it without a mapping table.
 */
export const TICK_SOURCE_KINDS = [
  "capacity",
  "gauge",
  "listener",
  "reconcile",
  "watch",
  "closeDone",
  "depth",
  "recipeDue",
  "velocity",
  "friction",
  "github",
  "landings",
] as const;

/** One source's name. See {@link TICK_SOURCE_KINDS}. */
export type TickSourceKind = (typeof TICK_SOURCE_KINDS)[number];

/**
 * The sources a finalised row must account for — all of them.
 *
 * "Account for" is not "read": an `unavailable` observation satisfies this, and is the honest answer for a
 * step the tick did not run. What the requirement removes is the third state, silence, which reads on the
 * page exactly like a clean result.
 */
export const REQUIRED_TICK_SOURCES: readonly TickSourceKind[] = TICK_SOURCE_KINDS;

/**
 * How a source's read went.
 *
 * `partial` is its own arm rather than a flag on `read`, because a partial read carries BOTH facts and a
 * diagnostic and a boolean would let a caller drop one of them.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export type TickSourceStatus = "read" | "partial" | "unavailable";

/**
 * What produced a row's facts, so they can be traced rather than believed.
 *
 * `exitCode` is `null` whenever this ledger did not itself watch a command exit — an in-process call, or a
 * document the tick redirected to a file and a recorder later read (`supervisor tick-draft`). Reading a file
 * is evidence of the file, never a receipt for the command that wrote it, and a zero there would be exactly
 * the invented observation this ledger exists to prevent.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface TickSourceWitness {
  /** The command the sweep ran as it ran it, or the read that produced these facts, said as a read. */
  readonly command: string;
  /** Its exit code, or `null` when no exit was observed — nothing spawned, or a redirected document read. */
  readonly exitCode: number | null;
}

/**
 * One source's reading: its status, when it was taken, what ran, and the facts it yielded.
 *
 * `verbatimLine` carries the source verb's OWN one-line summary where it prints one — `machine capacity`'s
 * `verdict`, `session close-done`'s summary, `handover reconcile`'s `headline`. The sweep contract already
 * says several of these go into the briefing verbatim, so keeping the generated sentence beside the typed
 * fields means a projection never has to re-compose a line the verb already wrote.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export type SourceObservation<TFacts> =
  | {
      readonly status: "read";
      readonly observedAtIso: string;
      readonly witness: TickSourceWitness;
      readonly facts: TFacts;
      readonly verbatimLine?: string | undefined;
    }
  | {
      readonly status: "partial";
      readonly observedAtIso: string;
      readonly witness: TickSourceWitness;
      /** What the read could NOT see. Required on this arm — a partial read with no gap named is a `read`. */
      readonly diagnostic: string;
      readonly facts: TFacts;
      readonly verbatimLine?: string | undefined;
    }
  | {
      readonly status: "unavailable";
      readonly observedAtIso: string;
      readonly witness: TickSourceWitness;
      /** Why nothing was read. This is what stops the page rendering silence as a clean fleet. */
      readonly diagnostic: string;
    };

/**
 * One ruling, as the tick recorded it — structurally `../sessionStart/lockIn.ts`'s `LockInRow`.
 *
 * `verb`, `outcome` and `reason` are plain strings here rather than that module's closed unions, and the
 * reason is durability rather than laziness. A row is written once and read forever, `./tickStore.ts`
 * REFUSES a line it cannot parse rather than skipping it, and this ledger holds the owner's words — so a vocabulary
 * that later drops a member would make every older row unreadable and take a month of the owner's rulings with it.
 * The live unions stay closed where they are enforced; a snapshot of one is text.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface TickLockIn {
  readonly tsIso: string;
  readonly identity: string;
  readonly againstWhenIso: string;
  /** The action the list proposed, verbatim, so a reader can tell what the owner was answering. */
  readonly proposed: string;
  readonly verb: string;
  readonly outcome: string;
  readonly reason?: string | undefined;
  /** Anything the owner said in their own words, as the lock-in ledger stored it. */
  readonly note?: string | undefined;
  readonly deferredUntilIso?: string | undefined;
}

/**
 * One owner turn, exactly as the owner typed it, with everything needed to place and trust it.
 *
 * Built from `./intake.ts`'s `WitnessedTurn`, which the sweep already reads at step 10 through
 * `slopweaver handover reconcile --json`. Nothing here is composed: `text` is
 * `../transcripts/extract.ts`'s stripped turn, and `pointer` is the canonical
 * `transcript:<session>#<turn>` a board row or an intake mark can join to.
 *
 * `lockIn` is the full {@link TickLockIn} when the turn produced a ruling, rather than a subset — the owner's ruling
 * carries what was PROPOSED to them and why the outcome was what it was, and a projection that kept only the
 * outcome would show the answer without the question.
 */
export interface SupervisorOwnerTurn {
  /** `transcript:<sessionId>#<turnUuid>` — the anchor a row or a mark carries. */
  readonly pointer: string;
  readonly sessionId: string;
  readonly turnUuid: string;
  /** When the turn was recorded, or `null` when the transcript line carried no instant. */
  readonly instantIso: string | null;
  /** The owner's words, every wrapper stripped. Stored, never summarised, never clipped. */
  readonly text: string;
  /**
   * How the turn reached the transcript, as the reader reported it.
   *
   * A plain string rather than `../transcripts/extract.ts`'s closed `HumanTurnSource`, for the reason
   * `./tickSchema.ts`'s header states as a class: this is a value the tick CARRIES rather than mints, so
   * mapping an unrecognised one onto `unknown` would lose what the transcript actually said.
   */
  readonly source: string;
  /**
   * Where the turn sits in its transcript — the position a cursor-based reader will resume from.
   *
   * `null` when the reconciliation carried a number JSON cannot hold, which is a position that is not a
   * position. See `./tickOwnerTurns.ts`'s `finiteOrNull` for why accepting it unchanged loses the tick.
   */
  readonly transcriptLineNumber: number | null;
  /** What the board or the intake ledger says this turn became, or `null` when nothing points at it yet. */
  readonly witness: TickTurnWitness | null;
  /** True while the turn is inside the intake grace window and unwitnessed — the tick is not over. */
  readonly inGrace: boolean;
  /** The ruling this turn produced, when a lock-in row names it. See {@link OwnerTurnLockInLink}. */
  readonly lockIn: TickLockIn | null;
  /** How `lockIn` was established, so a guess can never read as a join. */
  readonly lockInLink: OwnerTurnLockInLink;
}

/**
 * What the board or the intake ledger says a turn became, as the tick recorded it.
 *
 * `kind` is a plain string rather than `./intake.ts`'s closed `WitnessKind`, for the reason
 * `./tickSchema.ts`'s header states as a class: this is a value the tick CARRIES rather than mints, so
 * narrowing an unrecognised one would silently delete the witness AND its text.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface TickTurnWitness {
  readonly kind: string;
  /** The row slug, or the mark's own witness text. */
  readonly witness: string;
}

/**
 * How a turn was joined to a ruling — and the standing gap this field states rather than hides.
 *
 * `LockInRow` carries no owner-turn pointer today (`../sessionStart/lockIn.ts`): a ruling's provenance lives
 * in its free-text `note`, which may name an owner turn and a scratch file holding it. Prose is not a join key, so this ledger will not pretend it is one. Every row
 * recorded before `lockIn` gains a structured pointer reads `recorded-before-pointer`, which is a NAMED gap on the
 * page rather than a wrong ruling attached to the wrong turn.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export type OwnerTurnLockInLink = "linked" | "none" | "recorded-before-pointer";

/**
 * What the chain walk could and could not see, as the tick recorded it.
 *
 * Structurally `./chain.ts`'s `ChainCoverage`, declared here rather than imported for one reason that is
 * about durability rather than taste: this is a SNAPSHOT written to a ledger, so its shape has to be stable
 * against a later change to the live type. `earliestIso` is an optional KEY here because a ledger line
 * simply omits it when the chain holds no link, and a reader of a row written months ago must not need the
 * current chain module to agree with it.
 */
export interface TickChainCoverage {
  /** Every session actually walked, in succession order. */
  readonly walked: readonly string[];
  /**
   * How many links the chain holds in total, whatever the window kept.
   *
   * `null` when the reconciliation carried a number JSON cannot hold — the same normalisation
   * `./tickOwnerTurns.ts`'s `finiteOrNull` applies to a line number, and for the same reason.
   */
  readonly linksKnown: number | null;
  /** The earliest instant the chain knows about. Absent when it holds no link at all. */
  readonly earliestIso?: string | undefined;
  /** Whether the journal reaches the floor asked for. `false` means turns before it were never read. */
  readonly reachesSince: boolean;
  /** Links whose transcript could not be walked, each with the reason. A gap stated, not swallowed. */
  readonly unreadable: readonly { readonly claudeSessionId: string; readonly why: string }[];
}

/**
 * Every owner turn since the previous tick, or the reason there is no such list.
 *
 * `unavailable` is first class for the same reason `./intake.ts`'s `IntakeReport` makes it first class: a
 * machine with no supervisor pin, a pin naming a dead session, or a transcript that would not walk must read
 * as "not checked" rather than "the owner said nothing", and the second is the lie this whole ledger exists to stop.
 *
 * ## The window is a TIME window, and that is a stated gap
 *
 * `sinceIso` is the floor the reconciliation read from — a trailing 24 hours by default. A transcript line
 * written late but carrying an older instant can fall behind a previous tick's floor and be read by neither.
 * A per-session line CURSOR closes that, and this shape already carries `transcriptLineNumber` on every turn
 * so the cursor can be computed when it lands. Until then the window is what there is, and
 * {@link ChainCoverage} states what the read could and could not reach.
 */
export type OwnerTurnSnapshot =
  | {
      readonly status: "read" | "partial";
      /** The floor the turns were read from, or `null` when the whole chain was read. */
      readonly sinceIso: string | null;
      /** What the chain walk could and could not see. Carried so a short read cannot look complete. */
      readonly coverage: TickChainCoverage;
      readonly turns: readonly SupervisorOwnerTurn[];
      /** What the read could not reach. Required when `status` is `partial`. */
      readonly diagnostic?: string | undefined;
    }
  | {
      readonly status: "unavailable";
      readonly sinceIso: string | null;
      readonly diagnostic: string;
      /** Always empty: an unavailable read yielded no turns, which is not the same as the owner saying nothing. */
      readonly turns: readonly never[];
    };

/**
 * The owner-turn snapshot a `tick-draft` draft is VALIDATED against, and never emitted with.
 *
 * `tick-record` computes the real one off the reconciliation; this stands in only so the assembled draft can
 * be put through the ledger's own door before anything is written.
 */
export const DRAFT_VALIDATION_TURNS: OwnerTurnSnapshot = {
  diagnostic: "tick-draft validation only: tick-record reads the owner's turns off the reconciliation itself",
  sinceIso: null,
  status: "unavailable",
  turns: [],
};

/**
 * What a tick action or a judgement is ABOUT, named so two rows can be joined without matching prose.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface TickSubject {
  readonly kind: (typeof TICK_SUBJECT_KINDS)[number];
  /** The subject's own stable id — a workspace, a slug, `owner/repo#<number>`, a pointer. */
  readonly id: string;
  /** How the owner would recognise it. */
  readonly label: string;
}

/**
 * Where the evidence for an action or a judgement lives, so a reader can go and check it.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface TickEvidence {
  readonly kind: "command" | "ledger" | "transcript" | "artifact" | "provider";
  /** The command, path, pointer or URL. */
  readonly ref: string;
}

/**
 * What a sweep DID, as opposed to what it read.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export type TickActionKind = (typeof TICK_ACTION_KINDS)[number];

/**
 * One thing the sweep did this tick.
 *
 * Separate from {@link SupervisorTickSources} because a tick both OBSERVES and ACTS, and conflating the two
 * produces a page that describes a pull request as open after the same tick enqueued it, or a session as
 * blocked after the same tick answered it. The row is finalised after the sweep's own decisions for exactly
 * this reason — see {@link SupervisorTickRow.finalisedIso}.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface SupervisorTickAction {
  /** Stable within the row, so a projection can prove it rendered every one of them. */
  readonly actionId: string;
  readonly kind: TickActionKind;
  readonly subject: TickSubject;
  readonly outcome: "completed" | "held" | "failed";
  readonly recordedIso: string;
  readonly witness: TickEvidence;
  /** One clause of detail, when the kind and subject do not carry it. */
  readonly detail?: string | undefined;
}

/**
 * What a supervisor concluded that no verb emits.
 *
 * MEASURED over 424 distinct archived tick notes: classifying all 10,507
 * text units by which sweep step produces the fact leaves **12.9%** matching no source. Most of that residue
 * is repeated boilerplate, but a real slice is irreducible — "another session is landing it itself, so this
 * seat watches rather than lands" is a cross-source call, not a reading.
 *
 * So judgement stays, and it is SHAPED. A closed `kind`, a required subject and witness, and a
 * `whyNotDerived` naming which of four things put it outside derivation. That is what stops the escape hatch
 * becoming a second narrative: a claim restating a source this row already carries is not a judgement, and
 * {@link SupervisorTickStats} measures the bytes so regrowth is visible rather than gradual.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface SupervisorJudgement {
  /** Stable within the row, so a projection can prove it rendered every one of them. */
  readonly judgementId: string;
  readonly kind: "cross-source-causal-link" | "watch-disposition" | "hold-rationale" | "priority-call" | "exception";
  readonly subject: TickSubject;
  /**
   * What else the call is about, beside its one primary subject. A hold-rationale on a board row names the
   * CEILING it left the row for here — `{kind:"ceiling", id:"claude:plan-two"}` — which is the only way the
   * idle-capacity gate accepts a reason once a tick read its ceilings (`./idleCapacityGate.ts`). Absent on
   * every row journalled before it existed.
   */
  readonly relatedSubjects?: readonly TickSubject[] | undefined;
  /** The call, in one sentence. Rendered verbatim under a visible label, never laundered into a fact. */
  readonly claim: string;
  readonly witness: TickEvidence;
  readonly recordedIso: string;
  /** Which kind of thing puts this outside what a verb could have said. */
  readonly whyNotDerived: "cross-source-inference" | "intent-interpretation" | "risk-call" | "operational-context";
}

/**
 * One thing that LANDED, identified rather than counted.
 *
 * `recent` renders as "landing(s) since you last looked" because the owner wants to
 * know what has actually landed over time, so the section is contractually about landings.
 * `slopweaver velocity` counts them and throws the identities away, and `session close-done` reports session
 * outcomes rather than merges, so neither can fill that section. This type is what can.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export type FleetLanding =
  | {
      readonly landingId: string;
      readonly kind: "pull-request";
      readonly repo: string;
      readonly number: number;
      readonly title: string;
      readonly url: string;
      readonly landedAtIso: string;
      readonly mergeCommitSha: string;
    }
  | {
      readonly landingId: string;
      readonly kind: "handover";
      readonly slug: string;
      readonly label: string;
      readonly landedAtIso: string;
      /** The settlement's own witness — a sha, a permalink, a slug. */
      readonly witness: string;
    };

/**
 * The machine reading, as `slopweaver machine capacity --json` gives it.
 *
 * A SLICE of that document rather than the whole of it, for the reason `../briefing/yourList.ts` reads a
 * slice of the session-start run: the verb reports fifteen ranked processes and a dozen thresholds this page
 * never shows, and a capture demanding all of them would refuse a document a later version widened.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface CapacityFacts {
  readonly hold: boolean;
  /** Which subjects held, when one did — `memory`, `cpu`, `boots`, `disk`, or several. Empty when nothing held. */
  readonly holdSubjects: readonly string[];
  readonly load1: number;
  /**
   * The 1-minute load the hold is judged at, sized to the machine's cores. Absent on every row journalled before
   * this field existed, and on a capture whose report carried no `loadHold`; the fleet history reads it to say what the
   * load was held against.
   */
  readonly loadHold?: number | undefined;
  /** The memory COMPRESSOR's segment usage. Not a disk number, though an earlier fold read it as one. */
  readonly segmentsPct: number;
  readonly swapfileCount: number;
  /**
   * The volume's used percent, absent when the captured report carried no `df` reading.
   *
   * Optional rather than required-and-undefined because every tick row journalled before this field existed has no
   * such key at all, and a schema that demanded one would refuse to read the ledger's own history back.
   */
  readonly diskUsedPct?: number | undefined;
  readonly diskFreeGb?: number | undefined;
  /** The free GB the disk holds below. Absent on every row journalled before this field existed. */
  readonly diskHoldFreeGb?: number | undefined;
  /** Worktree REGISTRATIONS across every declared main checkout — what `worktree prune` clears. */
  readonly registeredWorktrees?: number | undefined;
  /**
   * Every ceiling a seat spends, read in the same pass — this machine and each Claude and Codex plan, as used
   * of available with its reset, and the lowest (`../capacity/ceilings.ts`). Optional for the same reason the
   * disk readings are: every row journalled before this field existed has no such key.
   */
  readonly ceilings?: CeilingsReading | undefined;
  /** The biggest process that is not the fleet's, which alerts and never holds. */
  readonly topForeignLabel: string;
  readonly topForeignGb: number;
  /**
   * How many dispatch rows were OPEN at the moment of the reading — an anomalous-load finding nobody has
   * settled (`../live/machine/dispatchRow.ts`). A row whose seat was suppressed or failed is open and
   * answers nothing, so the gate reads {@link dispatchCovering} rather than this. Optional, with the three
   * beside it, all or none: every row journalled before these fields existed carries none of them.
   */
  readonly dispatchOpen?: number | undefined;
  /** Of those, the ones that seated a visible investigation — the only count that answers a hold. */
  readonly dispatchCovering?: number | undefined;
  /** The newest open dispatch's subject, so the briefing names WHO rather than only that one is open. */
  readonly dispatchSubject?: string | undefined;
  /** Seconds until the fleet may seat another investigation on that signature — 0 when it may seat now. */
  readonly dispatchBackoffSeconds?: number | undefined;
  /**
   * How many WORKING seats the Claude plans carry until they reset, at the burn the fleet measured
   * (`slopweaver fleet ceiling`, `../capacity/seatCeiling.ts`), or why it could not be measured. The
   * idle-capacity gate fills to it (`./idleCapacityGate.ts`). Optional: every row journalled before
   * this field existed has no such key, and a tick that captured no `--seat-ceiling` has none either.
   */
  readonly workingSeatCeiling?: TickSeatCeiling | undefined;
}

/**
 * The seat ceiling as one tick carries it: the number alone, never the per-plan runway behind it, so a row
 * stays small. `fleet ceiling` prints the rest.
 *
 * @internal — read by this module, the idle-capacity gate and their own tests.
 */
export type TickSeatCeiling =
  { readonly kind: "measured"; readonly seats: number } | { readonly kind: "unmeasurable"; readonly reason: string };

/**
 * The bot listener's grade, which is the one thing that means the bot is off the air.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface ListenerFacts {
  readonly grade: string;
  readonly armId: string;
  readonly pid: number | null;
  readonly socketState: string;
  /** The verb's own one-line explanation of the grade. */
  readonly why: string;
}

/**
 * The board and intake reading, from `slopweaver handover reconcile --json`.
 *
 * The owner turns it carries are NOT here — they are {@link SupervisorTickRow.ownerTurns}, promoted to the
 * row's own field because they are the one thing this whole ledger exists to preserve.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface ReconcileFacts {
  /** The generated alignment sentence, verbatim. The briefing's `alignment.headline` takes it unmodified. */
  readonly headline: string;
  /** The generated owner-intake sentence, verbatim. The briefing's `alignment.intake` takes it unmodified. */
  readonly intakeClause: string;
  readonly rankedCount: number;
  readonly alignedCount: number;
  readonly misalignedCount: number;
  readonly unregisteredCount: number;
  readonly staleAskCount: number;
  readonly starvingCount: number;
  /**
   * How many ready rows no live seat is on — the fleet history's "nothing ready" witness. Absent when the reading
   * did not observe the fleet, repeats a ready id, or predates the fields it is counted from: an unknown count is
   * never a zero.
   */
  readonly openReadyCount?: number | undefined;
}

/**
 * One live session the watch reported, and how the tick classified it.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface WatchRowFacts {
  /** The workspace or worktree, as `session watch` names it. */
  readonly session: string;
  /** The verb's own state — `idle`, `silent`, `needs-input`, `logged-out`, `limit-retrying`, `working`. */
  readonly state: string;
  /** What the row is on, in one clause. */
  readonly on: string;
}

/**
 * The fleet reading, and what it could not see.
 *
 * `suppressed` is here because `session watch --json` prints its rows to stdout and its suppressed count to
 * stderr, so a capture reading only the JSON reports a smaller fleet than the one that exists. An
 * unavailable inventory must never render as an empty fleet.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface WatchFacts {
  readonly rows: readonly WatchRowFacts[];
  /** How many rows the watch suppressed — quiet, stale or already closed. */
  readonly suppressed: number;
}

/**
 * `session close-done`'s own summary line and the counts behind it.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface CloseDoneFacts {
  readonly closedChats: number;
  readonly closedLedgerRows: number;
  readonly heldBusy: number;
  readonly keptOpen: number;
}

/**
 * One session's context depth, and whether it is a respawn candidate.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface DepthRowFacts {
  readonly session: string;
  readonly tokens: number;
  readonly respawnCandidate: boolean;
}

/**
 * Every session the depth read covered.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface DepthFacts {
  readonly rows: readonly DepthRowFacts[];
}

/**
 * One automation that is due, and what running it would take.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface RecipeDueRowFacts {
  readonly id: string;
  /** How the owner would recognise it. The due report publishes no friendlier name, so a recorder repeats the id. */
  readonly label: string;
  /** Whether running it is a command in this process or a spawned session. */
  readonly runs: "in-process" | "spawn";
  /** How late it is against its own cadence, in minutes. */
  readonly lateMinutes: number;
  /** The workspace already holding it, or `null`. */
  readonly heldBy: string | null;
}

/**
 * The due-ask reading.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface RecipeDueFacts {
  readonly rows: readonly RecipeDueRowFacts[];
}

/**
 * The machine's own pace, with the caution the verb insists on carrying.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface VelocityFacts {
  readonly docsLandedToday: number;
  /** The verb's own caution, verbatim — it is not a target and the page must not read as one. */
  readonly caution: string;
}

/**
 * The self-improvement review's standing.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface FrictionFacts {
  /** Whether an unpublished friction review is waiting. */
  readonly hasGap: boolean;
  /**
   * Whether the newest report is old enough that its producer has STOPPED rather than slipped — an
   * independent verdict from {@link FrictionFacts.hasGap}, because a dead producer closes the gap by
   * starving it. `reflect/frictionReviewGap.ts`'s header carries the reading where
   * `hasGap: false` and `isStale: true` held at once. Optional: every row journalled before this field existed
   * carries none, and absence says the staleness was not checked, never that the producer was fresh.
   */
  readonly isStale?: boolean | undefined;
  /**
   * The newest report, as its producer identifies it — `reflect friction-review --json` names it by DATE
   * (`latestReportDate`), which is what a recorder carries. `null` when the recipe has never run.
   */
  readonly newestReport: string | null;
}

/**
 * One open pull request the tick read.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface GithubPullRequestFacts {
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  /** GitHub's own word for it — `MERGEABLE`, `CONFLICTING`, `UNKNOWN`. Its casing is theirs, not ours. */
  readonly mergeable: string;
  /** GitHub's own rollup — `SUCCESS`, `FAILURE`, `PENDING`. */
  readonly rollup: string;
  readonly draft: boolean;
}

/**
 * The repository reading: where `main` is, and what is open on it.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface GithubFacts {
  /** The base branch's head, so a later row can say what moved. */
  readonly mainSha: string;
  readonly pullRequests: readonly GithubPullRequestFacts[];
  /** Whether a merge hold is standing. */
  readonly holdStanding: boolean;
}

/**
 * What landed. See {@link FleetLanding}.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface LandingsFacts {
  readonly landings: readonly FleetLanding[];
}

/**
 * Every source's observation, one field per {@link TickSourceKind}.
 *
 * Named fields rather than a map keyed by string, so a source nobody captured is a COMPILE error in the
 * recorder rather than a key a reader discovers is missing at render time.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface SupervisorTickSources {
  readonly capacity: SourceObservation<CapacityFacts>;
  readonly gauge: SourceObservation<GaugeFacts>;
  readonly listener: SourceObservation<ListenerFacts>;
  readonly reconcile: SourceObservation<ReconcileFacts>;
  readonly watch: SourceObservation<WatchFacts>;
  readonly closeDone: SourceObservation<CloseDoneFacts>;
  readonly depth: SourceObservation<DepthFacts>;
  readonly recipeDue: SourceObservation<RecipeDueFacts>;
  readonly velocity: SourceObservation<VelocityFacts>;
  readonly friction: SourceObservation<FrictionFacts>;
  readonly github: SourceObservation<GithubFacts>;
  readonly landings: SourceObservation<LandingsFacts>;
}

/**
 * What this row weighs, split so judgement's share of it is a measured number.
 *
 * It deliberately does NOT claim a share of the rendered page: that number does not exist until several rows
 * have been projected, and a row asserting it would be asserting something it cannot see. The projection
 * carries the rendered ratio; this carries the ledger's own.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface SupervisorTickStats {
  readonly judgementCount: number;
  readonly judgementUtf8Bytes: number;
  /** Every other byte of the row — the observations, the turns and the actions. */
  readonly structuredUtf8Bytes: number;
}

/**
 * One finalised tick.
 *
 * ## Finalised AFTER the sweep's own decisions, and that ordering is the contract
 *
 * The sweep contract renders the briefing at step 12 and then fills capacity and re-arms at steps 13–14
 * (`skills/supervisor/reference/sweep-contract.md`). A row written before the render cannot carry those
 * outcomes; one written after misses the page. So the row is recorded once, after the decisions, and the
 * NEXT tick's page is where they appear — which is also the honest reading, because a page cannot report a
 * spawn that happens after it is published.
 *
 * `tickId` is stable and unique within the ledger; `finalisedIso` is monotonic across it. `./tickStore.ts`
 * refuses a row breaking either, rather than skipping it: this ledger holds the owner's words, so a silently dropped
 * row is a silently dropped turn.
 */
export interface SupervisorTickRow {
  readonly schemaVersion: number;
  /** Unique in the ledger. The join key for every receipt that proves this row was projected. */
  readonly tickId: string;
  /** The workspace that ran the tick, so a row can be traced to a seat. */
  readonly workspace: string;
  /** The supervisor handoff this tick belongs to. */
  readonly handoff: string;
  readonly startedIso: string;
  /** When the row was written — after the tick's own decisions. Monotonic across the ledger. */
  readonly finalisedIso: string;
  readonly sources: SupervisorTickSources;
  readonly ownerTurns: OwnerTurnSnapshot;
  readonly actions: readonly SupervisorTickAction[];
  readonly judgements: readonly SupervisorJudgement[];
  readonly stats: SupervisorTickStats;
}
