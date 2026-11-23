/**
 * The outcomes the owner stated, as the state home holds them (`workstreams/stated-candidates.json`): an installation's
 * own words, so they live in the home and never in git. Pure: `./candidateStore.ts`'s `readStatedCandidates` is the
 * effectful edge that reads the file.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import { type Candidate, candidateIdSchema, candidateSchema, candidateSetProblems, textSchema } from "./candidates.js";
import { slackChannelOf } from "./slackChannel.js";

/**
 * The document: candidates in the order the owner stated them, and the exact former title of each one retitled since it
 * was answered, keyed by its id.
 */
const statedCandidatesFileSchema = z.strictObject({
  candidates: z.array(candidateSchema),
  formerNames: z.record(candidateIdSchema, textSchema),
  schemaVersion: z.literal(1),
});

/** The stated candidates as a catalog reads them. */
export interface StatedCandidates {
  /** In the order the owner stated them. */
  readonly candidates: readonly Candidate[];
  /** A retitled stated candidate's exact former title, keyed by its id, for `answeredIdConflicts`. */
  readonly formerNames: ReadonlyMap<string, string>;
}

/** No outcome stated: what a home without a stated-candidates file reads as. */
export const NONE_STATED: StatedCandidates = { candidates: [], formerNames: new Map() };

/**
 * Validate a stated-candidates document, with the cross-checks a schema cannot express: unique ids, numbers and names
 * (`candidateSetProblems`), every former name keyed by a candidate the file carries and never any candidate's current
 * title, and no evidence linking into a
 * Slack conversation, since a stated candidate brings no `channels` to name one with.
 *
 * @param path where the document was read from, which a refusal names
 * @param value the parsed JSON
 * @returns the stated candidates, or every problem named
 */
export function parseStatedCandidatesFile({
  path,
  value,
}: {
  path: string;
  value: unknown;
}): Result<StatedCandidates, CandidatesError> {
  const parsed = statedCandidatesFileSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      CandidatesErrors.statedInvalid({
        path,
        problems: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      }),
    );
  }
  const ids = new Set(parsed.data.candidates.map((one) => one.id));
  const current = new Map(parsed.data.candidates.map((one) => [one.name.normalize("NFKC").trim(), one.id] as const));
  const linked = new Set(
    parsed.data.candidates
      .flatMap((one) => one.evidence)
      .flatMap((evidence) => {
        if (evidence.href === null) {
          return [];
        }
        const channel = slackChannelOf({ href: evidence.href });
        return channel === undefined ? [] : [channel];
      }),
  );
  const problems = [
    ...candidateSetProblems({ candidates: parsed.data.candidates }),
    ...Object.keys(parsed.data.formerNames)
      .filter((id) => !ids.has(id))
      .map((id) => `formerNames.${id}: no stated candidate has the id ${id}`),
    ...Object.entries(parsed.data.formerNames).flatMap(([id, former]) => {
      const holder = current.get(former.normalize("NFKC").trim());
      return holder === undefined ? [] : [`formerNames.${id}: "${former}" is the current title of ${holder}`];
    }),
    ...[...linked].map(
      (channel) => `evidence links into Slack channel ${channel}, which a stated candidate has no channels to name`,
    ),
  ];
  if (problems.length > 0) {
    return err(CandidatesErrors.statedInvalid({ path, problems }));
  }
  return ok({ candidates: parsed.data.candidates, formerNames: new Map(Object.entries(parsed.data.formerNames)) });
}
