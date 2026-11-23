/**
 * What ONE autonomous act is, and what the owner's retroactive steer on it is — the two row shapes every
 * other module in `src/autonomy` reads, writes or refuses. Pure data: no behaviour, no I/O, no clock.
 *
 * ## Why this register exists
 *
 * The fleet works at a level of autonomy where an obvious action on the owner's team-facing work is TAKEN
 * rather than asked about. The recording half comes with it: a ledger the owner can look at, simpler than the
 * react-now page, showing what the fleet took at that level, so the owner has the chance to give a retroactive
 * steer on something they would have been fine with that the fleet did not do, or something it did do that
 * they were not fine with.
 *
 * So the register's purpose is not audit. It is STEERING: every field exists because the owner needs it to
 * judge the act, and the field carrying the thing they judge is {@link AutonomyActionRow.why}.
 *
 * ## An act is an OCCURRENCE, including one that was refused
 *
 * The register's second real row, written before this module existed, is a `press-merge-when-ready-refused`:
 * GitHub turned the press down and the session recorded the attempt and why it failed. That is not an
 * accident to normalise away — it is exactly what the owner asked to see, since an act the fleet tried and could
 * not complete is a steer they might want to give. So `doneIso` is when the act was TAKEN, never a claim that
 * the external world changed, and {@link AutonomyActionRow.witness} is the authority on what actually
 * happened. Nothing in this module or its readers may render a refused attempt as a success.
 *
 * ## Why `kind` is an open vocabulary
 *
 * Exactly `../knowledge/types.ts`'s reasoning about `LessonRow.domain`, and with more force here. A closed
 * set would REFUSE to record the first act of a kind nobody enumerated — the moment a register whose whole
 * value is completeness is worth the most. `press-merge-when-ready-refused` is the proof: nobody drafting an
 * enum in advance writes it, and it is the more interesting of the two rows that existed. It is a validated
 * slug rather than free text, so it still projects to a checked `text` column instead of an enum, and every
 * reader must be able to DISPLAY an unknown kind rather than depending on membership of a list.
 *
 * ## Why `subject` is a bare identifier and its label is DERIVED
 *
 * The field is a checkable id such as a PR URL or Slack permalink. A URL is the common
 * form and not the whole of it — `./subject.ts` carries the three this register accepts and the measurement
 * that settled them. A second stored `label` field would be a second thing to get wrong and a place for a
 * row to describe a pull request it does not point at — so `../autonomy/label.ts` derives the label from the
 * subject instead, and a row can only mislabel its subject by naming the wrong one.
 *
 * ## Why the owner's steer is a ROW as well as a field
 *
 * The register calls for a steer field the supervisor fills from the owner's word, and
 * the register is append-only, so a writer filling that field in place would destroy the property that makes
 * a ledger worth reading. So a later steer arrives as its OWN appended {@link AutonomySteerRow} carrying the
 * action's id, and `./query.ts` folds the latest one onto its action at read time. An action row may still
 * carry an inline `steer` — that is the right shape for a session recording an
 * act the owner had already spoken about — and a later steer event supersedes it. The projection a reader sees has
 * one steer; the file keeps every one of them, including the word it replaced.
 */
import type { CorruptRowError } from "./errors.js";

/**
 * The shape a `kind` and an `actionId` share: lowercase, digits, and single hyphens or dots between them.
 *
 * The DOT is here because the fleet's own vocabulary already uses it. This register had six real rows by the
 * time the pattern was fixed, written by three different sessions, and three of them carried kinds shaped
 * like `slack.post.bot.no-fold` and `slack.post.as-me.one-card` — the dotted `<surface>.<verb>` spelling the
 * door ledger has used since August. A pattern refusing that would have refused half the register on the day
 * it was written, which is the same failure a closed `kind` vocabulary would have been. Reproduce with
 * `cut -d'"' -f8 "$SLOPWEAVER_HOME/ledgers/autonomy.jsonl" | sort -u`.
 *
 * It is still a validated slug rather than free text: one separator at a time, never leading or trailing, so
 * it projects to a checked column and reads back as words when `../autonomy/label.ts` unpicks it.
 */
export const AUTONOMY_SLUG_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

/**
 * A handover board row slug as the board itself writes one — the same separators as {@link AUTONOMY_SLUG_PATTERN},
 * but either case, because the board does not fold its slugs. Measured: a finding row slugged
 * `a-killed-doneWhen-probe-…` could not be named as the subject of its own pull request's ledger row, so the
 * finding door stayed shut. Reproduce with `ls "$SLOPWEAVER_HOME/handovers" | grep '[A-Z]'`.
 */
export const AUTONOMY_BOARD_SLUG_PATTERN = /^[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*$/;

/** The shortest and longest an action `kind` may be. */
export const AUTONOMY_KIND_MIN = 2;
export const AUTONOMY_KIND_MAX = 60;

/** The shortest and longest an `actionId` may be. */
export const AUTONOMY_ACTION_ID_MIN = 2;
export const AUTONOMY_ACTION_ID_MAX = 80;

/**
 * The longest `why` may be.
 *
 * This is a SERIALISATION bound, not a prose cap, and the distinction matters: `why` is what the owner reads
 * to decide whether they agree, it renders inside a fold nothing forces them through, and a cap that made a
 * session abbreviate its reasoning would cost the exact thing the register exists for. The number exists so one
 * row cannot be a document; it is not an instruction to write less. Measured over the whole live
 * register: the longest real `why` was 1,330 characters and the longest `witness` 829. Reproduce both with
 * `slopweaver autonomy list --json | jq -s 'map(.action) | {why: (map(.why | length) | max), witness:
 * (map(.witness | length) | max)}'`.
 */
export const AUTONOMY_WHY_MAX = 4000;

/** The longest `witness` may be — a verb and the line it printed, never a transcript. Same bound, same reason. */
export const AUTONOMY_WITNESS_MAX = 4000;

/**
 * The longest `said` may be, and the ONE cap here that is a prose bound rather than a serialisation one.
 *
 * Every other bound exists so a row cannot be a document. This one exists because `said` is the line the
 * owner MEETS, and it is a serialisation bound even so — a said they read is capped in WORDS, by
 * `./said.ts`'s `pastTheFold`, which is the check that actually holds the card's budget.
 *
 * **The two are not interchangeable.** 400 characters is not 60 words of ordinary English with room to
 * spare, so the cap is not a bound the card never has to fold. Measured, in both directions: a 379-character
 * line ran to 69 words, and a 371-character DERIVED line lost its provenance sentence off the fold. So this number bounds
 * the row on disk and `pastTheFold` bounds the sentence on the page; a line can cross either one alone.
 */
export const AUTONOMY_SAID_MAX = 400;

/** The longest `bySession` may be. Wide enough for the workspace, the run slug and the session id together. */
export const AUTONOMY_SESSION_MAX = 300;

/** The longest a steer may be. The owner's own words, not a session's summary of them. Same serialisation bound. */
export const AUTONOMY_STEER_MAX = 4000;

/** The longest a subject URL may be. */
export const AUTONOMY_SUBJECT_MAX = 500;

/** The longest a `run` slug may be. */
export const AUTONOMY_RUN_MAX = 200;

/**
 * One act a session took under graduated autonomy, as it is written to the register and read back.
 *
 * Every field is a scalar, for `../knowledge/types.ts`'s reason: a nested object or a sometimes-array facet
 * turns a later projection into a reshaping rather than one `insert … select`.
 */
export interface AutonomyActionRow {
  /** The occurrence's id, chosen by the session that acted. See `./row.ts`'s {@link buildAutonomyAction}. */
  readonly actionId: string;
  /** What was done, as a validated slug. An OPEN vocabulary — see the file overview. */
  readonly kind: string;
  /** The checkable id of the thing acted on — one of `./subject.ts`'s three forms. */
  readonly subject: string;
  /** When the act was TAKEN — never a claim that the external world changed. The witness says that. */
  readonly doneIso: string;
  /** Which session did it — the workspace, run slug and session id it can be found by. */
  readonly bySession: string;
  /** What made it obvious the owner would want it. The fleet's own note — written for the next session, not for the owner. */
  readonly why: string;
  /**
   * What was done, to what, and why it mattered, in words the owner reads — the line the console's act card shows.
   *
   * Optional on the TYPE and required by the verb, and that split is load-bearing rather than a compromise.
   * `./row.ts`'s `parseAutonomyLine` re-runs `buildAutonomyAction` over every stored line, so a field made
   * mandatory in the builder refuses every row written before it existed and takes the whole register off
   * `autonomy list` and off the Fleet Briefing at once — which is the exact failure `./adopt.ts` was
   * written to undo. So presence is the verb's rule and VALIDITY is the builder's: whenever a `said` is
   * present, anywhere, `./said.ts`'s criterion has already passed over it.
   */
  readonly said?: string;
  /** The verb that was run and the line it printed — what makes the act checkable rather than asserted. */
  readonly witness: string;
  /** The board row it was done on, when the acting session was executing one. */
  readonly run?: string;
  /** The owner's word about the act, when the session recording it already had one. A later steer supersedes it. */
  readonly steer?: string;
}

/**
 * The owner's retroactive steer on one act, appended after the fact.
 *
 * `bySession` names the session that RECORDED the steer, which is the supervisor rather than the owner — they
 * speak to one chat and it writes things down. That is provenance, never authentication: the steer's authority
 * is that it is the owner's word, and `.claude/rules/cross-session-messages.md` already governs how a relayed word is
 * handled. Nothing here proves a human typed it, and nothing here should be read as proving it.
 */
export interface AutonomySteerRow {
  /** The {@link AutonomyActionRow.actionId} this judges. */
  readonly actionId: string;
  /** The owner's word about the act, as close to verbatim as the session recording it can make it. */
  readonly steer: string;
  /** When it was recorded. Its PRESENCE is what tells this row apart from an action — see `./row.ts`. */
  readonly steeredIso: string;
  /** Which session wrote it down. */
  readonly bySession: string;
}

/**
 * The prefix every class steer's `actionId` carries, and no act's id may: `class.<classId>`.
 *
 * A class steer is written as a steer row naming an act that will never exist, ON PURPOSE. A build that
 * predates this row shape reads it as a steer on an unknown act, which its fold already drops silently
 * (`./query.ts`'s `foldAutonomy`), and its fleet-store projector mirrors it as an ordinary steer. A new
 * discriminator field would instead read as an act missing every required field there, and a reader REFUSES
 * the whole register on one such line — so every session still running an older checkout would lose
 * `autonomy list` and `autonomy record` the moment the first class steer was appended.
 */
export const AUTONOMY_CLASS_ID_PREFIX = "class.";

/**
 * The prefix a class steer SCOPED to one place carries instead: `class-scoped.<classId>`.
 *
 * A second prefix rather than an optional field on a `class.` row, for {@link AUTONOMY_CLASS_ID_PREFIX}'s own
 * reason one step on: a build that knows `class.` but not scopes would read a scoped `class.` row, ignore the
 * field it has never heard of, and settle the kind EVERYWHERE — the two channel posts the owner's bot DM
 * word does not cover among them. Under this prefix that build sees a steer on an unknown act and settles
 * nothing. Disjoint from `class.` by its hyphen, so no id can carry both.
 */
export const AUTONOMY_SCOPED_CLASS_ID_PREFIX = "class-scoped.";

/**
 * The class-steer prefix an id carries — scoped or not — or undefined when it names an act.
 *
 * The ONE place both prefixes are reserved, so an act, a per-act steer and the decoder cannot disagree about
 * which ids are the owner's standing word.
 *
 * @param actionId the id to classify
 * @returns the prefix it carries, or undefined
 */
export function classIdPrefixOf({ actionId }: { actionId: string }): string | undefined {
  return [AUTONOMY_CLASS_ID_PREFIX, AUTONOMY_SCOPED_CLASS_ID_PREFIX].find((prefix) => actionId.startsWith(prefix));
}

/** The longest a class steer's `kinds` list may be, serialised. */
export const AUTONOMY_CLASS_KINDS_MAX = 2000;

/** The longest a class steer's `anchor` may be — a transcript id, a permalink, a talk row. */
export const AUTONOMY_ANCHOR_MAX = 500;

/**
 * The owner's STANDING word on a whole class of act, settling every act of the kinds it names — before and
 * after it.
 *
 * A steer already given on a certain class of check-in applies to every check-in of that class, so the owner
 * reacts only to what is left rather than being asked the same question again.
 *
 * A steer row in every field it shares with one — see {@link AUTONOMY_CLASS_ID_PREFIX} for why — plus the
 * exact kinds it settles and where the owner said it. `kinds` is ONE comma-joined scalar of exact kind slugs,
 * because every field on this register is a scalar (see {@link AutonomyActionRow}) and a slug cannot hold a
 * comma. Membership is string equality against an act's `kind`: no prefix, no pattern, since the vocabulary
 * is open and a pattern would settle a kind nobody had read yet. The latest row per class is that class's
 * whole current list, so re-recording a class with a kind removed takes the kind back out.
 *
 * `subjectPrefix` narrows a class to the acts whose subject STARTS WITH one literal, never a pattern, because the
 * owner's word is sometimes about a kind in one place only: the fleet may post as the owner in their own bot
 * DM, and the same `slack.post.as-me` kind aimed at a channel is a message to people the owner has not ruled
 * on.
 */
export interface AutonomyClassSteerRow extends AutonomySteerRow {
  /** Exact kind slugs, comma-joined with no spaces, each passing the `kind` grammar, none repeated. */
  readonly kinds: string;
  /** Where the owner said it — checkable, never a paraphrase of it. */
  readonly anchor: string;
  /** A literal an act's subject must start with for this class to settle it; absent settles every subject. */
  readonly subjectPrefix?: string;
}

/**
 * The owner's one word on a PATTERN of acts, as the fold projects it onto each earlier act in it: which act
 * they actually gave it on, and what it said.
 *
 * Seven check-ins can each ask about one rebase of the same kind: seven rows, one question, so one card
 * and one word. A pattern is the acts
 * `./query.ts`'s `autonomyPatternKeys` joins: one kind, on one subject or written up in one identical `said`.
 *
 * The NEWEST act of a pattern governs it, for the reason two presses on one pull request always folded that
 * way: the owner's word on it is given with every earlier act already on the page, while a word only on an
 * earlier act is given before the later one exists and cannot settle it. Derived, not appended — one decision
 * is one steer row, and writing it N times over would overwrite a more specific word given on one earlier act.
 */
export interface AutonomyPatternSteer {
  /** The act the owner gave the word on — the newest of the pattern, never this act. */
  readonly actionId: string;
  /** The owner's word on it, verbatim as that act carries it. */
  readonly steer: string;
}

/** Any row the register may carry. Told apart by complete, disjoint validation — see `./row.ts`. */
export type AutonomyRecord = AutonomyActionRow | AutonomySteerRow | AutonomyClassSteerRow;

/**
 * One act with the owner's latest word on it — what every reader of this register actually gets.
 *
 * Two fields rather than an action type with its `steer` already merged, because the two halves come from
 * different lines written at different times by different sessions, and a reader that cannot tell which
 * fields are the owner's from which are the acting session's has been handed a shape that hides the distinction the
 * whole register is about.
 *
 * `latestSteer` is latest in APPEND ORDER rather than by its own timestamp, matching
 * `../sessionStart/lockIn.ts`'s fold: a clock a writer supplies is a clock a writer can get wrong, and the
 * file's own order is the one fact no writer can misreport.
 */
export interface AutonomyAction {
  readonly action: AutonomyActionRow;
  /** The owner's latest word on this act, or absent when none is given. */
  readonly latestSteer: AutonomySteerRow | undefined;
  /**
   * The owner's word on the newest act of this act's PATTERN, carried onto every earlier act of it — or absent when that
   * act carries no word of its own, or when this act IS that act. Derived at read time, never a ledger row:
   * see {@link AutonomyPatternSteer}. Outranked by a word on this act, and outranks a class steer.
   */
  readonly patternSteer: AutonomyPatternSteer | undefined;
  /**
   * The owner's standing word on this act's whole KIND, or absent when no class names it. Outranked by any word on
   * the act itself — see `./query.ts`'s `steerOf`.
   */
  readonly classSteer: AutonomyClassSteerRow | undefined;
}

/** What an append reports back: which act, and whether anything was actually written. */
export interface AutonomyAppendReceipt {
  readonly actionId: string;
  /** False when the store already held this exact act, so the append was an idempotent no-op. */
  readonly appended: boolean;
}

/**
 * What one read of the register found: every row it could decode, and every line it could not.
 *
 * A record rather than a bare list so that `unparsed` is impossible to ignore at a call site — the caller has
 * to name the field it wants, and the one it did not name is the one that would have gone silent
 * (`../hand/store.ts`'s `HandRegisterRead` makes the same call for the same reason).
 */
export interface AutonomyRegisterRead {
  /** Every decodable record, in the order it was written. */
  readonly records: readonly AutonomyRecord[];
  /** One entry per line that is not a record, in file order. ALWAYS report these; never swallow them. */
  readonly unparsed: readonly CorruptRowError[];
}
