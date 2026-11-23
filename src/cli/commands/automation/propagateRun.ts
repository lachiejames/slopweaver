/**
 * What a successful corpus resync does LAST: re-derive the readings that read it, then put ONE visible pass on
 * the board for everything that needs judgement.
 *
 * Every corpus sync ends with a session that does a pass over the queue, the workstreams and the database and
 * updates whatever is worth updating, so workstreams track in real time without anyone having to say a word. The map of what
 * reads what is `../../../live/resync/propagation.ts`; this is the shell that acts on it.
 *
 * ## Three orderings are the contract
 *
 * 1. **The sync's own verdict is already written before anything here runs**, and nothing here changes it. A
 *    landing read that fails, or a seat that cannot open, is on the propagation record the pass reads — never a
 *    failed resync, which would re-fetch a source that was fetched fine.
 * 2. **The reading's receipt is the one THIS run appended**, captured off the `recordReading` seam as the
 *    landing verb calls it. Asking `reading last` afterwards could answer another writer's reading — the page's
 *    own Sync-now, a tick — and stamp this sync with it.
 * 3. **Only opening the batch seats a session.** Every later sync, under the same lock, joins the open batch and
 *    seats nothing, so seven corpus resyncs in one seat open ONE pass. The seat order is `automation seat`'s own:
 *    resolve the checkout, register the dispatch row, then `cmux spawn` — rule 2's allowed shape, a VISIBLE
 *    session the owner can watch and interrupt, never a headless one.
 *
 * ## Who may seat automatically
 *
 * Only a resync against the ambient home, run from inside a visible session — which every scheduled resync is,
 * because `automation seat` opened it. A hand-run `--home <throwaway>` or a subprocess test records the batch and
 * PRINTS `automation propagate --seat`; it never opens a real workspace.
 */
import { randomUUID } from "node:crypto";

import { acquireOperationLockWaiting } from "../../../admit/operationLockWait.js";
import type { CorpusSource } from "../../../corpus/types.js";
import { currentSessionId } from "../../../handover/runOwner.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type DeclaredRepositories, readDeclaredRepositories } from "../../../live/github/declaredRepositories.js";
import { propagationFor } from "../../../live/resync/propagation.js";
import {
  joinBatch,
  type PropagationRecord,
  pendingSyncs,
  propagationIdOf,
  type SurfaceOutcome,
  seatNeed,
} from "../../../live/resync/propagationBatch.js";
import { readActiveBatch, writeActiveBatch, writePropagationRecord } from "../../../live/resync/propagationStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { realWaitClock } from "../../../wait/loop.js";
import { EXIT_OK } from "../../exitCodes.js";
import { productionGithubLandingDeps } from "../github/landingDeps.js";
import { runGithubLanding } from "../github/landingRun.js";
import { type PassSeatEdges, passSessionOf, productionPassSeatEdges, seatIfNeeded } from "./propagateSeat.js";

/** The operation lock every batch read-modify-write holds. */
const BATCH_LOCK_KEY = "corpus-propagation-batch";

/** How long a propagation waits for another one's batch write before giving up. Batch writes take milliseconds. */
const LOCK_WAIT_SECONDS = 120;

/** A reading this run appended, as the ledger receipted it. */
interface TakenReading {
  readonly readingId: string;
  readonly observedAtIso: string;
}

/** The injected edges, so a propagation is testable without GitHub, a lock or a workspace. */
export interface CorpusPropagationDeps {
  readonly now: () => string;
  readonly mintId: () => string;
  readonly repositories: (args: { readonly home: string }) => DeclaredRepositories;
  /** Takes and records one `github landing` reading as `by`, answering the receipt of the one it appended. */
  readonly takeLandingReading: (args: {
    readonly home: string;
    readonly repositories: readonly string[];
    readonly by: string;
  }) => Promise<Result<TakenReading, string>>;
  /** Runs `run` holding the batch lock, or answers why the lock could not be taken. */
  readonly withBatchLock: (args: {
    readonly home: string;
    readonly run: () => Promise<readonly string[]>;
  }) => Promise<Result<readonly string[], string>>;
  /** Whether this process may open a workspace without being asked to — see the module header. */
  readonly seatAdmitted: (args: { readonly home: string }) => boolean;
  readonly seatEdges: PassSeatEdges;
  readonly writeOut: (line: string) => void;
}

/**
 * The production edges.
 *
 * @returns the real landing read, lock, admission and seat
 * @internal
 */
export function productionCorpusPropagationDeps(): CorpusPropagationDeps {
  return {
    mintId: () => randomUUID(),
    now: () => new Date().toISOString(),
    repositories: ({ home }) => readDeclaredRepositories({ home }),
    seatAdmitted: ({ home }) => home === slopweaverHome() && currentSessionId({ env: process.env }) !== undefined,
    seatEdges: productionPassSeatEdges(),
    takeLandingReading: (args) => productionLandingReading(args),
    withBatchLock: (args) => withBatchLock(args),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Take one landing reading with the landing verb's own production edges, its stdout discarded and its ledger
 * receipt captured as it is appended.
 *
 * @param home the state home the reading lands in
 * @param repositories the `owner/name` repositories to read
 * @param by who the reading is recorded as
 * @returns the receipt of the reading this call appended, or why there is none
 */
async function productionLandingReading({
  home,
  repositories,
  by,
}: {
  readonly home: string;
  readonly repositories: readonly string[];
  readonly by: string;
}): Promise<Result<TakenReading, string>> {
  const base = productionGithubLandingDeps();
  const diagnostics: string[] = [];
  let taken: TakenReading | undefined;
  const exitCode = await runGithubLanding({
    deps: {
      ...base,
      recordReading: (args) => {
        const recorded = base.recordReading(args);
        if (recorded.isOk()) {
          taken = { observedAtIso: args.observedAtIso, readingId: recorded.value };
        }
        return recorded;
      },
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: () => undefined,
    },
    rest: [
      "--repo",
      repositories.join(","),
      "--author",
      "@me",
      "--include-drafts",
      "--json",
      "--record-reading",
      by,
      "--home",
      home,
    ],
  });
  if (exitCode !== EXIT_OK || taken === undefined) {
    const said = diagnostics.slice(-3).join(" · ");
    return err(`github landing exited ${String(exitCode)} and recorded no reading${said === "" ? "" : `: ${said}`}`);
  }
  return ok(taken);
}

/**
 * Run `run` under the batch lock, waiting briefly for another propagation's write.
 *
 * @param home the state home the lock lives under
 * @param run the read-modify-write, answering its report lines
 * @returns the lines, or why the lock could not be taken
 */
async function withBatchLock({
  home,
  run,
}: {
  readonly home: string;
  readonly run: () => Promise<readonly string[]>;
}): Promise<Result<readonly string[], string>> {
  const lock = await acquireOperationLockWaiting({
    clock: realWaitClock(),
    emit: () => undefined,
    home,
    key: BATCH_LOCK_KEY,
    nowIso: () => new Date().toISOString(),
    timeoutSeconds: LOCK_WAIT_SECONDS,
  });
  if (lock.isErr()) {
    return err(lock.error);
  }
  try {
    return ok(await run());
  } finally {
    lock.value.release();
  }
}

/** One sync, as the resync verb hands it over. */
export interface SyncToPropagate {
  readonly home: string;
  readonly recipeId: string;
  readonly source: CorpusSource;
  readonly syncFinishedAtIso: string;
}

/**
 * Propagate one successful corpus sync: re-derive, record, and join or seat the pass.
 *
 * @param sync the sync that just succeeded
 * @param deps the injected edges
 * @returns the record written — also when writing it failed, so the caller can still print it
 */
export async function propagateCorpusSync({
  sync,
  deps,
}: {
  readonly sync: SyncToPropagate;
  readonly deps: CorpusPropagationDeps;
}): Promise<PropagationRecord> {
  const propagationId = propagationIdOf({ recipeId: sync.recipeId, syncFinishedAtIso: sync.syncFinishedAtIso });
  const surfaces = await deriveSurfaces({ deps, propagationId, sync });
  const record: PropagationRecord = {
    propagatedAtIso: deps.now(),
    propagationId,
    recipeId: sync.recipeId,
    schemaVersion: 1,
    source: sync.source,
    surfaces,
    syncFinishedAtIso: sync.syncFinishedAtIso,
  };
  for (const outcome of surfaces) {
    deps.writeOut(`  propagation · ${surfaceLine({ outcome })}`);
  }
  const dir = stateHomePaths({ home: sync.home }).live.recipe.propagationDir;
  const written = writePropagationRecord({ dir, record });
  if (written.isErr()) {
    deps.writeOut(`  propagation · ${written.error.message}`);
    return record;
  }
  const joined = await deps.withBatchLock({
    home: sync.home,
    run: () => joinAndMaybeSeat({ deps, dir, home: sync.home, record }),
  });
  const lines = joined.isOk() ? joined.value : [`the pass was not joined — ${joined.error}`];
  lines.forEach((line) => {
    deps.writeOut(`  propagation · ${line}`);
  });
  return record;
}

/**
 * Every surface's outcome for one sync: the landing reading taken where the map says so, the rest recorded as
 * the map declares them.
 *
 * @param sync the sync
 * @param propagationId its record id, which the reading is recorded as
 * @param deps the injected edges
 * @returns one outcome per declared edge
 */
async function deriveSurfaces({
  sync,
  propagationId,
  deps,
}: {
  readonly sync: SyncToPropagate;
  readonly propagationId: string;
  readonly deps: CorpusPropagationDeps;
}): Promise<readonly SurfaceOutcome[]> {
  const outcomes: SurfaceOutcome[] = [];
  for (const edge of propagationFor({ source: sync.source })) {
    if (edge.mode.kind !== "reading") {
      outcomes.push({ detail: edge.mode.why, status: edge.mode.kind, surface: edge.surface });
      continue;
    }
    const declared = deps.repositories({ home: sync.home });
    if (declared.slugs.length === 0) {
      outcomes.push({
        detail: `no declared main checkout resolved to a repository (${String(declared.unresolved.length)} unresolved) — nothing to read`,
        status: "failed",
        surface: edge.surface,
      });
      continue;
    }
    const taken = await deps.takeLandingReading({
      by: `corpus-propagation:${propagationId}`,
      home: sync.home,
      repositories: declared.slugs,
    });
    if (taken.isErr()) {
      outcomes.push({ detail: taken.error, status: "failed", surface: edge.surface });
      continue;
    }
    outcomes.push({
      observedAtIso: taken.value.observedAtIso,
      producer: edge.mode.producer,
      readingId: taken.value.readingId,
      status: "re-derived",
      surface: edge.surface,
    });
  }
  return outcomes;
}

/**
 * One surface's line in the resync's own output.
 *
 * @param outcome what happened to the surface
 * @returns the line
 */
export function surfaceLine({ outcome }: { readonly outcome: SurfaceOutcome }): string {
  if (outcome.status === "re-derived") {
    return `${outcome.surface} · re-derived: ${outcome.producer} reading ${outcome.readingId}, observed ${outcome.observedAtIso}`;
  }
  return `${outcome.surface} · ${outcome.status} — ${outcome.detail}`;
}

/**
 * Under the lock: join the sync to the open batch, and open a session if the batch has none.
 *
 * @param record the sync's record
 * @param dir the propagation directory
 * @param home the state home
 * @param deps the injected edges
 * @returns the lines reporting what happened to the pass
 */
async function joinAndMaybeSeat({
  record,
  dir,
  home,
  deps,
}: {
  readonly record: PropagationRecord;
  readonly dir: string;
  readonly home: string;
  readonly deps: CorpusPropagationDeps;
}): Promise<readonly string[]> {
  const active = readActiveBatch({ dir });
  if (active.isErr()) {
    return [`the open pass could not be read, so this sync joined none: ${active.error.message}`];
  }
  const nowIso = deps.now();
  const joined = joinBatch({ active: active.value, batchId: deps.mintId(), nowIso, record });
  const saved = writeActiveBatch({ batch: joined.batch, dir });
  if (saved.isErr()) {
    return [saved.error.message];
  }
  const verb = joined.opened ? "opened" : "joined";
  const lines = [
    `pass ${joined.batch.seat.slug} · ${verb} at revision ${String(joined.batch.revision)}, ${String(pendingSyncs({ batch: joined.batch }).length)} sync(s) pending`,
  ];
  if (!deps.seatAdmitted({ home })) {
    const session = await passSessionOf({ batch: joined.batch, edges: deps.seatEdges });
    const need = seatNeed({ batch: joined.batch, batchId: deps.mintId(), nowIso, session });
    if (need.kind !== "seated") {
      lines.push(
        `pass not seated: this resync is not a visible session on the ambient home — \`slopweaver automation propagate --seat --home ${home}\` opens it`,
      );
    }
    return lines;
  }
  const seated = await seatIfNeeded({ batch: joined.batch, deps, dir, home, nowIso });
  return [...lines, ...seated.lines];
}
