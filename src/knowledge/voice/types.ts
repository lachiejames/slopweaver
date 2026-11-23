/**
 * What ONE unit of the owner's own recorded speech is, and what a session proposed after reading one. Pure
 * data: no behaviour, no I/O, no clock.
 *
 * ## Why this exists at all
 *
 * The source of a proposed belief is **the owner's voice dumps**: read for statements about how something
 * works, the confident ones and the ones flagged as guesses. Those words are the largest single body of
 * anything the owner has said that this installation holds, and without a reader nothing opens them: seven
 * source files carried eight mentions of a turn file, every one of them a comment citing a ruling, and not one
 * of them a reader.
 *
 * ## A proposal is NOT a lesson, and this is the boundary
 *
 * `../types.ts`'s `LessonRow` demands `evidence` (what was OBSERVED), a `tier` and a `verdict`. None of the
 * three can be honestly manufactured from a sentence said out loud, and the knowledge skill's own entry
 * test — paid for, not re-derivable, able to be wrong later — is about an INVESTIGATION rather than about a
 * belief. So a candidate claim read out of the owner's speech lands here, in a queue, and becomes a
 * `LessonRow` with `learner: "owner"` only once the owner has answered it.
 *
 * Equating the two was the obvious shortcut and it is refused: it would have filled the register the whole
 * `--repeats` mechanism reads with unmeasured guesses, which is the filler `../declared.ts` exists to keep
 * out.
 *
 * ## The CLI gathers; the visible session reads
 *
 * Nothing here extracts a belief. `skills/distil/SKILL.md` already sets this contract for the one other
 * place in this repository where prose has to be turned into a claim, and `AGENTS.md` rule 2 makes it
 * structural rather than stylistic: no model may run headless, so a verb that "extracted beliefs" would
 * either be a regex pretending to comprehend or a banned process. The verb produces a bounded, deduplicated,
 * provenance-carrying batch of the owner's own words; a visible session reads the batch and composes the claim.
 *
 * The eligibility criterion is therefore deliberately BROAD — every distinct non-empty unit is eligible. A
 * confidence-marker allowlist is refused: an explicit "I'm not actually sure" carries a marker, while a
 * confidently stated belief that turns out wrong carries none, and that is the one a quiz catches precisely
 * because it was stated confidently. A filter tuned on the first misses the second.
 */

/**
 * Which family of files one recording of the owner's speech was read out of.
 *
 * Three, because they have different durability and a reader must not conflate them. The tick ledger is
 * structured and append-only and carries a `turnUuid`; an archived turn file is durable but is a file whose
 * name a human chose; a scratch turn file lives under a per-handoff directory each successor COPIES
 * forward, which is why the same words appear thousands of times.
 */
export type VoiceSourceKind = "tick-ledger" | "archive-turn" | "scratch-turn";

/** Every source kind, in the order a scan reads them. */
export const VOICE_SOURCE_KINDS: readonly VoiceSourceKind[] = ["tick-ledger", "archive-turn", "scratch-turn"];

/**
 * One distinct thing the owner said, however many places carried it.
 *
 * ## Identity is the EXACT BYTES, and that is the whole dedup mechanism
 *
 * Measured on the owner's real home, through this verb rather than beside it: **22,055 recordings
 * collapse to 451 distinct units**. Per family — the tick ledger 1,913 recordings to 53 units, the archive
 * 206 to 206, the scratch directories 19,936 to 371. Reproduce with
 * `slopweaver knowledge voice --batch 0 --json | head -1` and read the watermark; add `--source <kind>` for
 * one family. A reader that treated each recording as a separate thing the owner said would hand a session the same
 * words thousands of times and would report a body of speech forty-nine times larger than the one that
 * exists. The scratch ratio is where nearly all of that comes from, and it is not accidental: each successor
 * handoff copies the previous scratch directory forward whole.
 *
 * The key is `sha256` of the exact text, NOT `../row.ts`'s `normaliseClaim`. Two deliberately different
 * choices: normalisation merges casing and spacing because two sessions writing one lesson are writing one
 * lesson, while two recordings of the owner's speech that differ by a character are two recordings and merging
 * them would silently pick one to keep. Nothing here may re-space, re-case or trim inside those words.
 */
export interface VoiceUnit {
  /** `u-` and 16 hex characters of the digest of the exact text. Stable across scans. */
  readonly id: string;
  /** Exactly what the owner said, byte for byte as the source held it. Never re-spaced. */
  readonly text: string;
  /** How many words it runs to, so a batch can be bounded without measuring the text twice. */
  readonly words: number;
  /** The family the FIRST recording of it was read from. */
  readonly source: VoiceSourceKind;
  /** Where that first recording sits: an absolute path, or `<tick id>#<turn uuid>`. */
  readonly locator: string;
  /** How many recordings across every family carried these exact bytes. Never fewer than one. */
  readonly occurrences: number;
  /**
   * Whether the recording may carry words that are NOT the owner's.
   *
   * Measured on the owner's real archive: an `owner-turn-*.txt` is a file a supervisor seat wrote
   * around the owner's words, so it opens with a provenance header and typically closes with a paragraph
   * headed `SUPERVISOR READING` or `SUPERVISOR'S READING (not the owner's words)`. The owner's verbatim turn
   * is inside it, but the file is not it.
   *
   * The tick ledger is the one family where this is false: `../../supervisor/tickOwnerTurns.ts` stores the
   * transcript's own stripped turn and nothing wraps it.
   *
   * This is the field the quote check CANNOT stand in for. `./propose.ts` proves a quote occurs in the
   * unit; on a wrapped unit that leaves it possible to quote a supervisor's sentence and record it as the owner's,
   * which is worse than no citation because it is indistinguishable from a true one. So the flag is on the
   * row, the batch prints it, and reading it is the session's job.
   */
  readonly wrapped: boolean;
  /** When the owner said it, when the source knows. A turn file's name is not an instant, so many units carry none. */
  readonly instantIso?: string | undefined;
}

/**
 * How firmly the owner held the claim, as the WORDS SHOW rather than as a reader infers.
 *
 * Two members: a belief held loosely enough to check is the most useful kind, and a belief held confidently
 * and wrongly is the one a quiz catches and a briefing does not, because nobody would have thought to ask.
 * It decides which questions are worth asking the owner, so it is a field rather than a note.
 */
export type BeliefHold = "stated-uncertain" | "stated-confident";

/** Every hold. */
export const BELIEF_HOLDS: readonly BeliefHold[] = ["stated-uncertain", "stated-confident"];

/** The longest a proposed claim may be — the same cap `../types.ts` puts on a lesson's claim, for the same reason. */
export const PROPOSAL_CLAIM_MAX = 400;

/**
 * What the owner said about a claim the fleet proposed they hold.
 *
 * A correction block on the briefing: each one takes right, wrong, or partly in a single click. Three
 * members and no fourth — a "not sure" would be indistinguishable on the page from a claim the owner has not
 * reached yet, and the page already represents that state by the row still being open.
 *
 * ## It is the owner's REACTION, and it is deliberately not a verdict
 *
 * `right` does not mean `confirmed` and `wrong` does not mean `refuted`. A verdict is about whether the
 * CLAIM is true; this is about whether the fleet read the owner's own knowledge correctly, which is a
 * different question with a different subject. The owner can be right that they believed something and the
 * belief still be false — that is the most interesting row in the register, and mapping the two together automatically
 * would erase it. `partly` supplies no corrected wording at all by itself, which is why
 * {@link BeliefAnswer.correction} exists as its own field.
 *
 * A visible session reads the answer and records the register row; nothing does that mapping mechanically.
 */
export type BeliefMark = "right" | "wrong" | "partly";

/** Every mark, in the order the page offers them. */
export const BELIEF_MARKS: readonly BeliefMark[] = ["right", "wrong", "partly"];

/**
 * One row of the proposal queue: a session read one unit of the owner's speech, and either proposed a claim or said
 * there was nothing to propose.
 *
 * ## Both outcomes are rows, and that is what makes the queue finish
 *
 * A store that recorded only successes could never say how much of the owner's speech had been READ, so a repeated
 * `knowledge voice` would hand the next session the same first units forever while reporting progress. So
 * "reviewed, nothing proposed" is a first-class row — the same call `../declared.ts` makes about a run that
 * learned nothing, and for the same reason.
 *
 * There is no separate cursor file. What has been reviewed is DERIVED from the rows, so a cursor cannot
 * drift from the work it claims to describe, and a batch that was printed but never answered advances
 * nothing.
 */
export type BeliefProposal =
  | {
      readonly kind: "answered";
      /** The proposal the owner answered. */
      readonly proposalId: string;
      /** The unit that proposal was read from, carried so one reader can group by either. */
      readonly unitId: string;
      /** What the owner said: right, wrong, or partly. */
      readonly mark: BeliefMark;
      /** The owner's own words about it, as the supervisor relayed them. Never a session's summary of the reaction. */
      readonly why: string;
      /** What the owner says the claim should have said. Present only when supplied, never inferred. */
      readonly correction?: string | undefined;
      readonly reviewedAtIso: string;
      /** The board row the session that recorded the owner's answer was on, or `ad-hoc`. */
      readonly run: string;
    }
  | {
      readonly kind: "proposed";
      /** `p-` and 16 hex characters over the unit and the normalised claim, so one claim on one unit is one row. */
      readonly proposalId: string;
      /** The unit this was read out of. */
      readonly unitId: string;
      /** Which system the claim is about — the same validated slug shape a lesson's domain has. */
      readonly domain: string;
      /** The belief, in one sentence, phrased so it is true or false. Composed by the session, not extracted. */
      readonly claim: string;
      /** The span of the owner's own words the claim was read from. Verified to occur in the unit's exact text. */
      readonly quote: string;
      /** How firmly the words show the owner held it. */
      readonly held: BeliefHold;
      readonly reviewedAtIso: string;
      /** The board row the reviewing session was on, or `ad-hoc`. */
      readonly run: string;
    }
  | {
      readonly kind: "none";
      readonly unitId: string;
      /** Why this unit carried no belief worth proposing. Required — silence would be indistinguishable from a skip. */
      readonly why: string;
      readonly reviewedAtIso: string;
      readonly run: string;
    };

/**
 * One row of the queue that is a candidate belief — the arm with a claim, a quote and a hold.
 *
 * Named because three readers want exactly this arm and nothing else: the briefing block the owner reads, the
 * reader that decides which proposals are still open, and the verb that prints one back. Spelling it as an
 * `Extract` rather than as a fourth interface keeps {@link BeliefProposal} the single declaration of the
 * shape — a hand-written copy is the doc-drift this repository keeps paying for.
 */
export type ProposedBelief = Extract<BeliefProposal, { kind: "proposed" }>;

/** One row of the queue that is the owner's reaction to a proposal. See {@link ProposedBelief} for why it is an alias. */
export type AnsweredProposal = Extract<BeliefProposal, { kind: "answered" }>;

/** One row saying a unit carried nothing worth proposing. See {@link ProposedBelief} for why it is an alias. */
export type NoProposal = Extract<BeliefProposal, { kind: "none" }>;

/**
 * What a scan actually reached, stated on every batch.
 *
 * A count of units is not a claim about the owner's speech, and this repository has been bitten by the difference:
 * a completeness claim carries its watermark or it is a guess wearing a number. Each field answers a
 * different question, and `unreadable` is the one that keeps the rest honest.
 */
export interface VoiceWatermark {
  /** When the scan read the sources. */
  readonly scannedAtIso: string;
  /** How many recordings were read, across every family. */
  readonly recordings: number;
  /** How many distinct units those recordings collapsed to. */
  readonly units: number;
  /** How many of those units already carry a proposal row. */
  readonly reviewed: number;
  /** Every source this scan could not read, with its own reason. Never silently dropped. */
  readonly unreadable: readonly VoiceUnreadable[];
  /** Which families were asked for, so a narrowed scan cannot read as a whole one. */
  readonly kinds: readonly VoiceSourceKind[];
}

/** One source a scan asked for and could not read. */
export interface VoiceUnreadable {
  readonly locator: string;
  readonly why: string;
}
