/**
 * The one loop that runs every FLAT kind this atlas wires: read it, project it, fold it.
 *
 * The table of kinds is {@link flatKindSpecs}, in `flatKindSpecs.ts`, and it is the ONE place a new flat
 * surface gets registered — {@link syncOneFlatKind} needs no change for it. The table moved out under the
 * file-size cap, so this file holds only the loop and the stored kind-file read it needs.
 */
import type Cloudflare from "cloudflare";

import type { RichProgressEmitter } from "../../lib/progressRichEmitter.js";
import { err, ok, type Result } from "../../lib/result.js";

import { type FlatKindSpec, flatKindSpecs } from "./flatKindSpecs.js";
import {
  type CloudflareSyncKindOutcome,
  flatKindScope,
  foldFailedKindRead,
  foldSucceededKindRead,
  type KindFoldResult,
  stampKindAttempt,
} from "./kindFold.js";
import {
  type CloudflareKind,
  type CloudflareKindFile,
  type CloudflareManifest,
  emptyCloudflareKindFile,
} from "./model.js";
import { type CloudflareAtlasPaths, readCloudflareKindFile } from "./store.js";

/**
 * Read, project and fold this run's attempt at one flat kind into its stored kind file.
 *
 * @param spec the flat kind's registered reader and coverage label
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param stored the kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome for the kind, or why the merge itself failed
 */
async function syncOneFlatKind({
  spec,
  client,
  accountId,
  stored,
  at,
}: {
  spec: FlatKindSpec;
  client: Cloudflare;
  accountId: string;
  stored: CloudflareKindFile;
  at: string;
}): Promise<Result<KindFoldResult>> {
  const zoneScoped = "zoneId" in spec;
  const scope = zoneScoped ? spec.scope : flatKindScope({ accountId, kind: spec.kind });
  const readZoneId = zoneScoped ? spec.zoneId : null;
  const read = await spec.read({ accountId, at, client });
  return read.isErr()
    ? ok(foldFailedKindRead({ at, error: read.error, kind: spec.kind, scope, stored }))
    : foldSucceededKindRead({
        at,
        kind: spec.kind,
        label: spec.label,
        observed: read.value,
        readZoneId,
        scope,
        stored,
      });
}

/**
 * Run every flat kind's sync attempt, appending each to the shared `files`/`outcomes`/`manifest`
 * accumulators — pulled out of `sync.ts`'s own orchestration so that file stays the lock/publish shell.
 *
 * @param at this run's ISO timestamp
 * @param paths the resolved atlas paths
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param deepZoneId the selected, live-verified deep zone's id
 * @param files the accumulator every kind's file is added to
 * @param outcomes the accumulator every kind's outcome is added to
 * @param manifest the manifest as it stands so far this run
 * @param progress where this run's phases are reported
 * @returns the manifest with every flat kind's attempt stamped, or why a read/fold itself failed
 */
export async function runFlatKinds({
  at,
  paths,
  client,
  accountId,
  deepZoneId,
  files,
  outcomes,
  manifest,
  progress,
}: {
  at: string;
  paths: CloudflareAtlasPaths;
  client: Cloudflare;
  accountId: string;
  deepZoneId: string;
  files: Partial<Record<CloudflareKind, CloudflareKindFile>>;
  outcomes: CloudflareSyncKindOutcome[];
  manifest: CloudflareManifest;
  progress: RichProgressEmitter;
}): Promise<Result<CloudflareManifest>> {
  let next = manifest;
  for (const spec of flatKindSpecs({ deepZoneId })) {
    progress.emit({ currentItem: { title: spec.kind }, lane: "heartbeat", phase: "reading" });
    const existingFile = readCloudflareKindFile({ kind: spec.kind, paths });
    if (existingFile.isErr()) {
      return err(existingFile.error);
    }
    const stored = existingFile.value ?? emptyCloudflareKindFile({ kind: spec.kind, updatedAt: at });
    const folded = await syncOneFlatKind({ accountId, at, client, spec, stored });
    if (folded.isErr()) {
      return err(folded.error);
    }
    files[spec.kind] = folded.value.file;
    outcomes.push(folded.value.outcome);
    next = stampKindAttempt({ at, manifest: next, outcome: folded.value.outcome });
  }
  return ok(next);
}
