/**
 * Whether one JumpCloud generation publishes, and the publish itself — split out of `sync.ts`, which walks and
 * assembles the generation this decides on.
 *
 * A leaf: it imports nothing from `sync.ts`. So the report and the assembled generation it reads are declared
 * here rather than there, and `sync.ts` imports them. Why a generation carrying a blocking failure is never
 * published is `sync.ts`'s header.
 */
import { err, ok, type Result } from "../../lib/result.js";

import type { JumpcloudKindFile, JumpcloudKindStatus, JumpcloudManifest } from "./entities.js";
import type { JumpcloudKind } from "./model.js";
import { dropJumpcloudResume } from "./resume.js";
import { admitJumpcloudGeneration } from "./sensitivity.js";
import { type JumpcloudAtlasPaths, publishJumpcloudAtlas, stampJumpcloudManifest } from "./store.js";
import type { JumpcloudKindWalk } from "./syncEngine.js";

/**
 * The failure codes a later run could clear. A generation carrying one of these is not published.
 *
 * `CREDENTIAL_REJECTED` is on the list and `PERMISSION_REFUSED` is not, and an adversarial review is what
 * separated them: both used to be one `UNAUTHORISED`, so a run against a revoked key recorded a failure on
 * every family and then published the empty result as this organisation's answer. Replacing a key clears a
 * 401; nothing a later run does clears a 403.
 */
const BLOCKING_CODES: ReadonlySet<string> = new Set([
  "BODY_SHAPE_CHANGED",
  "CREDENTIAL_REJECTED",
  "REDIRECT_REFUSED",
  "SURFACE_REFUSED",
  "TRANSPORT_FAILED",
  "UNEXPECTED_SHAPE",
]);

/** What one kind ended up with. */
export interface JumpcloudKindOutcome {
  readonly kind: JumpcloudKind;
  readonly entityCount: number;
  readonly state: string;
  readonly reason: string;
  readonly resumed: number;
}

/** What a sync did. */
export interface JumpcloudSyncReport {
  readonly kinds: readonly JumpcloudKindOutcome[];
  readonly published: boolean;
  readonly written: readonly string[];
  /** Every reason publication was refused; empty when it was not. */
  readonly refusals: readonly string[];
}

/**
 * Whether this kind's walk carries anything a later run could clear.
 *
 * TWO sources, and the second is the one an adversarial review found missing. A typed failure is the
 * obvious one. The other is a walk that ANSWERED and came up short — 125 of a declared 150, which is what a
 * page order shifting under an offset walk produces. That read succeeded at every call and is still not the
 * family, so a generation carrying it would publish a confidently short answer with nothing in the refusal
 * list to say so.
 *
 * @param walk what the walk accumulated for this kind
 * @returns one line per reason to refuse the publication, empty when there is none
 */
export function blockingFailures({ walk }: { walk: JumpcloudKindWalk }): readonly string[] {
  return [
    ...walk.failures
      .filter((failure) => BLOCKING_CODES.has(failure.error.code))
      .map((failure) => `${walk.kind}/${failure.surface}: ${failure.error.message}`),
    ...walk.clearableIncomplete.map((line) => `${walk.kind}/${line}`),
  ];
}

/** Everything one pass over the kinds assembled, before publication is decided. */
export interface AssembledGeneration {
  readonly files: Partial<Record<JumpcloudKind, JumpcloudKindFile>>;
  readonly statuses: Partial<Record<JumpcloudKind, JumpcloudKindStatus>>;
  readonly outcomes: readonly JumpcloudKindOutcome[];
  readonly refusals: readonly string[];
}

/**
 * Publish the assembled generation, or say exactly what stopped it.
 *
 * Two refusals and they are different facts. The first is a family that failed for a reason a later run
 * could clear, which is why the message names the resume journal rather than suggesting a fresh start. The
 * second is the pre-publish sensitivity gate finding material the projection could not have known about,
 * which is a boundary breach rather than a retry.
 *
 * @param generation everything the kinds assembled
 * @param paths the resolved atlas paths
 * @param prior the manifest currently on disk
 * @param knownSecrets credential values this process holds, refused verbatim wherever they appear
 * @returns what each kind ended up with and whether the generation was published
 */
export function publishOrRefuse({
  generation,
  paths,
  prior,
  knownSecrets,
}: {
  generation: AssembledGeneration;
  paths: JumpcloudAtlasPaths;
  prior: JumpcloudManifest | null;
  knownSecrets: readonly string[];
}): Result<JumpcloudSyncReport> {
  const kinds = generation.outcomes.toSorted((left, right) => left.kind.localeCompare(right.kind));
  if (generation.refusals.length > 0) {
    return ok({
      kinds,
      published: false,
      refusals: [
        ...generation.refusals,
        "nothing was published: a generation with a family that failed for a reason a later run could clear would be read as this organisation's whole answer. Re-run the sync — the resume journal keeps every call already made",
      ],
      written: [],
    });
  }
  const admitted = admitJumpcloudGeneration({ document: generation.files, knownSecrets });
  if (admitted.isErr()) {
    return ok({ kinds, published: false, refusals: admitted.error, written: [] });
  }
  const published = publishJumpcloudAtlas({
    files: generation.files,
    manifest: stampJumpcloudManifest({ prior, statuses: generation.statuses }),
    paths,
    derivedFrom: prior,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  dropJumpcloudResume({ directory: paths.directory });
  return ok({ kinds, published: true, refusals: [], written: published.value });
}
