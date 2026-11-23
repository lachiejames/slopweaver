/**
 * The per-source facts slice of the supervisor tick row schema (`./tickSchema.ts`), with the two shared field
 * shapes every part of the row reads. Split out so the row schema stays under the size cap; `./tickSchema.ts`
 * still wraps each facts schema in its observation and composes the row.
 */
import { z } from "zod";

/** An ISO instant a clock can parse. Used for every instant in the row, so one wrong shape reads one way. */
export const isoInstant = z.iso.datetime({ offset: true });

/** A non-empty string. The ledger has no use for a field that is present and says nothing. */
export const text = z.string().min(1);

/** The bot listener's grade. */
export const listenerFacts = z
  .object({
    armId: text,
    grade: text,
    pid: z.number().int().nullable(),
    socketState: text,
    why: text,
  })
  .strict();

/** The board and intake counts, and the two generated sentences the briefing takes verbatim. */
export const reconcileFacts = z
  .object({
    alignedCount: z.number().int().nonnegative(),
    headline: text,
    intakeClause: text,
    misalignedCount: z.number().int().nonnegative(),
    openReadyCount: z.number().int().nonnegative().optional(),
    rankedCount: z.number().int().nonnegative(),
    starvingCount: z.number().int().nonnegative(),
    staleAskCount: z.number().int().nonnegative(),
    unregisteredCount: z.number().int().nonnegative(),
  })
  .strict();

/** One live session the watch reported. */
const watchRowFacts = z
  .object({
    on: text,
    session: text,
    state: text,
  })
  .strict();

/** The fleet reading, with the suppressed count the JSON output does not carry. */
export const watchFacts = z
  .object({
    rows: z.array(watchRowFacts),
    suppressed: z.number().int().nonnegative(),
  })
  .strict();

/** `session close-done`'s counts. */
export const closeDoneFacts = z
  .object({
    closedChats: z.number().int().nonnegative(),
    closedLedgerRows: z.number().int().nonnegative(),
    heldBusy: z.number().int().nonnegative(),
    keptOpen: z.number().int().nonnegative(),
  })
  .strict();

/** One session's context depth. */
const depthRowFacts = z
  .object({
    respawnCandidate: z.boolean(),
    session: text,
    tokens: z.number().int().nonnegative(),
  })
  .strict();

/** Every session the depth read covered. */
export const depthFacts = z.object({ rows: z.array(depthRowFacts) }).strict();

/** One due automation. */
const recipeDueRowFacts = z
  .object({
    heldBy: text.nullable(),
    id: text,
    label: text,
    lateMinutes: z.number(),
    runs: z.enum(["in-process", "spawn"]),
  })
  .strict();

/** The due-ask reading. */
export const recipeDueFacts = z.object({ rows: z.array(recipeDueRowFacts) }).strict();

/** The machine's pace, carrying the verb's own caution. */
export const velocityFacts = z
  .object({
    caution: text,
    docsLandedToday: z.number().int().nonnegative(),
  })
  .strict();

/** The friction review's standing: whether a report waits, and whether anything still writes them. */
export const frictionFacts = z
  .object({
    hasGap: z.boolean(),
    // Optional: every row journalled before this field existed carries none, and `.strict()` with a required key here
    // refused 653 rows of the real ledger's own history.
    isStale: z.boolean().optional(),
    newestReport: text.nullable(),
  })
  .strict();

/**
 * One open pull request.
 *
 * `mergeable` and `rollup` are free strings rather than enums on purpose: they are GitHub's own words, and
 * this repository takes a provider's word for provider state rather than re-spelling it in a vocabulary we
 * do not own.
 */
const githubPullRequestFacts = z
  .object({
    draft: z.boolean(),
    mergeable: text,
    number: z.number().int().positive(),
    repo: text,
    rollup: text,
    title: text,
    url: text,
  })
  .strict();

/** The repository reading. */
export const githubFacts = z
  .object({
    holdStanding: z.boolean(),
    mainSha: text,
    pullRequests: z.array(githubPullRequestFacts),
  })
  .strict();

/** One landing, identified rather than counted. */
const fleetLanding = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("pull-request"),
      landedAtIso: isoInstant,
      landingId: text,
      mergeCommitSha: text,
      number: z.number().int().positive(),
      repo: text,
      title: text,
      url: text,
    })
    .strict(),
  z
    .object({
      kind: z.literal("handover"),
      label: text,
      landedAtIso: isoInstant,
      landingId: text,
      slug: text,
      witness: text,
    })
    .strict(),
]);

/** What landed this interval. */
export const landingsFacts = z.object({ landings: z.array(fleetLanding) }).strict();
