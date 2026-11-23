/**
 * What a restore rehearsal reports, and the one pure step that judges a verification's facts into it. The run
 * that gathers those facts is `./rehearsal.ts`; the verdicts themselves are `./rehearsalCheck.ts`'s.
 */
import {
  type CountVerdict,
  compareSchema,
  judgeCount,
  judgeRehearsal,
  judgeSample,
  type LegsReading,
  type RehearsalVerdict,
  type SampleVerdict,
  type SchemaVerdict,
  type VaultReading,
} from "./rehearsalCheck.js";
import type { RehearsalSource } from "./rehearsalSource.js";
import type { LiveStore, RehearsalTarget } from "./rehearsalTarget.js";
import type { SampleResult, VerificationFacts } from "./rehearsalVerify.js";
import type { RestoreMode } from "./restorePlan.js";

/** What a rehearsal did and found. */
export interface RehearsalReport {
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
  readonly source: {
    /** The local destination root the backup was read from. */
    readonly destination: string;
    readonly prefix: string;
    readonly createdAtIso: string;
    readonly dumpBytes: number;
    readonly dumpSha256: string;
  };
  readonly live: {
    readonly database: string;
    readonly port: number;
    readonly container: string;
    readonly imageId: string;
  };
  readonly throwaway: {
    readonly container: string;
    readonly id: string;
    readonly database: string;
    readonly port: number;
    readonly mounts: number;
    /** Whether it was left running (`--keep`) rather than stopped. */
    readonly kept: boolean;
  };
  readonly restoreMode: RestoreMode;
  readonly restoreSeconds: number;
  readonly schema: SchemaVerdict;
  readonly legs: LegsReading;
  readonly vault: VaultReading;
  readonly counts: readonly CountVerdict[];
  readonly sample: readonly SampleVerdict[];
  readonly unsampled: SampleResult["unsampled"];
  readonly verdict: RehearsalVerdict;
}

/**
 * Judge the facts a verification read and lay the whole run out as its report. The throwaway's mounts are
 * reported as 0 because a run only reaches here once `throwawayMountsClear` has refused any.
 *
 * @param facts both sides' catalog, counts and sample
 * @param id the container this run created
 * @param keep whether the throwaway is being left running
 * @param mode how the dump was replayed
 * @param vault the Vault leg as restored into the throwaway
 * @returns the report, its verdict included
 */
export function assembleReport({
  facts,
  finishedAtIso,
  id,
  keep,
  legs,
  live,
  mode,
  restoreSeconds,
  source,
  startedAtIso,
  target,
  vault,
}: {
  facts: VerificationFacts;
  finishedAtIso: string;
  id: string;
  keep: boolean;
  legs: LegsReading;
  live: LiveStore;
  mode: RestoreMode;
  restoreSeconds: number;
  source: RehearsalSource;
  startedAtIso: string;
  target: RehearsalTarget;
  vault: VaultReading;
}): RehearsalReport {
  const schema = compareSchema({ copy: facts.copyCatalog, live: facts.liveCatalog });
  const counts = facts.counts.map((reading) => judgeCount({ reading }));
  const sample = facts.sample.rows.map((reading) => judgeSample({ reading }));
  return {
    counts,
    finishedAtIso,
    legs,
    live: { container: live.container, database: live.database, imageId: live.imageId, port: live.port },
    restoreMode: mode,
    restoreSeconds,
    sample,
    schema,
    source: {
      createdAtIso: source.manifest.createdAtIso,
      destination: source.destination,
      dumpBytes: source.manifest.dump.bytes,
      dumpSha256: source.manifest.dump.sha256,
      prefix: source.prefix,
    },
    startedAtIso,
    throwaway: {
      container: target.container,
      database: target.database,
      id,
      kept: keep,
      mounts: 0,
      port: target.port,
    },
    unsampled: facts.sample.unsampled,
    vault,
    verdict: judgeRehearsal({ counts, legs, sample, schema, vault }),
  };
}
