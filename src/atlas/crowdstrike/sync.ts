/**
 * `crowdstrike sync` — run every API-surface family, fold each into the stored generation, publish once.
 *
 * The calls live in `syncReaders.ts` and `syncPostureReaders.ts`; what this file owns is what happens to their
 * results. Three judgements, and each is the reason a line of it exists:
 *
 * ## A failed kind keeps its entities and changes only its coverage
 *
 * A read that failed is not an empty result. So a failure writes a coverage cell and a gap and leaves the
 * kind's entities exactly as the previous generation had them — never an empty array, which would report a
 * fleet that vanished. The complementary rule is in `merge.ts`: even a SUCCESSFUL read stales nothing
 * without a proof that it reached the end of its own result set.
 *
 * ## Every kind is folded, then everything is published together
 *
 * `publishAtlas` installs the kind files first and the manifest last, and installs nothing at all unless
 * the whole generation reached disk first, so a run that fails leaves the previous generation untouched. Folding every kind before publishing anything is
 * what lets one bad projection refuse the whole generation rather than write half of it.
 *
 * ## The console kinds are not touched here
 *
 * `console-page` and `console-request` belong to the browser surface and are filled by `consoleWalk.ts`.
 * Passing them to `publishAtlas` is what would truncate them: the kit leaves an omitted kind's file
 * untouched, so omitting them is how the API sync leaves the walk's work alone.
 */

import { absentAsNull } from "#lib/absent.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type AtlasKindStatus, failedKindStatus, succeededKindStatus } from "../kit/kindStatus.js";
import { foldedKind } from "../kit/store.js";
import { CrowdstrikeAtlasErrors, crowdstrikeAtlasErrorLines } from "./atlasErrors.js";
import type { CrowdstrikeClientDeps } from "./client.js";
import {
  crowdstrikeKindScope,
  failedCrowdstrikeCoverageCell,
  replaceCrowdstrikeCoverageCell,
  succeededCrowdstrikeCoverageCell,
} from "./coverage.js";
import type { CrowdstrikeEntity, CrowdstrikeGap, CrowdstrikeKindFile, CrowdstrikeManifest } from "./entities.js";
import type { CrowdstrikeError } from "./errors.js";
import { classifyCrowdstrikeGap, openCrowdstrikeGap, reconcileCrowdstrikeGaps } from "./gaps.js";
import { assembleCrowdstrikeKindFile, emptyCrowdstrikeKindFile, initialCrowdstrikeManifest } from "./kindFiles.js";
import { mergeCrowdstrikeKind } from "./merge.js";
import { CROWDSTRIKE_KINDS, type CrowdstrikeKind } from "./model.js";
import { type CrowdstrikeAtlasPaths, publishCrowdstrikeAtlas, readCrowdstrikeAtlas } from "./store.js";
import {
  readCrowdstrikeDetections,
  readCrowdstrikePolicies,
  readCrowdstrikeZeroTrustAssessments,
  readCrowdstrikeZeroTrustAudit,
} from "./syncPostureReaders.js";
import {
  type KindRead,
  readCrowdstrikeHostGroups,
  readCrowdstrikeHosts,
  readCrowdstrikeVulnerabilities,
} from "./syncReaders.js";

/** The API-surface kinds, in the order a run reads them. The console kinds are the browser walk's. */
export const CROWDSTRIKE_API_KINDS = [
  "host",
  "host-group",
  "prevention-policy",
  "sensor-update-policy",
  "vulnerability",
  "zero-trust-assessment",
  "zero-trust-audit",
  "detection",
] as const;

/** How one kind's attempt resolved, as a run reports it. */
interface CrowdstrikeSyncKindOutcome {
  readonly kind: CrowdstrikeKind;
  readonly entityCount: number;
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

/** What a whole sync did. */
export interface CrowdstrikeSyncOutcome {
  readonly kinds: readonly CrowdstrikeSyncKindOutcome[];
  readonly written: readonly string[];
}

/**
 * Where a line of progress goes, injected so a run is testable without touching a process stream.
 *
 * @internal
 */
export type CrowdstrikeSyncProgress = (input: { line: string }) => void;

/** One kind's fold: the file to publish, its manifest status, and what to report. */
interface KindFold {
  readonly file: CrowdstrikeKindFile;
  readonly status: AtlasKindStatus;
  readonly outcome: CrowdstrikeSyncKindOutcome;
}

/**
 * Fold the gaps a SUCCESSFUL read leaves behind.
 *
 * Two things happen at once and they are separate: records the provider returned that could not be
 * projected raise a `schema-drift` gap, and the auth and scope refusals this kind may have carried are
 * RECHECKED — successfully reading a kind minted a bearer and was let see it, which is exactly the recheck that
 * closes "no bearer could be minted" and "this credential may not see it".
 *
 * @param kind the kind that was read
 * @param problems records this run could not project
 * @param scope the coverage scope this kind is recorded under
 * @param stored the gaps this kind already held
 * @param at this run's ISO timestamp
 * @returns the accumulated gaps, or the reason they cannot be merged
 */
function foldSucceededGaps({
  kind,
  problems,
  scope,
  stored,
  at,
}: {
  kind: CrowdstrikeKind;
  problems: readonly string[];
  scope: string;
  stored: readonly CrowdstrikeGap[];
  at: string;
}): Result<readonly CrowdstrikeGap[]> {
  const observed =
    problems.length === 0
      ? []
      : [
          openCrowdstrikeGap({
            at,
            condition: "schema-drift",
            fields: [],
            kind,
            reason: problems.slice(0, 4).join("; "),
            scope,
            surfaces: ["falcon-api"],
          }),
        ];
  return reconcileCrowdstrikeGaps({
    at,
    observed,
    rechecks: [
      { condition: "auth-failed", resolved: true, scope },
      { condition: "scope-refused", resolved: true, scope },
    ],
    runFailed: false,
    stored,
  });
}

/**
 * Fold a successful read into the stored kind file.
 *
 * @param kind the kind that was read
 * @param stored the kind file as it stood before this run
 * @param read what the reader produced
 * @param at this run's ISO timestamp
 * @returns the file to publish, its manifest status and this run's outcome, or why it cannot be assembled
 */
export function foldSucceededKind({
  kind,
  stored,
  read,
  at,
}: {
  kind: CrowdstrikeKind;
  stored: CrowdstrikeKindFile;
  read: KindRead<CrowdstrikeEntity>;
  at: string;
}): Result<KindFold> {
  const merged = mergeCrowdstrikeKind({
    at,
    complete: read.complete,
    observed: read.entities,
    stored: stored.entities,
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const scope = crowdstrikeKindScope({ kind });
  const proof =
    read.complete === null ? "; the read did not finish, so nothing was staled" : `; ${read.complete.proof}`;
  const cell = succeededCrowdstrikeCoverageCell({
    at,
    reason: `${read.reason}${proof}`,
    role: "authoritative",
    scope,
    surface: "falcon-api",
  });
  const gaps = foldSucceededGaps({ at, kind, problems: read.problems, scope, stored: stored.gaps });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return foldedKind({
    assembled: assembleCrowdstrikeKindFile({
      at,
      coverage: replaceCrowdstrikeCoverageCell({ cell, cells: stored.coverage }),
      entities: merged.value,
      gaps: gaps.value,
      kind,
    }),
    outcome: { entityCount: merged.value.length, kind, ok: true, reasons: [cell.reason, ...read.problems] },
    status: succeededKindStatus({ at, entityCount: merged.value.length, reasons: read.problems }),
  });
}

/**
 * Fold a failed read into the stored kind file: coverage and gaps move, entities do not.
 *
 * @param kind the kind that was read
 * @param stored the kind file as it stood before this run
 * @param error why the read failed
 * @param at this run's ISO timestamp
 * @returns the file to publish, its manifest status and this run's outcome, or why it cannot be assembled
 */
export function foldFailedKind({
  kind,
  stored,
  error,
  at,
}: {
  kind: CrowdstrikeKind;
  stored: CrowdstrikeKindFile;
  error: CrowdstrikeError;
  at: string;
}): Result<KindFold> {
  const scope = crowdstrikeKindScope({ kind });
  const previous = absentAsNull({
    value: stored.coverage.find((cell) => cell.scope === scope && cell.surface === "falcon-api"),
  });
  const cell = failedCrowdstrikeCoverageCell({ error, previous, role: "authoritative", scope, surface: "falcon-api" });
  const gaps = reconcileCrowdstrikeGaps({
    at,
    observed: [
      openCrowdstrikeGap({
        at,
        condition: classifyCrowdstrikeGap({ error }),
        fields: [],
        kind,
        reason: error.message,
        scope,
        surfaces: ["falcon-api"],
      }),
    ],
    rechecks: [],
    runFailed: true,
    stored: stored.gaps,
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return foldedKind({
    assembled: assembleCrowdstrikeKindFile({
      at,
      coverage: replaceCrowdstrikeCoverageCell({ cell, cells: stored.coverage }),
      entities: stored.entities,
      gaps: gaps.value,
      kind,
    }),
    outcome: { entityCount: stored.entities.length, kind, ok: false, reasons: [error.message] },
    status: failedKindStatus({
      at,
      entityCount: stored.entities.length,
      // A kind with no previous cell has never succeeded; one with a cell carries its own nullable instant.
      lastSuccessAt: previous === null ? null : previous.lastSuccessAt,
      reasons: [error.message],
    }),
  });
}

/** Run the one reader that answers for a kind. */
async function readOneKind({
  kind,
  deps,
  at,
}: {
  kind: (typeof CROWDSTRIKE_API_KINDS)[number];
  deps: CrowdstrikeClientDeps;
  at: string;
}): Promise<Result<KindRead<CrowdstrikeEntity>, CrowdstrikeError>> {
  switch (kind) {
    case "host":
      return readCrowdstrikeHosts({ at, deps });
    case "host-group":
      return readCrowdstrikeHostGroups({ at, deps });
    case "prevention-policy":
    case "sensor-update-policy":
      return readCrowdstrikePolicies({ at, deps, kind });
    case "vulnerability":
      return readCrowdstrikeVulnerabilities({ at, deps });
    case "zero-trust-assessment":
      return readCrowdstrikeZeroTrustAssessments({ at, deps });
    case "zero-trust-audit":
      return readCrowdstrikeZeroTrustAudit({ at, deps });
    case "detection":
      return readCrowdstrikeDetections({ at, deps });
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/**
 * Run the whole API surface and publish one generation.
 *
 * @param paths the resolved atlas paths
 * @param deps the client dependencies — host, token provider, HTTP seam and clock
 * @param at this run's ISO timestamp
 * @param progress where a line of progress goes; omitted discards it
 * @returns what each kind did and which files were written, or every reason nothing was published
 */
export async function syncCrowdstrikeApiSurface({
  paths,
  deps,
  at,
  progress,
}: {
  paths: CrowdstrikeAtlasPaths;
  deps: CrowdstrikeClientDeps;
  at: string;
  progress?: CrowdstrikeSyncProgress;
}): Promise<Result<CrowdstrikeSyncOutcome>> {
  const snapshot = readCrowdstrikeAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const prior = snapshot.value.manifest;
  const manifest: CrowdstrikeManifest = prior ?? initialCrowdstrikeManifest({ updatedAt: at });
  const files: Partial<Record<CrowdstrikeKind, CrowdstrikeKindFile>> = {};
  const statuses: Record<string, AtlasKindStatus> = { ...manifest.kinds };
  const outcomes: CrowdstrikeSyncKindOutcome[] = [];
  const problems: string[] = [];

  for (const kind of CROWDSTRIKE_API_KINDS) {
    progress?.({ line: `crowdstrike: reading ${kind}` });
    const stored = snapshot.value.files[kind] ?? emptyCrowdstrikeKindFile({ kind, updatedAt: at });
    const read = await readOneKind({ at, deps, kind });
    const folded = read.isErr()
      ? foldFailedKind({ at, error: read.error, kind, stored })
      : foldSucceededKind({ at, kind, read: read.value, stored });
    if (folded.isErr()) {
      problems.push(...folded.error);
      continue;
    }
    files[kind] = folded.value.file;
    statuses[kind] = folded.value.status;
    outcomes.push(folded.value.outcome);
    progress?.({
      line: `crowdstrike: ${kind} — ${leadingReason({ reasons: folded.value.outcome.reasons })}`,
    });
  }

  if (problems.length > 0) {
    return err(crowdstrikeAtlasErrorLines({ error: CrowdstrikeAtlasErrors.generationUnpublishable({ problems }) }));
  }
  const published = publishCrowdstrikeAtlas({
    files,
    manifest: { ...manifest, kinds: stampedKinds({ statuses }), updatedAt: at },
    paths,
    derivedFrom: prior,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({ kinds: outcomes, written: published.value });
}

/** The reason a progress line quotes for one kind; an outcome that recorded none says so in words. */
function leadingReason({ reasons }: { reasons: readonly string[] }): string {
  const first = reasons[0];
  if (first === undefined) {
    return "no detail";
  }
  return first;
}

/** Narrow the accumulated statuses back to the manifest's own kind-keyed record. */
function stampedKinds({ statuses }: { statuses: Record<string, AtlasKindStatus> }): CrowdstrikeManifest["kinds"] {
  const initial = initialCrowdstrikeManifest({ updatedAt: new Date(0).toISOString() }).kinds;
  const entries = CROWDSTRIKE_KINDS.map((kind) => [kind, statuses[kind] ?? initial[kind]] as const);
  // `as`: built from the platform's own exhaustive kind list, which Object.fromEntries widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return Object.fromEntries(entries) as CrowdstrikeManifest["kinds"];
}

/**
 * Render a sync failure for a caller that has to print one line.
 *
 * @param error the caught value
 * @returns a single-sentence message
 *
 * @internal
 */
export function crowdstrikeSyncFailure({ error }: { error: unknown }): string {
  return `the CrowdStrike sync could not run: ${errorMessage({ error })}`;
}
