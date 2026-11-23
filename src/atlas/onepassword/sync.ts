/**
 * `syncOnepasswordAtlas` - the effectful orchestration behind `slopweaver onepassword sync`.
 *
 * ## Two credentials, two independent halves, and neither blocks the other
 *
 * The roster (`admin-cli`) and the activity feed (`events-api`) are reached with different credentials, and
 * either may be absent. A run with only the Events API token publishes an events generation and declares
 * every roster surface `not-configured`; a run with only an `op` session does the reverse. Neither is a
 * failure - an atlas that refused to record anything until it could record everything would report nothing
 * on the most common first-run state.
 *
 * ## The publish gate is not called from here
 *
 * `store.ts` wires the sensitivity gate into the kit's own publish guard, so it runs whether or not this
 * file remembers to ask, and refuses before a byte is opened. Findings the gate reports rather than refuses
 * come back through `onFindings` and are surfaced on the run report.
 *
 * ## The README is written after the publish, deliberately
 *
 * A README describing a generation that was refused would be a lie on disk. It is rendered from the same
 * constants the gate enforces (`readme.ts`) and written only once the generation it describes exists.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { acquireOperationLock } from "../../admit/operationLock.js";
import { loadDenylistResult } from "../../hygiene/scan.js";
import { errorMessage } from "../../lib/errorMessage.js";
import type { Logger } from "../../lib/logger.js";
import { err, ok, type Result } from "../../lib/result.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";

import { type AtlasKindStatus, failedKindStatus, succeededKindStatus } from "../kit/kindStatus.js";
import { stampAtlasManifest } from "../kit/manifestClock.js";
import type { OnepasswordEventsCredentials } from "./credentials.js";
import {
  emptyOnepasswordKindFile,
  initialOnepasswordManifest,
  ONEPASSWORD_ATLAS_PLATFORM,
  ONEPASSWORD_ATLAS_SCHEMA_VERSION,
  ONEPASSWORD_KINDS,
  type OnepasswordKind,
  type OnepasswordKindFile,
  type OnepasswordManifest,
} from "./model.js";
import { ONEPASSWORD_README_FILENAME, renderOnepasswordReadme } from "./readme.js";
import type { OnepasswordSensitivityFinding } from "./sensitivity.js";
import {
  type OnepasswordAtlasPaths,
  onepasswordAtlasPaths,
  publishOnepasswordAtlas,
  readOnepasswordAtlas,
} from "./store.js";
import type { OnepasswordProgress, OnepasswordSyncKindOutcome, OpSurfaceRunner } from "./syncCore.js";
import { OnepasswordSyncErrors, onepasswordSyncErrorLines } from "./syncErrors.js";
import {
  gatherAdminKinds,
  gatherEventsKind,
  type OnepasswordEventsClientBuilder,
  type OnepasswordKindResult,
} from "./syncGather.js";

/** What one sync run did. */
export interface OnepasswordSyncReport {
  /** `false` when no usable `op` session was available at all. */
  readonly adminCliConfigured: boolean;
  /** `false` when no Events API token is configured. */
  readonly eventsConfigured: boolean;
  readonly kinds: readonly OnepasswordSyncKindOutcome[];
  /** Denylist hits the sensitivity gate reported without refusing - see `sensitivity.ts` on why. */
  readonly reportedFindings: readonly OnepasswordSensitivityFinding[];
  /** Where the atlas README was written, or `null` when writing it failed. */
  readonly readmePath: string | null;
  /** A lock-release failure, reported rather than swallowed, but never allowed to overturn the outcome. */
  readonly lockReleaseError: string | null;
}

/** Every stored kind file, defaulted to empty, plus the manifest - or why the generation cannot be trusted. */
function loadTrustedSnapshot({ paths, at }: { paths: OnepasswordAtlasPaths; at: string }): Result<{
  storedFiles: Record<OnepasswordKind, OnepasswordKindFile>;
  manifest: OnepasswordManifest;
  derivedFrom: OnepasswordManifest | null;
}> {
  const snapshot = readOnepasswordAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  if (snapshot.value.mismatched.length > 0 || snapshot.value.missing.length > 0) {
    return err(onepasswordSyncErrorLines({ error: OnepasswordSyncErrors.generationUntrusted(snapshot.value) }));
  }
  const stored = snapshot.value.files;
  const storedFiles: Record<OnepasswordKind, OnepasswordKindFile> = {
    event: stored.event ?? emptyOnepasswordKindFile({ kind: "event", updatedAt: at }),
    group: stored.group ?? emptyOnepasswordKindFile({ kind: "group", updatedAt: at }),
    "group-member": stored["group-member"] ?? emptyOnepasswordKindFile({ kind: "group-member", updatedAt: at }),
    integration: stored.integration ?? emptyOnepasswordKindFile({ kind: "integration", updatedAt: at }),
    user: stored.user ?? emptyOnepasswordKindFile({ kind: "user", updatedAt: at }),
    vault: stored.vault ?? emptyOnepasswordKindFile({ kind: "vault", updatedAt: at }),
    "vault-grant": stored["vault-grant"] ?? emptyOnepasswordKindFile({ kind: "vault-grant", updatedAt: at }),
  };
  // `manifest` is what this run stamps onto, so an empty store gets a synthesised one; `derivedFrom` is what
  // it READ, kept nullable, because a null basis is the compare-and-swap asserting the store held nothing.
  return ok({
    derivedFrom: snapshot.value.manifest,
    manifest: snapshot.value.manifest ?? initialOnepasswordManifest({ updatedAt: at }),
    storedFiles,
  });
}

/** Write the atlas README beside the generation it describes. A failure is reported, never fatal. */
function writeReadme({ paths, at }: { paths: OnepasswordAtlasPaths; at: string }): Result<string> {
  const path = join(paths.directory, ONEPASSWORD_README_FILENAME);
  try {
    mkdirSync(paths.directory, { recursive: true });
    writeFileAtomic({ contents: renderOnepasswordReadme({ at }), path });
    return ok(path);
  } catch (error: unknown) {
    return err(onepasswordSyncErrorLines({ error: OnepasswordSyncErrors.readmeUnwritable({ cause: error }) }));
  }
}

/**
 * Sync the 1Password atlas: the roster through `op`, the activity feed through the Events API, either of
 * which may be absent.
 *
 * @param runOp runs one allowed `op` surface; `null` when no usable session is configured
 * @param eventsCredentials the resolved Events API credential, or every reason it could not be resolved
 * @param buildEventsClient builds the real client from resolved credentials; swapped for a fake in tests
 * @param since the RFC-3339 instant the audit walk starts from
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param at this run's ISO timestamp
 * @param logger where a lock-release failure is reported
 * @returns the report, or every reason this run could not proceed at all
 */
export async function syncOnepasswordAtlas({
  runOp,
  eventsCredentials,
  buildEventsClient,
  onProgress = () => {},
  since,
  home,
  at,
  logger,
}: {
  runOp: OpSurfaceRunner | null;
  eventsCredentials: Result<OnepasswordEventsCredentials>;
  buildEventsClient: OnepasswordEventsClientBuilder;
  onProgress?: OnepasswordProgress;
  since: string;
  home: string;
  at: string;
  logger: Logger;
}): Promise<Result<OnepasswordSyncReport>> {
  const paths = onepasswordAtlasPaths({ home });
  const denylist = loadDenylistResult({ home });
  if (denylist.kind === "unreadable") {
    return err(onepasswordSyncErrorLines({ error: OnepasswordSyncErrors.denylistUnreadable(denylist) }));
  }
  const denylistWords = denylist.kind === "loaded" ? denylist.lines : [];

  const lock = acquireOperationLock({ home, key: "onepassword-atlas-sync", nowIso: at });
  if (!lock.isOk()) {
    return err(onepasswordSyncErrorLines({ error: OnepasswordSyncErrors.syncLockHeld({ holder: lock.error }) }));
  }

  let outcome: Result<OnepasswordSyncReport>;
  let lockReleaseError: string | null = null;
  try {
    outcome = await runSync({
      at,
      buildEventsClient,
      denylistWords,
      eventsCredentials,
      onProgress,
      paths,
      runOp,
      since,
    });
  } finally {
    try {
      lock.value.release();
    } catch (error: unknown) {
      lockReleaseError = errorMessage({ error });
      logger.error({ msg: lockReleaseError });
    }
  }
  // Reported on the run's OWN outcome rather than overturning it.
  return outcome.isOk() ? ok({ ...outcome.value, lockReleaseError }) : outcome;
}

/**
 * Every kind's file and manifest status, folded out of this run's outcomes.
 *
 * Split out of { publishGeneration} so that function stays inside the `max-function-lines` budget, and
 * because this fold is the one place a FAILED kind keeps what the store already had rather than reporting
 * zero — the rule `failedKindStatus` exists for, and worth reading in one piece.
 *
 * @param outcomes every kind's result, roster and activity alike
 * @param prior the trusted manifest this run is advancing, which supplies a failed kind's kept numbers
 * @returns the files to publish and the statuses to stamp
 */
function foldedOutcomes({
  at,
  outcomes,
  prior,
}: {
  at: string;
  outcomes: readonly OnepasswordKindResult[];
  prior: OnepasswordManifest;
}): {
  files: Partial<Record<OnepasswordKind, OnepasswordKindFile>>;
  statuses: Partial<Record<OnepasswordKind, AtlasKindStatus>>;
} {
  const files: Partial<Record<OnepasswordKind, OnepasswordKindFile>> = {};
  const statuses: Partial<Record<OnepasswordKind, AtlasKindStatus>> = {};
  for (const outcome of outcomes) {
    files[outcome.kind] = outcome.file;
    const held = prior.kinds[outcome.kind];
    const entityCount = outcome.complete ? outcome.entityCount : held.entityCount;
    statuses[outcome.kind] = outcome.complete
      ? succeededKindStatus({ at, entityCount, reasons: [] })
      : failedKindStatus({ at, entityCount, lastSuccessAt: held.lastSuccessAt, reasons: outcome.reasons });
  }
  return { files, statuses };
}

/**
 * Fold every kind's result into one generation, publish it through the gate, then describe what was
 * published. The gate lives in `store.ts` rather than here - see this file's header.
 *
 * @param outcomes every kind's result, roster and activity alike
 * @param manifest the trusted prior manifest, advanced one kind at a time
 * @param derivedFrom what the store actually held, kept nullable — the compare-and-swap basis
 * @param denylistWords the private denylist the sensitivity gate reports against
 * @returns the run report, or why the publish refused
 */
function publishGeneration({
  adminCliConfigured,
  at,
  denylistWords,
  eventsConfigured,
  manifest: priorManifest,
  derivedFrom,
  outcomes,
  paths,
}: {
  adminCliConfigured: boolean;
  at: string;
  denylistWords: readonly string[];
  eventsConfigured: boolean;
  manifest: OnepasswordManifest;
  derivedFrom: OnepasswordManifest | null;
  outcomes: readonly OnepasswordKindResult[];
  paths: OnepasswordAtlasPaths;
}): Result<OnepasswordSyncReport> {
  const { files, statuses } = foldedOutcomes({ at, outcomes, prior: priorManifest });
  const manifest = stampAtlasManifest<OnepasswordKind, OnepasswordManifest>({
    base: { platform: ONEPASSWORD_ATLAS_PLATFORM, schemaVersion: ONEPASSWORD_ATLAS_SCHEMA_VERSION },
    kinds: ONEPASSWORD_KINDS,
    prior: priorManifest,
    statuses,
  });

  const reportedFindings: OnepasswordSensitivityFinding[] = [];
  const published = publishOnepasswordAtlas({
    denylist: denylistWords,
    derivedFrom,
    files,
    manifest,
    onFindings: ({ findings }) => {
      reportedFindings.push(...findings);
    },
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }

  const readme = writeReadme({ at, paths });
  return ok({
    adminCliConfigured,
    eventsConfigured,
    kinds: outcomes.map(({ complete, entityCount, kind, reasons }) => ({ complete, entityCount, kind, reasons })),
    lockReleaseError: null,
    readmePath: readme.isOk() ? readme.value : null,
    reportedFindings,
  });
}

/** The body of a sync, inside the lock: read, gather, fold, publish, then describe what was published. */
async function runSync({
  paths,
  runOp,
  eventsCredentials,
  buildEventsClient,
  denylistWords,
  onProgress,
  since,
  at,
}: {
  paths: OnepasswordAtlasPaths;
  runOp: OpSurfaceRunner | null;
  eventsCredentials: Result<OnepasswordEventsCredentials>;
  buildEventsClient: OnepasswordEventsClientBuilder;
  denylistWords: readonly string[];
  onProgress: OnepasswordProgress;
  since: string;
  at: string;
}): Promise<Result<OnepasswordSyncReport>> {
  const trusted = loadTrustedSnapshot({ at, paths });
  if (trusted.isErr()) {
    return err(trusted.error);
  }
  const { storedFiles } = trusted.value;

  const admin = gatherAdminKinds({ at, onProgress, runOp, storedFiles });
  if (admin.isErr()) {
    return err(admin.error);
  }
  const events = await gatherEventsKind({ at, buildEventsClient, eventsCredentials, onProgress, since, storedFiles });
  if (events.isErr()) {
    return err(events.error);
  }

  return publishGeneration({
    adminCliConfigured: runOp !== null,
    at,
    denylistWords,
    eventsConfigured: eventsCredentials.isOk(),
    derivedFrom: trusted.value.derivedFrom,
    manifest: trusted.value.manifest,
    outcomes: [...admin.value, events.value],
    paths,
  });
}
