/**
 * What ONE lesson is — the row every other module in `src/knowledge` reads, writes or refuses. Pure data:
 * no behaviour, no I/O, no clock.
 *
 * ## Why there is one register and not one per domain
 *
 * One register where domain is a facet makes sense, so {@link LessonRow}
 * carries `domain` as a field rather than living in a per-domain file. The consequence that matters is that
 * a lesson spanning two systems is ONE row — most of the expensive lessons in this installation have been
 * about the seam between two things rather than about the inside of one.
 *
 * ## Why every facet is a flat scalar with a closed vocabulary
 *
 * Making everything queryable is useful, so the storage half matters: think about different ways the
 * knowledge may be queried over time. The query layer's schema (nothing here is built against it) says what
 * that costs: a nested object, a free-text facet, or a facet that is
 * sometimes an array turns a later projection into a RESHAPING, while flat scalars with closed vocabularies
 * make it one `insert … select` with a constraint per facet.
 *
 * So {@link LessonVerdict}, {@link LessonTier} and {@link LessonSurface} are closed sets, enumerated here.
 * {@link LessonRow.domain} is closed too, by `./domains.ts` rather than by an enum: its vocabulary is the named
 * domains there plus every atlas platform, so a new platform becomes recordable by registering its atlas and
 * the column stays a `text` that grows without a migration. A closed vocabulary replaced an
 * open slug, which had let one system collect four spellings, each splitting its lessons into a separate series.
 *
 * ## Why a later claim can retire an earlier one
 *
 * {@link LessonRow.supersedes} names ONE claim this recording retires — same pick. A claim's own history
 * already corrects itself (the latest recording wins), but a replacement worded differently hashes to a new
 * id, and until this field existed both were recalled side by side. A recording naming a claim retires it
 * only when it is LATER than that claim's own latest recording, so re-recording the old claim afterwards
 * brings it back: "latest recording wins", applied across two claims. One scalar, never a list — retiring two
 * claims is two recordings.
 *
 * ## Why there is ONE field for who learned it, and why it is not part of the id
 *
 * One field names who learned it. The owner's rows and the fleet's sit in the same file, filtered apart by
 * that field. Without it every row would be the fleet's BY CONSTRUCTION — the type would have nowhere to
 * put a person — and the owner's side of the register held zero rows while the fleet's held 188.
 *
 * {@link LessonLearner} is that field, and it is the smallest thing that closes the gap: a closed
 * two-member vocabulary, one flat scalar, projecting to an enum column like every other facet. It is NOT
 * part of the id below, and that is the load-bearing half. The reason the owner's corrections live in
 * THIS register rather than in a store of their own is that id: a second recording of the same claim is
 * automatically the same belief at a later date, and the verdict moving between them is the evolution worth
 * looking at. Hashing the learner in would split that series the moment the owner corrected
 * something the fleet had recorded — which is the one case the mechanism exists for.
 *
 * The consequence a reader handles rather than discovers: a claim can carry recordings from both sides, so
 * anything counting INDEPENDENT learning filters by learner BEFORE it groups. `./query.ts`'s
 * `repeatedLessons` is pure grouping and does not know about the facet; `./declared.ts` and the
 * `knowledge list --repeats` view are the two callers that narrow to `fleet` first.
 *
 * ## Why the id is a hash of the claim and the domain
 *
 * The follow-on: if multiple agents have the same lesson, it is time to turn that lesson into a standing
 * rule or find some way to make it structurally impossible, so that a future agent does not repeat a
 * mistake and have to relearn the lesson.
 *
 * That is only measurable if two sessions recording the same lesson produce the same id. So the id is
 * derived from the normalised claim and the domain and from NOTHING else — not the instant, not the run,
 * not the verdict, all of which move between two recordings of one lesson. The store is append-only, so a
 * repeated id is not a collision to reject: it is the consolidation signal, and `./query.ts`'s
 * `repeatedLessons` is what reads it. This mirrors `../reflect/finding.ts`'s identity rule, which exists for the same reason
 * one level up and was the model for it.
 */

/**
 * What is currently believed about a claim.
 *
 * Taken from the Datadog knowledge register's own ladder, which earned it: of the 978 rows there that a live
 * call could reach, 115 were flat wrong and 236 had moved. A store with no verdict field would have reported
 * all 978 with equal confidence.
 *
 * `unsettled` merges that register's "awaiting your call" and "settled by your ruling" into one state,
 * because the distinction between them is WHO settles it rather than what is known, and the owner's ruling
 * is recorded on the row's evidence rather than as a verdict of its own.
 */
export type LessonVerdict = "confirmed" | "changed" | "refuted" | "untestable" | "unsettled";

/** Every verdict, in the order a reader should work down. Enumerated so a parse can validate one. */
export const LESSON_VERDICTS: readonly LessonVerdict[] = ["confirmed", "changed", "refuted", "untestable", "unsettled"];

/**
 * How much a lesson costs when it is not known, lowest number worst.
 *
 * Tier 1 holds TWO things rather than one, and that is the part worth carrying rather than re-deriving: an
 * irreversible harm, OR a measured wrong answer returned as a success. An earlier ranking used silence
 * alone, and an adversarial pass showed that mistakes detectability for protection — a loud but
 * irreversible failure outranks a silent but bounded one.
 */
export type LessonTier = 1 | 2 | 3 | 4;

/** Every tier, worst first. */
export const LESSON_TIERS: readonly LessonTier[] = [1, 2, 3, 4];

/** What each tier holds, for a refusal message and for `knowledge list` output. */
export const LESSON_TIER_MEANINGS: Readonly<Record<LessonTier, string>> = {
  1: "irreversible harm, or a measured wrong answer returned as success",
  2: "silent failure — a wrong answer with no error raised",
  3: "loud failure — cost, a rate limit, a 404. Real, but you find out immediately",
  4: "a convention, a recipe, or a snapshot that moves",
};

/**
 * Where the lesson was learned, which is not the same question as which domain it is about.
 *
 * Closed because a projection wants an enum here, and because the set is a property of how this
 * installation reaches anything at all rather than of any one platform.
 */
export type LessonSurface = "api" | "browser" | "cli" | "repo" | "process";

/** Every surface. */
export const LESSON_SURFACES: readonly LessonSurface[] = ["api", "browser", "cli", "repo", "process"];

/**
 * WHOSE lesson this is — the fleet's, or the owner's own.
 *
 * Two members and no more. A per-session or per-person identifier was the obvious next thing to reach for
 * and is refused: `run` already names the board row a fleet lesson was learned on, checkable in one command,
 * and `.claude/rules/cross-session-messages.md` is explicit that an assignment names a branch, PR or SHA and
 * never a session. What was missing was not finer attribution of the fleet's rows — it was the existence of
 * a side that is not the fleet's.
 *
 * `owner` means the OWNER holds the belief: a claim about how the owner's own system works that they made,
 * and a verdict they corrected. A fleet session may RECORD one on the owner's behalf (the owner speaks, the
 * session writes), and the row is still the owner's — the field says whose knowledge is being tracked, never
 * whose fingers typed it.
 */
export type LessonLearner = "fleet" | "owner";

/** Every learner. Enumerated so a parse and a CLI flag can validate one. */
export const LESSON_LEARNERS: readonly LessonLearner[] = ["fleet", "owner"];

/**
 * What a row means when it carries no `learner` at all — every row written before the field existed.
 *
 * A default rather than a refusal, because those rows are not malformed: the register had no field for a
 * person, so each of them IS the fleet's, and reading them as anything else would invent an attribution
 * nobody made. `./row.ts`'s `parseLessonLine` applies it only to an ABSENT property; a present value outside
 * the vocabulary is corruption and is refused.
 */
export const LESSON_LEARNER_DEFAULT: LessonLearner = "fleet";

/**
 * A domain slug's SHAPE: lowercase, digits and single hyphens, 2–40 characters.
 *
 * The shape every stored row must have, including one restored from a backup written before the vocabulary
 * closed. Whether a WRITER may use a slug is the stricter question `./domains.ts` answers.
 */
export const LESSON_DOMAIN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The shortest and longest a domain slug may be. */
export const LESSON_DOMAIN_MIN = 2;
export const LESSON_DOMAIN_MAX = 40;

/** The longest a claim may be. A lesson that will not fit in a sentence is two lessons or a document. */
export const LESSON_CLAIM_MAX = 400;

/**
 * One lesson, as it is written to the register and read back.
 *
 * Every field is a scalar. There is no array and no nested object anywhere on this type, and adding one is
 * the change that makes the eventual projection expensive — see the file overview.
 */
export interface LessonRow {
  /** Stable across two recordings of the same lesson — a hash of `domain` and the normalised `claim`. */
  readonly id: string;
  /** Which system this is about. One of `./domains.ts`'s vocabulary, never free text. */
  readonly domain: string;
  /** The lesson itself, in one sentence, phrased so it is true or false rather than merely interesting. */
  readonly claim: string;
  /** What is currently believed about the claim. */
  readonly verdict: LessonVerdict;
  /** What it costs when it is not known. */
  readonly tier: LessonTier;
  /** Where it was learned. */
  readonly surface: LessonSurface;
  /**
   * Whose lesson this is. See {@link LessonLearner}; a stored row without one reads as
   * {@link LESSON_LEARNER_DEFAULT}.
   */
  readonly learner: LessonLearner;
  /** What was actually observed. Never the claim restated — the measurement that produced it. */
  readonly evidence: string;
  /** When this recording was made. */
  readonly recordedAtIso: string;
  /**
   * The board row this was learned on, or `ad-hoc` when there was none.
   *
   * A run SLUG rather than a session name, deliberately: `.claude/rules/cross-session-messages.md` — an
   * assignment names a branch, PR or SHA and never a session, because who did a piece of work is not
   * checkable in one command and a slug is.
   */
  readonly run: string;
  /** The command that settles it again, when one exists. What makes a re-check a job rather than a re-investigation. */
  readonly repro?: string;
  /** What the evidence does NOT establish. Absent when there is nothing to say, never `"none"`. */
  readonly caveat?: string;
  /** The claim id this recording retires, when it replaces one — see the file overview. */
  readonly supersedes?: string;
}
