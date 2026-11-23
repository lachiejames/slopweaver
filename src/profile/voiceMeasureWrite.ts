/**
 * Measure the owner's voice length register and write it — the one service `profile voice measure` and the Slack refresh
 * lane both call, so the two can never measure differently.
 *
 * Order, and why: read and measure first, so a skip opens no store and a dry run never selects one; then write every
 * cohort AND rebuild the context cache in ONE transaction, so a second row failing cannot leave one surface fresh and
 * the other stale, and a cache that cannot be written cannot leave a register the send door — which reads it from that
 * cache alone — would not see until the next session start. A cohort is only ever replaced by a measured one: an
 * empty population writes nothing, so the last measurement stands rather than becoming zero.
 *
 * With no owner row yet nothing is written and the run is a named skip: the register's rows hang off the owner row by
 * foreign key, and the cache is never written without one (`refreshContextCache` says why).
 */
import { refreshContextCache } from "../context/load.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import type { StoreError } from "../store/errors.js";
import type { VoiceCohort } from "../store/profile/types.js";
import { openVoiceRegisterTarget, type VoiceRegisterTarget } from "../store/profile/voiceRegisterTarget.js";

import type { SlackVoiceMeasurement } from "./voiceMeasure.js";
import { type VoiceMeasureError, VoiceMeasureErrors } from "./voiceMeasureErrors.js";
import { readSlackVoiceMeasurement, type VoiceMeasureSkipped } from "./voiceMeasureRead.js";

/** What a measurement run did. */
export type VoiceMeasureWriteOutcome =
  | {
      readonly kind: "written";
      readonly measurement: SlackVoiceMeasurement;
      readonly filesRead: number;
    }
  | { readonly kind: "dry-run"; readonly measurement: SlackVoiceMeasurement; readonly filesRead: number }
  | (VoiceMeasureSkipped & { readonly measurement?: SlackVoiceMeasurement })
  | { readonly kind: "no-store"; readonly measurement: SlackVoiceMeasurement; readonly message: string };

/** Thrown inside the transaction to roll it back, carrying which step refused, and why, out. */
class CohortWriteRefused extends Error {
  readonly step: "store" | "cache";
  /**
   * @param detail why the step refused
   * @param step the cohort upsert or the cache rebuild
   */
  constructor({ detail, step }: { detail: string; step: "store" | "cache" }) {
    super(detail);
    this.step = step;
  }
}

/**
 * Write every cohort and rebuild the context cache in one transaction, or do neither. The cache is rebuilt from the
 * transaction's own rows before it commits, so a cache that cannot be written rolls the cohorts back rather than
 * leaving a register the send door cannot see. The one window left: the commit itself failing after the cache file
 * was written, which leaves the door one session start ahead of the store until the next live read rewrites it.
 */
async function writeCohorts({
  target,
  cohorts,
}: {
  target: VoiceRegisterTarget;
  cohorts: readonly VoiceCohort[];
}): Promise<Result<"written" | "owner-absent", VoiceMeasureError>> {
  try {
    const outcome = await target.transact({
      body: async (steps): Promise<"written" | "owner-absent"> => {
        const owner = await steps.readOwnerPresent();
        if (owner.isErr()) {
          throw new CohortWriteRefused({ detail: owner.error, step: "store" });
        }
        if (!owner.value) {
          return "owner-absent";
        }
        for (const cohort of cohorts) {
          const written = await steps.upsertCohort({ cohort });
          if (written.isErr()) {
            throw new CohortWriteRefused({ detail: written.error, step: "store" });
          }
        }
        const refreshed = await steps.refreshCache();
        if (refreshed.isErr()) {
          throw new CohortWriteRefused({ detail: refreshed.error, step: "cache" });
        }
        return "written";
      },
    });
    return ok(outcome);
  } catch (error) {
    if (error instanceof CohortWriteRefused && error.step === "cache") {
      return err(VoiceMeasureErrors.cacheFailed({ detail: error.message }));
    }
    return err(VoiceMeasureErrors.storeFailed({ detail: error instanceof Error ? error.message : String(error) }));
  } finally {
    // The outcome is decided by now: a pool that fails to close cannot undo a commit or a rollback, so its rejection
    // must not turn a committed write into a reported failure.
    await target.close().catch(() => undefined);
  }
}

/** Open the register a measurement writes to under one home, stamping the cache it rebuilds with `nowIso`. */
export type OpenVoiceRegister = (args: {
  home: string;
  nowIso: string;
}) => Promise<Result<VoiceRegisterTarget, StoreError>>;

/**
 * The production register: the store this home selected, its context cache rebuilt at the home's own cache path.
 *
 * @returns the open register, or the store's refusal
 */
const openStoreVoiceRegister: OpenVoiceRegister = ({ home, nowIso }) =>
  openVoiceRegisterTarget({
    home,
    refreshCache: ({ client, url }) =>
      refreshContextCache({ cachePath: stateHomePaths({ home }).profileContextJson, client, nowIso, url }),
  });

/**
 * Measure the owner's Slack voice length register and, unless a dry run, write it and refresh the context cache.
 *
 * @param home the Slopweaver home whose profile, corpus, store selection and cache are used
 * @param nowIso the instant the measurement is stamped with
 * @param dryRun measure and report without selecting a store or writing anything
 * @param storeOptional answer `no-store` rather than failing when this home has selected no store — the refresh lane,
 *   which must keep working on an install that runs without one
 * @param openRegister the register written to; the store this home selected unless a test passes a fake
 * @returns what was done, or why it could not be
 */
export async function runVoiceMeasurement({
  home,
  nowIso,
  dryRun,
  storeOptional = false,
  openRegister = openStoreVoiceRegister,
}: {
  home: string;
  nowIso: string;
  dryRun: boolean;
  storeOptional?: boolean;
  openRegister?: OpenVoiceRegister;
}): Promise<Result<VoiceMeasureWriteOutcome, VoiceMeasureError>> {
  const read = readSlackVoiceMeasurement({ home, nowIso });
  if (read.isErr()) {
    return err(read.error);
  }
  if (read.value.kind === "skipped") {
    return ok(read.value);
  }
  const { filesRead, measurement } = read.value;
  if (dryRun) {
    return ok({ filesRead, kind: "dry-run", measurement });
  }
  const opened = await openRegister({ home, nowIso });
  if (opened.isErr()) {
    if (opened.error.code === "STORE_URL_MISSING" && storeOptional) {
      return ok({ kind: "no-store", measurement, message: opened.error.message });
    }
    return err(VoiceMeasureErrors.storeFailed({ detail: opened.error.message }));
  }
  const written = await writeCohorts({ cohorts: measurement.cohorts, target: opened.value });
  if (written.isErr()) {
    return err(written.error);
  }
  if (written.value === "owner-absent") {
    return ok({
      kind: "skipped",
      measurement,
      message: "no owner row has been written yet — `slopweaver profile set --file <owner.json>` seeds it",
      reason: "owner-row-absent",
    });
  }
  return ok({ filesRead, kind: "written", measurement });
}
