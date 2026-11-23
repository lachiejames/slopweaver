/**
 * `syncCloudflareAtlas` — the lock, the generation, and nothing else.
 *
 * This module owns the shell: acquire the operation lock, read the existing manifest, run every kind, publish
 * every kind file together in ONE generation, release. What each kind actually reads is elsewhere by
 * design — `flatKinds.ts` for the one-collection and singleton surfaces and `nonFlatKinds.ts` for the ones
 * that fan out, each of the latter delegating to its own `<kind>Sync.ts`. Both of those files carry the
 * header that used to live here, next to the code it describes.
 *
 * There is no `deferred` coverage cell for surfaces declared but deliberately unread: only highly voluminous
 * data may be excluded, and none of the thirteen candidates was, so every one of them has a reader here.
 * `model.ts` carries the ruling.
 *
 * Two invariants worth stating where the publish happens:
 *
 * - **One generation, whatever failed.** Every kind's file is published together, and a kind whose read
 *   failed still publishes — with its entities untouched, a failed coverage cell and an open gap. A run that
 *   half-succeeds leaves an atlas that says so, never a half-written one.
 * - **Every OTHER kind's manifest status is left exactly as it stood**, since `publishCloudflareAtlas` only
 *   touches the kind files a caller actually passes.
 *
 * The selection passed in is already LIVE-VERIFIED by `resolveLiveCloudflareScope` before this function is
 * ever called — this module's only job with it is to stamp it onto the manifest, where the store's own
 * selection guard is what actually protects it from a later run silently re-scoping the atlas.
 */
import type Cloudflare from "cloudflare";

import { acquireOperationLock } from "../../admit/operationLock.js";
import type { RichProgressEmitter } from "../../lib/progressRichEmitter.js";
import { err, ok, type Result } from "../../lib/result.js";

import { runFlatKinds } from "./flatKinds.js";
import type { CloudflareSyncKindOutcome } from "./kindFold.js";
import {
  type CloudflareKind,
  type CloudflareKindFile,
  type CloudflareManifest,
  type CloudflareSelection,
  initialCloudflareManifest,
} from "./model.js";
import { runNonFlatKinds } from "./nonFlatKinds.js";
import {
  type CloudflareAtlasPaths,
  cloudflareAtlasPaths,
  publishCloudflareAtlas,
  readCloudflareManifest,
} from "./store.js";

export type { CloudflareSyncKindOutcome } from "./kindFold.js";

/** What one sync run did. */
export interface CloudflareSyncReport {
  readonly selection: CloudflareSelection;
  readonly kinds: readonly CloudflareSyncKindOutcome[];
  /** A lock-release failure, reported rather than swallowed, but never allowed to overturn the run's own outcome. */
  readonly lockReleaseError: string | null;
}

/** What every kind's sync attempt produced, ready to publish in one generation. */
interface AllKindsResult {
  readonly files: Partial<Record<CloudflareKind, CloudflareKindFile>>;
  readonly outcomes: CloudflareSyncKindOutcome[];
  readonly manifest: CloudflareManifest;
  /**
   * The manifest this run READ, carried separately from the one it will publish.
   *
   * `manifest` above is stamped from `initialCloudflareManifest` whenever the store held nothing, so it is
   * never `null` and cannot say whether a generation was there. The compare-and-swap needs exactly that
   * distinction — a `null` basis asserts the store was empty — so the read is carried as it came back.
   */
  readonly derivedFrom: CloudflareManifest | null;
}

/**
 * Run the two passes that actually call Cloudflare — every flat kind, then every non-flat kind's fan-out.
 *
 * Split from {@link runAllKinds} so that function stays a manifest-read plus three named passes: the two
 * here talk to the provider, and the deferred pass beside them deliberately does not.
 *
 * @param at this run's ISO timestamp
 * @param paths the resolved atlas paths
 * @param client the constructed, guarded Cloudflare client
 * @param selection the live-verified account/deep-zone selection
 * @param files the accumulator every kind's file is added to
 * @param outcomes the accumulator every kind's outcome is added to
 * @param manifest the manifest as it stands so far this run
 * @param progress where this run's phases are reported
 * @returns the manifest with both passes stamped, or why a read/fold itself failed
 */
async function runReadPasses({
  at,
  paths,
  client,
  selection,
  files,
  outcomes,
  manifest,
  progress,
}: {
  at: string;
  paths: CloudflareAtlasPaths;
  client: Cloudflare;
  selection: CloudflareSelection;
  files: Partial<Record<CloudflareKind, CloudflareKindFile>>;
  outcomes: CloudflareSyncKindOutcome[];
  manifest: CloudflareManifest;
  progress: RichProgressEmitter;
}): Promise<Result<CloudflareManifest>> {
  const afterFlatKinds = await runFlatKinds({
    accountId: selection.accountId,
    at,
    client,
    deepZoneId: selection.deepZone.id,
    files,
    manifest,
    outcomes,
    paths,
    progress,
  });
  if (afterFlatKinds.isErr()) {
    return err(afterFlatKinds.error);
  }
  return runNonFlatKinds({
    accountId: selection.accountId,
    at,
    client,
    files,
    manifest: afterFlatKinds.value,
    outcomes,
    paths,
    progress,
    zoneId: selection.deepZone.id,
  });
}

/** The manifest the store held, or a fresh one stamped `at` when it held none. */
function heldManifest({ manifest, at }: { manifest: CloudflareManifest | null; at: string }): CloudflareManifest {
  if (manifest == null) {
    return initialCloudflareManifest({ updatedAt: at });
  }
  return manifest;
}

/**
 * Read the existing manifest and run every kind's sync attempt — the flat kinds, then every non-flat kind
 * — without publishing. Pulled out of {@link attemptKindsSync} purely to keep that function short.
 *
 * @param at this run's ISO timestamp
 * @param paths the resolved atlas paths
 * @param client the constructed, guarded Cloudflare client
 * @param selection the live-verified account/deep-zone selection
 * @param progress where this run's phases are reported
 * @returns every kind's file and outcome plus the stamped manifest, or why a read/fold itself failed
 */
async function runAllKinds({
  at,
  paths,
  client,
  selection,
  progress,
}: {
  at: string;
  paths: CloudflareAtlasPaths;
  client: Cloudflare;
  selection: CloudflareSelection;
  progress: RichProgressEmitter;
}): Promise<Result<AllKindsResult>> {
  progress.emit({ lane: "heartbeat", phase: "reading the existing atlas" });
  const existingManifest = readCloudflareManifest({ paths });
  if (existingManifest.isErr()) {
    return err(existingManifest.error);
  }

  const files: Partial<Record<CloudflareKind, CloudflareKindFile>> = {};
  const outcomes: CloudflareSyncKindOutcome[] = [];
  const initialManifest: CloudflareManifest = {
    ...heldManifest({ at, manifest: existingManifest.value }),
    selection,
    updatedAt: at,
  };

  const read = await runReadPasses({
    at,
    client,
    files,
    manifest: initialManifest,
    outcomes,
    paths,
    progress,
    selection,
  });
  if (read.isErr()) {
    return err(read.error);
  }

  return ok({ derivedFrom: existingManifest.value, files, manifest: read.value, outcomes });
}

/**
 * Run every kind's sync attempt and publish them all in one generation — everything the lock in
 * {@link syncCloudflareAtlas} protects, pulled out so that function stays a thin lock/release shell.
 *
 * @param at this run's ISO timestamp
 * @param paths the resolved atlas paths
 * @param client the constructed, guarded Cloudflare client
 * @param selection the live-verified account/deep-zone selection
 * @param progress where this run's phases are reported
 * @returns the report (with `lockReleaseError` always `null` — the caller stamps it), or every reason this
 *   attempt could not proceed
 */
async function attemptKindsSync({
  at,
  paths,
  client,
  selection,
  progress,
}: {
  at: string;
  paths: CloudflareAtlasPaths;
  client: Cloudflare;
  selection: CloudflareSelection;
  progress: RichProgressEmitter;
}): Promise<Result<CloudflareSyncReport>> {
  const kinds = await runAllKinds({ at, client, paths, progress, selection });
  if (kinds.isErr()) {
    return err(kinds.error);
  }
  const { files, outcomes, manifest, derivedFrom } = kinds.value;

  const published = publishCloudflareAtlas({ derivedFrom, files, manifest, paths });
  if (published.isErr()) {
    return err(published.error);
  }
  progress.finish({
    lane: "heartbeat",
    metrics: Object.fromEntries(outcomes.map((outcome) => [outcome.kind, outcome.entityCount])),
    phase: outcomes.every((outcome) => outcome.complete) ? "synced" : "incomplete",
  });
  return ok({ kinds: outcomes, lockReleaseError: null, selection });
}

/**
 * Sync every Cloudflare kind, under an operation lock, publishing every kind's file together in one
 * generation.
 *
 * @param at this run's ISO timestamp
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param client the constructed, guarded Cloudflare client
 * @param selection the live-verified account/deep-zone selection
 * @param progress where this run's phases are reported
 * @returns the report, or every reason this run could not proceed at all
 */
export async function syncCloudflareAtlas({
  at,
  home,
  client,
  selection,
  progress,
}: {
  at: string;
  home: string;
  client: Cloudflare;
  selection: CloudflareSelection;
  progress: RichProgressEmitter;
}): Promise<Result<CloudflareSyncReport>> {
  const paths = cloudflareAtlasPaths({ home });
  const lock = acquireOperationLock({ home, key: "cloudflare-atlas-sync", nowIso: at });
  if (!lock.isOk()) {
    return err([`could not acquire the Cloudflare atlas sync lock: ${lock.error}`]);
  }

  let outcome: Result<CloudflareSyncReport>;
  let lockReleaseError: string | null = null;
  try {
    outcome = await attemptKindsSync({ at, client, paths, progress, selection });
  } finally {
    try {
      lock.value.release();
    } catch (error: unknown) {
      lockReleaseError = error instanceof Error ? error.message : String(error);
    }
  }
  // `lockReleaseError` is reported here, on the run's OWN outcome, rather than overturning it.
  return outcome.isOk() ? ok({ ...outcome.value, lockReleaseError }) : outcome;
}
