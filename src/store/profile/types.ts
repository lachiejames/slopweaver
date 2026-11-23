/**
 * What the identity register, the owner's own table and the voice register actually carry.
 *
 * A file per person makes little sense. People are tracked on the identity register, a table in the store, and
 * one column on that table holds facts about that person, a per-person judgement. This module is the shape
 * that column holds.
 *
 * ## Every statement carries where it came from, and that is the whole design
 *
 * A per-person judgement is not derivable, which is exactly why the page ruled it could not be a silver
 * projection. What it can be is ATTRIBUTED: each statement names the record it was read off, when it was
 * observed, and a hash of its own text. Three things follow that a bare string array cannot give a reader.
 * A session can say "prefers a DM, observed on a stated date" rather than asserting a timeless fact about a
 * colleague. A statement whose source moved on is visible as stale rather than silently wrong. And an
 * import can be re-run without duplicating what it already wrote, because the hash is the identity.
 *
 * ## Why this is not a free-form JSON bag
 *
 * The source material this replaces — a 124-line `stakeholder-prefs.md` in the owner's archived state
 * repo — mixes communication preferences with outstanding tasks, vendor commitments and group headings
 * covering three people at once. Copied wholesale into one `notes` field, all of that becomes advice the
 * composer would act on. The named buckets below are the ones an outbound composer or a reviewer
 * suggestion actually consults; anything that does not fit one of them is not per-person judgement and
 * belongs in the corpus, where it already is.
 */
import { z } from "zod";

/** The judgement/owner/voice payload version. A stored payload at another version is refused, not read. */
export const PROFILE_PAYLOAD_SCHEMA_VERSION = 1;

/**
 * One attributed statement: what was observed, when, and off which record.
 *
 * `sourceHash` is `sha256:<hex>` over this statement's own `text`, not over the file it was drawn from —
 * pinning the file would not catch a statement edited after the fact, which is the drift that actually
 * happens. It is recomputable from `text` alone, so an import can prove self-consistency with no access
 * to the original source. This mirrors `JudgementExample` in `live/turn/judgementProfile.ts`, which pins
 * mined voice examples the same way and for the same reason.
 */
const sourcedStatementSchema = z.object({
  /** The statement itself, as it will be shown to a session. */
  text: z.string().min(1, "a sourced statement needs text"),
  /** ISO instant the statement was observed — never the instant it was imported. */
  observedAt: z.iso.datetime({ error: "observedAt must be an ISO instant" }),
  /** Where it was read: a permalink, a corpus citation, or a `file:` path into an archived tree. */
  source: z.string().min(1, "a sourced statement needs a source"),
  /** `sha256:<hex>` over `text`, so a re-import is idempotent and an edit is visible. */
  sourceHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u, "sourceHash must be sha256:<64 hex>"),
});

/** One attributed statement, as every reader here sees it. */
export type SourcedStatement = z.infer<typeof sourcedStatementSchema>;

/** An empty-by-default list of attributed statements, so an absent bucket reads as "nothing recorded". */
const statements = z.array(sourcedStatementSchema).default([]);

/**
 * The per-person judgement column: what is known about one person, in the buckets a composer consults.
 *
 * `facts` is the open bucket for facts about that person, and the other
 * five are the ones the owner's archived `stakeholder-prefs.md` had actually settled into: which channel reaches them,
 * what register lands, what makes them say yes, what makes them say no, and what they review.
 */
export const personJudgementSchema = z.object({
  schemaVersion: z.literal(PROFILE_PAYLOAD_SCHEMA_VERSION),
  /** Anything true about them that is not one of the five below. */
  facts: statements,
  /** Where they actually read things — a DM, a channel, email, never "Slack". */
  channelPreferences: statements,
  /** How to write to them: length, formality, how much preamble survives. */
  register: statements,
  /** What makes them agree — the evidence or framing that has worked. */
  yesTriggers: statements,
  /** What makes them refuse — the framing that has failed. */
  noTriggers: statements,
  /** What they review, so a reviewer suggestion has something to rank on. */
  reviewerRoles: statements,
  /** Bumped on every write, and what an optimistic write is pinned to. */
  revision: z.number().int().min(1),
  /** ISO instant of the last curation, so a reader can say how old this is. */
  curatedAt: z.iso.datetime({ error: "curatedAt must be an ISO instant" }),
});

/** What one person's judgement column holds. `null` in the column means uncurated, never "no preferences". */
export type PersonJudgement = z.infer<typeof personJudgementSchema>;

/**
 * What is known about the owner, global rather than per Claude project.
 *
 * What a session knows about the owner is global, because the plugin is loaded globally and Claude's own
 * project memories split what one project knows from another. Those memories cannot span projects;
 * one row in one database reached by a globally-installed plugin can.
 *
 * `alwaysLoaded` is the small set that is injected into EVERY session. It is separate from `facts` because
 * the two have different costs: a fact is retrieved when it is relevant, an always-loaded line is paid for
 * on every session start, so the set that earns that has to be named rather than computed from a threshold.
 */
export const ownerSelfDescriptionSchema = z.object({
  schemaVersion: z.literal(PROFILE_PAYLOAD_SCHEMA_VERSION),
  /** The very small set injected into every session, whatever the project. */
  alwaysLoaded: statements,
  /** Everything else known about the owner — read on request, never injected. */
  facts: statements,
  /** How the owner works: the preferences a session needs before it writes anything for them. */
  waysOfWorking: statements,
});

/** The owner's own self-description, as the dedicated table holds it. */
export type OwnerSelfDescription = z.infer<typeof ownerSelfDescriptionSchema>;

/**
 * One measured length cohort on one surface.
 *
 * A cohort rather than a bare surface, because the same surface carries different populations: the owner's
 * archived `communication-style.md` measured all of thousands of sampled sent Slack messages at median 14 / p90
 * 54, and a hundreds-message calibration against one colleague at median 7 / p90 18. Collapsing those into one
 * "slack" row would report a number that describes neither.
 *
 * Every statistic is NULLABLE because the source genuinely does not give all of them, and an invented
 * percentile is worse than an absent one. `ceiling` is not required to sit above `p90` — the same source
 * gives p90 54 alongside a 50-word ceiling for a casual reply, because a ceiling is an intent and a
 * percentile is an observation.
 */
export const voiceCohortSchema = z.object({
  /** The outbound surface: `slack`, `slack-dm`, `github`, `linear`, `notion`. */
  surface: z.string().min(1, "a voice cohort needs a surface"),
  /** Which population on that surface, e.g. `all-sent` or `dm-calibration`. */
  cohort: z.string().min(1, "a voice cohort needs a cohort key"),
  medianWords: z.number().int().min(0).nullable(),
  p75Words: z.number().int().min(0).nullable(),
  p90Words: z.number().int().min(0).nullable(),
  /** The intended maximum for this cohort, when one was stated. */
  ceilingWords: z.number().int().min(0).nullable(),
  /** How many messages the statistics were measured over, when the source says. */
  sampleCount: z.number().int().min(0).nullable(),
  /** ISO instant of the measurement itself, never of the import. */
  measuredAt: z.iso.datetime({ error: "measuredAt must be an ISO instant" }),
  /** Where the numbers came from, and how they were counted. */
  source: z.string().min(1, "a voice cohort needs a source"),
  /** What the numbers do NOT cover — the honest residue a percentile alone hides. */
  qualification: z.string().default(""),
});

/** One measured length cohort, as the register holds it. */
export type VoiceCohort = z.infer<typeof voiceCohortSchema>;

/**
 * Every percentile that is present, in ascending order, for the ordering check below.
 *
 * @param cohort the cohort to read
 * @returns the present percentile values, median then p75 then p90
 */
function presentPercentiles({ cohort }: { cohort: VoiceCohort }): readonly number[] {
  return [cohort.medianWords, cohort.p75Words, cohort.p90Words].filter((value): value is number => value !== null);
}

/**
 * Whether one cohort's percentiles are non-decreasing, which is the one arithmetic claim they must meet.
 *
 * Checked separately from the Zod schema because it is a relation between three fields rather than a
 * property of any one of them, and because a caller wants to know WHICH cohort is impossible rather than
 * that some field failed. A cohort missing a percentile passes: absence is not disorder.
 *
 * @param cohort the cohort to check
 * @returns true when every percentile present sits at or above the one before it
 */
export function percentilesAreOrdered({ cohort }: { cohort: VoiceCohort }): boolean {
  const present = presentPercentiles({ cohort });
  return present.every((value, index) => {
    if (index === 0) {
      return true;
    }
    // Every index past the first has a predecessor by construction, so this is a fact rather than a default.
    const previous = present[index - 1]!;
    return value >= previous;
  });
}

/**
 * One Zod issue's path as a reader sees it, naming the whole-document case rather than printing nothing.
 *
 * Spelled once, because both parsers here and the harvest manifest's own report a validation failure the
 * same way and a root-level issue carries an EMPTY path — which prints as a bare `: message` unless the
 * empty case is named.
 *
 * @param path the issue's path segments
 * @returns the dotted path, or `(root)` for an issue about the document itself
 */
export function issuePath({ path }: { path: readonly PropertyKey[] }): string {
  if (path.length === 0) {
    return "(root)";
  }
  return path.map(String).join(".");
}
