/**
 * The three builders that construct a document valid against `entities.ts`'s strict schemas: an empty kind
 * file, one kind's file assembled from a run's parts, and the manifest that grades every kind as never
 * attempted.
 *
 * Shared by `sync.ts`, `consoleSurface.ts` and `reset.ts`, so the API sync, the console walk and a reset build
 * their documents through one definition rather than each spelling the envelope again. The schemas stay in
 * `entities.ts`; this module only builds what they parse.
 */
import { err, ok, type Result } from "../../lib/result.js";

import {
  type CrowdstrikeCoverageCell,
  type CrowdstrikeEntity,
  type CrowdstrikeGap,
  type CrowdstrikeKindFile,
  type CrowdstrikeManifest,
  crowdstrikeKindFileSchema,
} from "./entities.js";
import { CROWDSTRIKE_KINDS, CROWDSTRIKE_SCHEMA_VERSION } from "./model.js";

/**
 * An empty file for one kind — the shape a reset installs and a first sync folds onto.
 *
 * @param kind the kind to build an empty file for
 * @param updatedAt this run's ISO timestamp
 * @returns the empty file, valid against {@link crowdstrikeKindFileSchema}
 */
export function emptyCrowdstrikeKindFile({
  kind,
  updatedAt,
}: {
  kind: CrowdstrikeKindFile["kind"];
  updatedAt: string;
}): CrowdstrikeKindFile {
  return { coverage: [], entities: [], gaps: [], kind, schemaVersion: CROWDSTRIKE_SCHEMA_VERSION, updatedAt };
}

/**
 * Assemble one kind's file from its parts, refusing a mis-routed entity.
 *
 * The parse is the point rather than a formality: {@link crowdstrikeKindFileSchema} is a discriminated
 * union, so a detection that reached the host fold fails HERE rather than being written into `hosts.json`
 * and read back forever as a host. Both surfaces publish through this one function, because two copies of
 * it were two places for that guard to drift.
 *
 * @param kind the kind this file is for
 * @param entities the merged entity list
 * @param coverage the kind's coverage cells after this run
 * @param gaps the kind's gaps after this run
 * @param at this run's ISO timestamp
 * @returns the file, or why the assembled document is not storable
 */
export function assembleCrowdstrikeKindFile({
  kind,
  entities,
  coverage,
  gaps,
  at,
}: {
  kind: CrowdstrikeKindFile["kind"];
  entities: readonly CrowdstrikeEntity[];
  coverage: readonly CrowdstrikeCoverageCell[];
  gaps: readonly CrowdstrikeGap[];
  at: string;
}): Result<CrowdstrikeKindFile> {
  const parsed = crowdstrikeKindFileSchema.safeParse({
    coverage,
    entities,
    gaps,
    kind,
    schemaVersion: CROWDSTRIKE_SCHEMA_VERSION,
    updatedAt: at,
  });
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    parsed.error.issues
      .slice(0, 6)
      .map(
        (issue) =>
          `the ${kind} file this run assembled is not storable — ${issue.path.map(String).join(".")}: ${issue.message}`,
      ),
  );
}

/**
 * A manifest grading every kind as never attempted.
 *
 * @param updatedAt this run's ISO timestamp
 * @returns the initial manifest
 */
export function initialCrowdstrikeManifest({ updatedAt }: { updatedAt: string }): CrowdstrikeManifest {
  const entries = CROWDSTRIKE_KINDS.map(
    (kind) => [kind, { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null }] as const,
  );
  // `as`: built from the platform's own exhaustive kind list, which Object.fromEntries widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const kinds = Object.fromEntries(entries) as CrowdstrikeManifest["kinds"];
  return { kinds, schemaVersion: CROWDSTRIKE_SCHEMA_VERSION, updatedAt };
}
