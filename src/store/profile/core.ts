/**
 * The pure half of profile curation: hashing, parsing, merging and rendering.
 *
 * Everything here is a function of its arguments, so the shape of a judgement payload, the rule that
 * makes a re-import idempotent and the lines a session actually reads are all testable without a
 * database. The effectful half — the reads, the writes and the optimistic-write predicate — is
 * {@link ./client}.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "../../lib/result.js";

import { type ProfileError, ProfileErrors } from "./errors.js";
import {
  issuePath,
  type OwnerSelfDescription,
  ownerSelfDescriptionSchema,
  type PersonJudgement,
  PROFILE_PAYLOAD_SCHEMA_VERSION,
  percentilesAreOrdered,
  personJudgementSchema,
  type SourcedStatement,
  type VoiceCohort,
  voiceCohortSchema,
} from "./types.js";

/**
 * The content hash one statement carries, over its own text.
 *
 * `sha256:<hex>` rather than a bare hex string so a reader can tell at a glance what produced it, the
 * same spelling `JudgementExample.sourceHash` uses in `live/turn/judgementProfile.ts`.
 *
 * @param text the statement's own text, exactly as it will be stored
 * @returns the prefixed hex digest
 */
export function statementHash({ text }: { text: string }): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/**
 * Turn loose text into an attributed statement, hashing it rather than trusting a caller to.
 *
 * A caller that computed its own hash could compute it over something other than the text it stored,
 * which is the one way the idempotence below can silently stop working. So the hash is never an input.
 *
 * @param text what was observed
 * @param observedAt the ISO instant it was observed, never the instant of import
 * @param source where it was read — a permalink, a citation, or a `file:` path
 * @returns the statement, with its hash computed
 */
export function statement({
  text,
  observedAt,
  source,
}: {
  text: string;
  observedAt: string;
  source: string;
}): SourcedStatement {
  return { observedAt, source, sourceHash: statementHash({ text }), text };
}

/** Every Zod issue as one readable line, so a refusal names all of them rather than the first. */
function issueLines({
  error,
}: {
  error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
}): readonly string[] {
  return error.issues.map((issue) => `${issuePath({ path: issue.path })}: ${issue.message}`);
}

/**
 * Read one person's judgement payload, refusing anything that is not exactly the current shape.
 *
 * @param value the stored or supplied payload, unvalidated
 * @returns the judgement, or every schema issue at once
 */
export function parsePersonJudgement({ value }: { value: unknown }): Result<PersonJudgement, ProfileError> {
  const parsed = personJudgementSchema.safeParse(value);
  if (!parsed.success) {
    return err(ProfileErrors.payloadInvalid({ issues: issueLines({ error: parsed.error }) }));
  }
  return ok(parsed.data);
}

/**
 * Read the owner's self-description, refusing anything that is not exactly the current shape.
 *
 * @param value the stored or supplied payload, unvalidated
 * @returns the self-description, or every schema issue at once
 */
export function parseOwnerSelfDescription({ value }: { value: unknown }): Result<OwnerSelfDescription, ProfileError> {
  const parsed = ownerSelfDescriptionSchema.safeParse(value);
  if (!parsed.success) {
    return err(ProfileErrors.payloadInvalid({ issues: issueLines({ error: parsed.error }) }));
  }
  return ok(parsed.data);
}

/**
 * Read one voice cohort, refusing both a schema failure and percentiles that cannot be true.
 *
 * The ordering check is here rather than in the Zod schema because it is a relation between three fields,
 * and rather than in a database CHECK because a caller wants the COHORT named — "slack/all-sent reports
 * p75 below its median" is actionable and "new row for relation violates check constraint" is not.
 *
 * @param value the supplied cohort, unvalidated
 * @returns the cohort, or every issue at once
 */
export function parseVoiceCohort({ value }: { value: unknown }): Result<VoiceCohort, ProfileError> {
  const parsed = voiceCohortSchema.safeParse(value);
  if (!parsed.success) {
    return err(ProfileErrors.payloadInvalid({ issues: issueLines({ error: parsed.error }) }));
  }
  if (!percentilesAreOrdered({ cohort: parsed.data })) {
    return err(
      ProfileErrors.payloadInvalid({
        issues: [
          `${parsed.data.surface}/${parsed.data.cohort}: the percentiles present do not ascend — ` +
            "median, p75 and p90 must not decrease.",
        ],
      }),
    );
  }
  return ok(parsed.data);
}

/**
 * A judgement payload with nothing in it yet, for a person nobody has curated.
 *
 * Never written to the column — the column's `null` is what "uncurated" means, and a row of empty
 * buckets would be indistinguishable from a person measured to have no preferences. This is the starting
 * point a curation verb builds ON, in memory.
 *
 * @param nowIso the instant this curation began
 * @returns an empty judgement at revision 1
 */
export function emptyPersonJudgement({ nowIso }: { nowIso: string }): PersonJudgement {
  return {
    channelPreferences: [],
    curatedAt: nowIso,
    facts: [],
    noTriggers: [],
    register: [],
    reviewerRoles: [],
    schemaVersion: PROFILE_PAYLOAD_SCHEMA_VERSION,
    revision: 1,
    yesTriggers: [],
  };
}

/**
 * Merge incoming statements into existing ones, keeping one statement per distinct TEXT.
 *
 * Keyed on `sourceHash`, which is the hash of the text, so re-running an import writes nothing new — the
 * property that lets a harvest be run twice without doubling every bucket. The EXISTING statement wins a
 * collision rather than the incoming one, because the existing row carries whatever a human corrected
 * about its attribution and the importer would put the file's version back.
 *
 * @param existing what the column already holds
 * @param incoming what an import or a curation is adding
 * @returns the existing statements, then every incoming one whose text is not already present
 */
export function mergeStatements({
  existing,
  incoming,
}: {
  existing: readonly SourcedStatement[];
  incoming: readonly SourcedStatement[];
}): readonly SourcedStatement[] {
  const seen = new Set(existing.map((entry) => entry.sourceHash));
  const added = incoming.filter((entry) => !seen.has(entry.sourceHash));
  return [...existing, ...added];
}

/** The buckets a judgement carries, in the order a reader wants them, with the label each prints under. */
const JUDGEMENT_BUCKETS = [
  { key: "facts", label: "facts" },
  { key: "channelPreferences", label: "reach them on" },
  { key: "register", label: "register" },
  { key: "yesTriggers", label: "says yes to" },
  { key: "noTriggers", label: "says no to" },
  { key: "reviewerRoles", label: "reviews" },
] as const satisfies readonly { key: keyof PersonJudgement; label: string }[];

/**
 * One person's judgement as lines, with every statement carrying when it was observed.
 *
 * The date is on every line rather than summarised once, because the buckets age at different rates: a
 * channel preference observed in May and a reviewer role observed yesterday are both current-looking
 * prose, and a single "curated on one date" header would make the stale half look fresh.
 *
 * @param judgement what the column holds
 * @returns one line per statement, grouped by bucket, empty buckets omitted
 */
export function judgementLines({ judgement }: { judgement: PersonJudgement }): readonly string[] {
  return JUDGEMENT_BUCKETS.flatMap((bucket) => {
    const entries = judgement[bucket.key];
    if (!Array.isArray(entries) || entries.length === 0) {
      return [];
    }
    return (entries as readonly SourcedStatement[]).map(
      (entry) => `${bucket.label}: ${entry.text} (observed ${entry.observedAt.slice(0, 10)})`,
    );
  });
}

/**
 * One cohort as a single line, saying plainly which statistics were never measured.
 *
 * An absent percentile prints as `—` rather than being dropped, so a reader can tell a surface that was
 * measured and came back short from a surface nobody ever measured. That distinction is the whole reason
 * the columns are nullable.
 *
 * @param cohort the cohort to render
 * @returns the line
 */
export function voiceCohortLine({ cohort }: { cohort: VoiceCohort }): string {
  const stat = ({ value }: { value: number | null }): string => (value === null ? "—" : String(value));
  const ceiling = cohort.ceilingWords === null ? "" : `, ceiling ${String(cohort.ceilingWords)}`;
  const sample = cohort.sampleCount === null ? "" : `, n=${String(cohort.sampleCount)}`;
  return (
    `${cohort.surface}/${cohort.cohort}: median ${stat({ value: cohort.medianWords })}, ` +
    `p75 ${stat({ value: cohort.p75Words })}, ` +
    `p90 ${stat({ value: cohort.p90Words })}${ceiling}${sample} (measured ${cohort.measuredAt.slice(0, 10)})`
  );
}
