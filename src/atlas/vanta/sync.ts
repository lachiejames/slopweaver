/**
 * `syncVantaAtlas` — the effectful orchestration behind `slopweaver atlas vanta sync`.
 *
 * ## One client, whether or not credentials are configured
 *
 * Credentials being genuinely absent is not a separate code path — it is one more reason a surface call
 * can fail, so it flows through the exact same coverage/gap/merge machinery every other failure does.
 * `credentialsAbsentClient.ts` builds a client whose every method fails the same way; the real client is
 * used otherwise.
 *
 * ## Why a kind's entities are only merged on a COMPLETE read
 *
 * Two kinds split across two required surfaces each (`control`, `risk`). If one partition succeeds and the
 * other fails, merging the successful half would report that kind as freshly synced while silently missing
 * everything the failed partition would have added. So `merge.ts` is only ever called once every required
 * surface for a kind has succeeded THIS run; on an incomplete read the kind's entities and `lastSuccessAt`
 * are left exactly as the previous generation had them, while its coverage cells and gaps still update.
 *
 * ## Audits are never touched
 *
 * `GET /v1/audits` answers HTTP 403 on this credential, because audits belong to the Auditor API — the
 * audit firm's own surface. A browser channel is the only one that could ever hold them, and none ships for
 * this atlas yet, so `audit` never appears in the files this publishes.
 */
import { acquireOperationLockDetailed } from "../../admit/operationLock.js";
import type { Logger } from "../../lib/logger.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type AtlasArtifactWriter, verifiedArtifactWriter } from "../kit/artifactWriter.js";
import { type AtlasKindStatus, failedKindStatus, succeededKindStatus } from "../kit/kindStatus.js";
import { releaseReportingFailure } from "../kit/lockRelease.js";
import { stampAtlasManifest } from "../kit/manifestClock.js";
import { VANTA_CENSUS_FAMILY_LIST } from "./census.js";
import { recordVantaSyncChanges, type VantaSyncChanges, voidVantaSyncChanges } from "./changesRecord.js";
import { VANTA_CHILD_FAMILY_LIST } from "./childCensus.js";
import type { VantaAtlasSyncClient } from "./client.js";
import type { VantaCredentials } from "./credentials.js";
import { credentialsAbsentClient } from "./credentialsAbsentClient.js";
import { downloadPresignedDocument } from "./documentDownload.js";
import {
  initialVantaManifest,
  VANTA_ATLAS_PLATFORM,
  VANTA_ATLAS_SCHEMA_VERSION,
  VANTA_KINDS,
  type VantaApiKind,
  type VantaKind,
  type VantaKindFile,
  type VantaManifest,
} from "./model.js";
import type { VantaDocumentDownload } from "./policyDocuments.js";
import { writeVantaSensitiveCompanion } from "./privacy.js";
import { publishVantaAtlas, readVantaAtlas, type VantaAtlasPaths, vantaAtlasPaths } from "./store.js";
import { storedFilesFrom } from "./storedFiles.js";
import type { VantaParentRead } from "./syncChildren.js";
import { VantaSyncErrors, type VantaSyncRunError, VantaSyncRunErrors, vantaSyncErrorLines } from "./syncErrors.js";
import type { KindSyncResult } from "./syncKind.js";
import { kindRunners } from "./syncRunners.js";

/**
 * Every kind this atlas syncs through the Manage API, in the order a run walks them: the five that were
 * always here, then each census family in `census.ts`'s own order, then the event-log shape index last
 * because it is the longest walk.
 *
 * `audit` is the one kind absent, and it is absent for a reason no scope change removes: Vanta answers
 * `GET /v1/audits` with HTTP 403 on this credential, because audits belong to the Auditor API — the audit
 * FIRM's surface, not this account's. A browser channel is the only one that could ever hold them.
 */
const API_SYNCED_KINDS: readonly VantaApiKind[] = [
  "control",
  "risk",
  "policy",
  "policy-document",
  "evidence",
  "vendor",
  ...VANTA_CENSUS_FAMILY_LIST.map((family) => family.kind),
  // Every fan-out family's parent is one of the kinds above or a fan-out declared before it (resources
  // after their resource kinds), so the ids they walk are this run's own — see `syncChildren.ts` on why
  // reading them off the previous generation would publish a silent omission.
  ...VANTA_CHILD_FAMILY_LIST.map((family) => family.kind),
  "event-shape",
];

/**
 * How this run's attempt at one kind resolved.
 *
 * @internal
 */
export interface VantaSyncKindOutcome {
  readonly kind: VantaKind;
  readonly complete: boolean;
  readonly entityCount: number;
  readonly reasons: readonly string[];
}

/** What one sync run did. */
export interface VantaSyncReport {
  /** `false` only when credentials were genuinely absent. */
  readonly credentialsConfigured: boolean;
  readonly kinds: readonly VantaSyncKindOutcome[];
  /** A lock-release failure, reported rather than swallowed, but never allowed to overturn the run's own outcome. */
  readonly lockReleaseError: string | null;
  /** What this sync changed, written for a visible session to judge — reported, never a reason the sync failed. */
  readonly changes: VantaSyncChanges;
}

/** Builds a real client from resolved credentials — swapped for a fake in tests. */
export type VantaClientBuilder = (input: { credentials: VantaCredentials }) => VantaAtlasSyncClient;

/**
 * Walk every API-synced kind in order, stopping the run on the first fold this reader cannot trust.
 *
 * @returns every kind's result in `API_SYNCED_KINDS` order, or the first refusal that ended the run
 */
async function syncAllKinds({
  client,
  storedFiles,
  at,
  download,
  writeArtifact,
}: {
  client: VantaAtlasSyncClient;
  storedFiles: Readonly<Record<VantaKind, VantaKindFile>>;
  at: string;
  download: VantaDocumentDownload;
  writeArtifact: AtlasArtifactWriter;
}): Promise<Result<readonly KindSyncResult[]>> {
  const results: KindSyncResult[] = [];
  // A kind's ids are offered to a fan-out only when THIS run read that kind completely. An incomplete
  // parent is simply absent from the map, which is what `syncChildren.ts` turns into a named refusal —
  // rather than an empty list, which would publish "this vendor has no assessments" and be believed.
  const completedIds = new Map<VantaKind, VantaParentRead>();
  const runners = kindRunners({
    at,
    client,
    download,
    parentIds: () => completedIds,
    storedFiles,
    writeArtifact,
  });
  for (const kind of API_SYNCED_KINDS) {
    const result = await runners[kind]();
    if (result.isErr()) {
      return err(result.error);
    }
    completedIds.set(
      kind,
      result.value.complete
        ? { ids: result.value.observedProviderIds, outcome: "read" }
        : { conditions: result.value.failedConditions, outcome: "failed", reasons: result.value.reasons },
    );
    results.push(result.value);
  }
  return ok(results);
}

/** Write every pending financial companion this run produced, reporting but not failing the whole run on one write's failure. */
function writePendingSensitiveValues({
  paths,
  results,
}: {
  paths: VantaAtlasPaths;
  results: readonly KindSyncResult[];
}): { readonly failedVendorWriteReasons: readonly string[] } {
  const reasons: string[] = [];
  for (const result of results) {
    for (const pending of result.pendingWrites) {
      const written = writeVantaSensitiveCompanion({ paths, pending });
      if (written.isErr()) {
        reasons.push(...written.error);
      }
    }
  }
  return { failedVendorWriteReasons: reasons };
}

/** What the store held coming into this run: its files, the manifest this run stamps onto, and the one it read. */
interface TrustedSnapshot {
  readonly storedFiles: Record<VantaKind, VantaKindFile>;
  readonly manifest: VantaManifest;
  readonly derivedFrom: VantaManifest | null;
}

/** What the store held coming into this run, or the reason it cannot be trusted enough to merge against. */
function loadTrustedSnapshot({ paths, at }: { paths: VantaAtlasPaths; at: string }): Result<TrustedSnapshot> {
  const snapshot = readVantaAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const mismatched = snapshot.value.mismatched.filter((kind) => API_SYNCED_KINDS.some((synced) => synced === kind));
  const missing = snapshot.value.missing.filter((kind) => API_SYNCED_KINDS.some((synced) => synced === kind));
  if (mismatched.length > 0 || missing.length > 0) {
    return err(vantaSyncErrorLines({ error: VantaSyncErrors.generationUntrusted({ mismatched, missing }) }));
  }
  const storedFiles: Record<VantaKind, VantaKindFile> = storedFilesFrom({ at, snapshotFiles: snapshot.value.files });

  // `manifest` is what this run STAMPS onto, so an empty store gets a synthesised one. `derivedFrom` is what
  // it READ, kept nullable, because that distinction is the whole compare-and-swap: a null basis asserts the
  // store held nothing, and a synthesised manifest would assert it held a generation nobody ever published.
  const manifest = snapshot.value.manifest ?? initialVantaManifest({ updatedAt: at });
  return ok({ derivedFrom: snapshot.value.manifest, manifest, storedFiles });
}

/** Each kind's published file, manifest status and reported outcome; a failed vendor companion write fails vendor. */
function foldKindResults({
  at,
  failedVendorWriteReasons,
  manifest,
  results,
}: {
  at: string;
  failedVendorWriteReasons: readonly string[];
  manifest: VantaManifest;
  results: readonly KindSyncResult[];
}): {
  files: Partial<Record<VantaKind, VantaKindFile>>;
  kindOutcomes: VantaSyncKindOutcome[];
  statuses: Partial<Record<VantaKind, AtlasKindStatus>>;
} {
  const files: Partial<Record<VantaKind, VantaKindFile>> = {};
  const statuses: Partial<Record<VantaKind, AtlasKindStatus>> = {};
  const kindOutcomes: VantaSyncKindOutcome[] = [];
  for (const result of results) {
    const writeFailed = result.kind === "vendor" && failedVendorWriteReasons.length > 0;
    const reasons = writeFailed ? [...result.reasons, ...failedVendorWriteReasons] : result.reasons;
    const succeeded = result.complete && !writeFailed;
    files[result.kind] = result.file;
    const entityCount = succeeded ? result.file.entities.length : manifest.kinds[result.kind].entityCount;
    statuses[result.kind] = succeeded
      ? succeededKindStatus({ at, entityCount, reasons: [] })
      : failedKindStatus({ at, entityCount, lastSuccessAt: manifest.kinds[result.kind].lastSuccessAt, reasons });
    kindOutcomes.push({ complete: succeeded, entityCount: result.file.entities.length, kind: result.kind, reasons });
  }
  return { files, kindOutcomes, statuses };
}

/** Fold every kind's result into the files/manifest this generation publishes, publish them, then record what changed. */
function publishSyncResults({
  home,
  paths,
  trusted: { storedFiles, manifest, derivedFrom },
  results,
  credentialsConfigured,
  at,
}: {
  home: string;
  paths: VantaAtlasPaths;
  trusted: TrustedSnapshot;
  results: readonly KindSyncResult[];
  credentialsConfigured: boolean;
  at: string;
}): Result<VantaSyncReport> {
  const { failedVendorWriteReasons } = writePendingSensitiveValues({ paths, results });
  const { files, kindOutcomes, statuses } = foldKindResults({ at, failedVendorWriteReasons, manifest, results });
  const updatedManifest = stampAtlasManifest<VantaKind, VantaManifest>({
    base: { platform: VANTA_ATLAS_PLATFORM, schemaVersion: VANTA_ATLAS_SCHEMA_VERSION },
    kinds: VANTA_KINDS,
    prior: manifest,
    statuses,
  });

  // Recorded BEFORE the publish: a process killed between the two then leaves a record of a generation that
  // never published, whose changes the next sync records again — a duplicate, never a lost window.
  const changes = recordVantaSyncChanges({
    at,
    credentialsConfigured,
    home,
    manifest,
    outcomes: kindOutcomes,
    results,
    storedFiles,
  });
  const published = publishVantaAtlas({ derivedFrom, files, manifest: updatedManifest, paths });
  if (published.isErr()) {
    return err([...published.error, ...voidVantaSyncChanges({ changes })]);
  }
  return ok({ changes, credentialsConfigured, kinds: kindOutcomes, lockReleaseError: null });
}

/**
 * Sync every Manage API kind this atlas holds.
 *
 * @param credentials the resolved credentials, or every reason they could not be resolved — a failure here
 *   is what `credentialsConfigured: false` in the report signals, and is NOT itself a run failure
 * @param buildClient builds the real client from resolved credentials; swapped for a fake in tests
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param at this run's ISO timestamp
 * @param logger where a lock-release failure is reported
 * @param download fetches one presigned policy document's bytes; a test supplies its own
 * @returns the report, or every reason this run could not proceed at all — `SYNC_CONTENDED` when a live holder
 *   had the sync lock, so a rerun is correct as it stands
 */
export async function syncVantaAtlas({
  credentials,
  buildClient,
  home,
  at,
  logger,
  download = downloadPresignedDocument,
}: {
  credentials: Result<VantaCredentials>;
  buildClient: VantaClientBuilder;
  home: string;
  at: string;
  logger: Logger;
  download?: VantaDocumentDownload;
}): Promise<Result<VantaSyncReport, VantaSyncRunError>> {
  const paths = vantaAtlasPaths({ home });

  const lock = acquireOperationLockDetailed({ home, key: "vanta-atlas-sync", nowIso: at });
  if (!lock.isOk()) {
    return err(VantaSyncRunErrors.lockNotTaken({ error: lock.error }));
  }

  let outcome: Result<VantaSyncReport>;
  let lockReleaseError: string | null;
  try {
    const trusted = loadTrustedSnapshot({ at, paths });
    if (trusted.isErr()) {
      outcome = err(trusted.error);
    } else {
      const client = credentials.isOk() ? buildClient({ credentials: credentials.value }) : credentialsAbsentClient();
      const results = await syncAllKinds({
        at,
        client,
        download,
        storedFiles: trusted.value.storedFiles,
        writeArtifact: verifiedArtifactWriter({ directory: paths.directory }),
      });
      outcome = results.isErr()
        ? err(results.error)
        : publishSyncResults({
            at,
            credentialsConfigured: credentials.isOk(),
            home,
            paths,
            results: results.value,
            trusted: trusted.value,
          });
    }
  } finally {
    lockReleaseError = releaseReportingFailure({ logger, release: lock.value.release });
  }
  // `lockReleaseError` is reported here, on the run's OWN outcome, rather than overturning it.
  if (outcome.isErr()) {
    return err(VantaSyncRunErrors.refused({ lines: outcome.error }));
  }
  return ok({ ...outcome.value, lockReleaseError });
}
