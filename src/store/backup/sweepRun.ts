/**
 * `store backup --sweep-only`: no new dump, every destination on the list swept in order for the earlier stagings
 * it lacks (`./sweep.ts`), then one release and prune once every destination has been tried (`./finishStagings.ts`).
 * It is how a night whose send failed, or whose drive was out, reaches that destination later without re-dumping.
 *
 * As with a night (`./run.ts`), the CLI decides how each destination is reached and routes each one's write through
 * its own door; a drive that is out enters none and is reported as out.
 */
import { existsSync } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";
import type { RetryPolicy } from "#lib/resilience.js";
import { err, ok, type Result } from "#lib/result.js";

import type { ConfiguredDestination, DestinationId } from "./destinationConfig.js";
import { encryptingTransport } from "./encryptingTransport.js";
import { backupErrorLines } from "./errors.js";
import { type FinishedStagings, finishStagings } from "./finishStagings.js";
import { type KeyWrapStatus, keyWrapFor } from "./keyWrapStep.js";
import { DEFAULT_KEEP_LOCAL } from "./run.js";
import { stagingRoot } from "./staging.js";
import { type SweepReport, sweepStrandedStagings } from "./sweep.js";
import type { BackupTransport } from "./transport.js";
import type { VolumePin } from "./volumePin.js";

/** What sweeping one reachable destination did. */
export interface DestinationSweep {
  /** The key wrap, written before anything is swept so a recovered staging is never sent without it. */
  readonly keyWrap: KeyWrapStatus;
  readonly sweep: SweepReport;
}

/** What became of one destination on a sweep. */
export type DestinationSweepOutcome =
  | { readonly status: "swept"; readonly destination: ConfiguredDestination; readonly report: DestinationSweep }
  | {
      readonly status: "drive-not-plugged-in";
      readonly destination: ConfiguredDestination;
      readonly pin: VolumePin;
    }
  | { readonly status: "failed"; readonly destination: ConfiguredDestination; readonly errors: readonly string[] };

/** One destination as a sweep finds it. */
export type SweepTarget =
  | {
      readonly kind: "reachable";
      readonly destination: ConfiguredDestination;
      /** Sweep this destination — through its own door — and say what became of it. */
      readonly sweep: () => Promise<DestinationSweepOutcome>;
    }
  | { readonly kind: "not-plugged-in"; readonly destination: ConfiguredDestination; readonly pin: VolumePin }
  | { readonly kind: "failed"; readonly destination: ConfiguredDestination; readonly errors: readonly string[] };

/** What a sweep-only run did. */
export interface SweepOnlyReport extends FinishedStagings {
  /** One per destination, in list order. */
  readonly destinations: readonly DestinationSweepOutcome[];
}

/**
 * Sweep ONE destination: its key wrap first — before the no-staging case, so a sweep is also how a destination gains
 * the wrap without a new dump — then every earlier staging it lacks.
 *
 * @param home the Slopweaver home the staging root lives under
 * @param destination which configured destination this is
 * @param transport the PLAIN destination, wrapped here in the object cipher
 * @param key the backup key every object is encrypted under
 * @param masterPassword the password the key is wrapped under, or `null` when none is set
 * @param uploadRetry how a failed upload session is retried, when not the default; a test passes a zero backoff
 * @returns what the sweep did, or why the key wrap did not land (and nothing was swept)
 */
export async function sweepDestination({
  home,
  destination,
  transport,
  key,
  masterPassword,
  uploadRetry,
}: {
  home: string;
  destination: ConfiguredDestination;
  transport: BackupTransport;
  key: Buffer;
  masterPassword: string | null;
  uploadRetry?: RetryPolicy;
}): Promise<Result<DestinationSweep>> {
  const keyWrap = await keyWrapFor({ destination: transport, key, masterPassword });
  if (keyWrap.isErr()) {
    return err(backupErrorLines({ error: keyWrap.error }));
  }
  const root = stagingRoot({ home });
  if (!existsSync(root)) {
    return ok({ keyWrap: keyWrap.value, sweep: { recovered: [], unfinished: [], unrecoverable: [] } });
  }
  const sent = encryptingTransport({ inner: transport, key });
  const sweep = await sweepStrandedStagings({
    destination,
    encryption: { keyFingerprint: sent.keyFingerprint, scheme: sent.scheme },
    root,
    transport: sent.transport,
    ...(uploadRetry === undefined ? {} : { uploadRetry }),
  });
  return ok({ keyWrap: keyWrap.value, sweep });
}

/**
 * A reachable sweep target that sweeps straight into `transport` — what the CLI's door wraps, and what a test hands in.
 *
 * @param home the Slopweaver home the staging root lives under
 * @param destination which configured destination this is
 * @param transport the PLAIN destination
 * @param key the backup key
 * @param masterPassword the password the key is wrapped under, or `null` when none is set
 * @param uploadRetry how a failed upload session is retried, when not the default
 * @returns the target
 */
export function reachableSweepTarget({
  home,
  destination,
  transport,
  key,
  masterPassword,
  uploadRetry,
}: {
  home: string;
  destination: ConfiguredDestination;
  transport: BackupTransport;
  key: Buffer;
  masterPassword: string | null;
  uploadRetry?: RetryPolicy;
}): SweepTarget {
  return {
    destination,
    kind: "reachable",
    sweep: async () => {
      const swept = await sweepDestination({
        destination,
        home,
        key,
        masterPassword,
        transport,
        ...(uploadRetry === undefined ? {} : { uploadRetry }),
      });
      if (swept.isErr()) {
        return { destination, errors: swept.error, status: "failed" };
      }
      return { destination, report: swept.value, status: "swept" };
    },
  };
}

/**
 * Sweep every target in order, then release and prune once — a release or prune between two destinations would
 * let a staging go before the next destination got it.
 *
 * @param home the Slopweaver home the staging root lives under
 * @param targets every destination, in list order
 * @param obligations the ids pruning reads each staging against (`pruneObligations`)
 * @param keepLocal how many staging directories every destination holds to keep on disk
 * @returns one outcome per destination, and what finishing released and pruned
 */
export async function runSweepOnly({
  home,
  targets,
  obligations,
  keepLocal = DEFAULT_KEEP_LOCAL,
}: {
  home: string;
  targets: readonly SweepTarget[];
  obligations: readonly DestinationId[];
  keepLocal?: number;
}): Promise<SweepOnlyReport> {
  const outcomes: DestinationSweepOutcome[] = [];
  for (const target of targets) {
    outcomes.push(await sweepTarget({ target }));
  }
  const root = stagingRoot({ home });
  const destinations = targets.map((target) => target.destination);
  if (!existsSync(root)) {
    return {
      destinations: outcomes,
      pruned: [],
      released: [],
      stranded: destinations.map((d) => ({ destination: d, names: [] })),
      unremoved: [],
    };
  }
  const finished = finishStagings({
    destinations,
    keepLocal,
    obligations,
    prune: outcomes.some((outcome) => outcome.status === "swept"),
    root,
    tonight: null,
  });
  return { destinations: outcomes, ...finished };
}

/**
 * What became of one sweep target, with a throw turned into that destination's failure.
 *
 * @param target the destination as the sweep found it
 * @returns its outcome
 */
async function sweepTarget({ target }: { target: SweepTarget }): Promise<DestinationSweepOutcome> {
  const { destination } = target;
  if (target.kind === "not-plugged-in") {
    return { destination, pin: target.pin, status: "drive-not-plugged-in" };
  }
  if (target.kind === "failed") {
    return { destination, errors: target.errors, status: "failed" };
  }
  try {
    return await target.sweep();
  } catch (cause: unknown) {
    return {
      destination,
      errors: [`sweeping ${destination.root} threw: ${errorMessage({ error: cause })}`],
      status: "failed",
    };
  }
}
