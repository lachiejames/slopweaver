/**
 * The `workflow-run` kind: every run from the run list, each with what every one of its steps did.
 *
 * ## The run list says how a run ended; only its detail says which step did what
 *
 * MEASURED: offboarding runs can end `CompletedWithErrors` with `errorCount` 0 and the list's own
 * `states` empty — the list cannot say which step failed. `GET /FlowApi/FlowItem/{id}` can: its
 * `states` carry each step's status and failure count, joined to a step name through the run's own definition
 * version (`workflowProjection.ts`). That is one read per run, so a run whose `lastModifiedDtm` matches the one
 * already held reuses the steps already held — a finished run does not change — and only a new or moving run
 * is read again.
 *
 * ## A run whose detail cannot be read still projects
 *
 * It keeps its status from the list and carries `steps: null`, and the shortfall is counted into a
 * `workflow-run-steps-unread` gap. The list is complete either way, so no run goes stale over a detail read.
 */
import { z } from "zod";

import { createConcurrencyLimiter } from "#lib/resilience.js";
import { err, ok, type Result } from "#lib/result.js";

import type { TrelicaClient } from "./client.js";
import { TRELICA_ENTITY_CALLS, trelicaRunDetailCall, trelicaWorkflowVersionCall } from "./entityInventory.js";
import { readTrelicaList, readTrelicaOne, type TrelicaKindOutcome, unreadTrelicaKind } from "./entityList.js";
import type { TrelicaRunStep } from "./entityModel.js";
import { trelicaFirstPartyEntities } from "./entityProjection.js";
import { heldTrelicaProviderText } from "./providerText.js";
import { readTrelicaAtlas, type TrelicaAtlasPaths } from "./store.js";
import {
  type TrelicaWorkflowRunRecord,
  trelicaRunDetailBoundary,
  trelicaWorkflowRunsBoundary,
  trelicaWorkflowVersionBoundary,
} from "./workflowBoundaries.js";
import { trelicaRunSteps, trelicaVersionStepNames, trelicaWorkflowRunDetail } from "./workflowProjection.js";

/**
 * How many run-detail reads are in flight at once — about what the web client itself opens on a page.
 * MEASURED: serial run-detail reads made a generation-wide detail crawl materially slow. Reproduce against a
 * generation holding no run steps: `slopweaver atlas trelica reset --confirm archive`, then time `slopweaver atlas trelica sync`.
 */
const RUN_DETAIL_CONCURRENCY = 6;

/** How many runs' steps were read fresh, reused unchanged, or could not be read this run. */
export interface TrelicaRunStepCounts {
  readonly read: number;
  readonly reused: number;
  readonly unread: number;
  /** The first reason a run's detail could not be read, so the gap names a cause rather than a count. */
  readonly firstFailure: string | null;
}

/** The part of a held run's detail a later sync reuses. Our own record, so a partial read rather than a boundary. */
const heldRunSchema = z.object({
  lastModifiedAt: z.string(),
  steps: z.array(
    z.object({
      failureCount: z.number(),
      failureMessage: z.string().nullable(),
      name: z.string().nullable(),
      resultAt: z.string().nullable(),
      status: z.string(),
      stepId: z.string(),
    }),
  ),
});

/** Every held run's steps, by run id. Empty when there is no generation to read — a cache, so absence is by design. */
function heldRunSteps({
  paths,
}: {
  paths: TrelicaAtlasPaths;
}): ReadonlyMap<string, { lastModifiedAt: string; steps: readonly TrelicaRunStep[] }> {
  const held = new Map<string, { lastModifiedAt: string; steps: readonly TrelicaRunStep[] }>();
  const snapshot = readTrelicaAtlas({ paths });
  if (snapshot.isErr()) {
    return held;
  }
  const file = snapshot.value.files["workflow-run"];
  for (const entity of file == null ? [] : file.entities) {
    const view = entity.channels["first-party-api"];
    const parsed = heldRunSchema.safeParse(view === null ? null : view.detail);
    if (parsed.success) {
      held.set(entity.providerId, parsed.data);
    }
  }
  return held;
}

/**
 * Held steps passed through today's provider-text rule again, so a message an older generation held under a
 * looser rule is not carried forward by reuse. Holding is idempotent, so a message held today is unchanged.
 *
 * @returns the steps with each failure message re-held
 * @internal
 */
export function reheldSteps({ steps }: { steps: readonly TrelicaRunStep[] }): readonly TrelicaRunStep[] {
  return steps.map((step) => ({ ...step, failureMessage: heldTrelicaProviderText({ text: step.failureMessage }) }));
}

/** Step names by activity id, per definition version, each version read at most once per sync. */
type VersionNames = Map<string, Promise<Result<ReadonlyMap<string, string>>>>;

/** One definition version's step names, read through its boundary. */
async function readVersionNames({
  client,
  run,
}: {
  client: TrelicaClient;
  run: TrelicaWorkflowRunRecord;
}): Promise<Result<ReadonlyMap<string, string>>> {
  const call = trelicaWorkflowVersionCall({ version: run.flowVersion, workflowId: run.flowId });
  if (call === null) {
    return err([
      `workflow id ${run.flowId} at version ${String(run.flowVersion)} is not a pair this atlas will place in a path`,
    ]);
  }
  const read = await readTrelicaOne({ boundary: trelicaWorkflowVersionBoundary, call, client });
  if (read.isErr()) {
    return err(read.error);
  }
  return ok(trelicaVersionStepNames({ version: read.value.record }));
}

/** One run's step outcomes: its definition version's names, then its own detail. */
async function readRunSteps({
  client,
  run,
  versions,
}: {
  client: TrelicaClient;
  run: TrelicaWorkflowRunRecord;
  versions: VersionNames;
}): Promise<Result<readonly TrelicaRunStep[]>> {
  const key = `${run.flowId}/${String(run.flowVersion)}`;
  let pending = versions.get(key);
  if (pending === undefined) {
    pending = readVersionNames({ client, run });
    versions.set(key, pending);
  }
  const names = await pending;
  if (names.isErr()) {
    return err(names.error);
  }
  const call = trelicaRunDetailCall({ runId: run.id });
  if (call === null) {
    return err([`run id ${run.id} is not an id this atlas will place in a path`]);
  }
  const detail = await readTrelicaOne({ boundary: trelicaRunDetailBoundary, call, client });
  if (detail.isErr()) {
    return err(detail.error);
  }
  return ok(trelicaRunSteps({ detail: detail.value.record, stepNames: names.value }));
}

/** Every run's steps — reused when the run has not moved, read otherwise — and the counts. */
async function stepsForRuns({
  client,
  runs,
  held,
}: {
  client: TrelicaClient;
  runs: readonly TrelicaWorkflowRunRecord[];
  held: ReadonlyMap<string, { lastModifiedAt: string; steps: readonly TrelicaRunStep[] }>;
}): Promise<{ byRun: ReadonlyMap<string, readonly TrelicaRunStep[] | null>; counts: TrelicaRunStepCounts }> {
  const limit = createConcurrencyLimiter({ concurrency: RUN_DETAIL_CONCURRENCY });
  const versions: VersionNames = new Map();
  const outcomes = await Promise.all(
    runs.map(async (run) =>
      limit(async () => {
        const kept = held.get(run.id);
        if (kept !== undefined && kept.lastModifiedAt === run.lastModifiedDtm) {
          return { id: run.id, reused: true, steps: ok(reheldSteps({ steps: kept.steps })) };
        }
        return { id: run.id, reused: false, steps: await readRunSteps({ client, run, versions }) };
      }),
    ),
  );
  const byRun = new Map(outcomes.map((outcome) => [outcome.id, outcome.steps.isOk() ? outcome.steps.value : null]));
  const failures = outcomes.flatMap((outcome) => (outcome.steps.isErr() ? [outcome.steps.error.join("; ")] : []));
  const reused = outcomes.filter((outcome) => outcome.reused).length;
  return {
    byRun,
    counts: {
      firstFailure: failures.length === 0 ? null : failures[0]!,
      read: outcomes.length - reused - failures.length,
      reused,
      unread: failures.length,
    },
  };
}

/**
 * Read every run, then every run's step outcomes.
 *
 * @param client the session-holding client
 * @param paths the atlas paths, read only for the steps already held
 * @param at this run's ISO timestamp
 * @returns the kind's outcome and the step-detail counts
 */
export async function readTrelicaRuns({
  client,
  paths,
  at,
}: {
  client: TrelicaClient;
  paths: TrelicaAtlasPaths;
  at: string;
}): Promise<{ outcome: TrelicaKindOutcome; steps: TrelicaRunStepCounts }> {
  const call = TRELICA_ENTITY_CALLS.workflowRuns;
  const list = await readTrelicaList({ boundary: trelicaWorkflowRunsBoundary, call, client });
  if (list.isErr()) {
    const steps = { firstFailure: null, read: 0, reused: 0, unread: 0 };
    return { outcome: unreadTrelicaKind({ kind: "workflow-run", reasons: list.error }), steps };
  }
  const runs = list.value.records;
  const { byRun, counts } = await stepsForRuns({ client, held: heldRunSteps({ paths }), runs });
  const entities = trelicaFirstPartyEntities({
    at,
    detailOf: (record) => {
      // Every listed run has an entry: `stepsForRuns` maps over exactly this list.
      return trelicaWorkflowRunDetail({ record, steps: byRun.get(record.id)! });
    },
    endpoint: call.path,
    idOf: (record) => record.id,
    kind: "workflow-run",
    records: runs,
  });
  const reason =
    `${String(entities.length)} run(s) of every workflow, with step-by-step outcomes for ` +
    `${String(counts.read + counts.reused)} (${String(counts.reused)} unchanged since the last sync)`;
  return {
    outcome: { calls: [list.value.call], read: { entities, held: true, kind: "workflow-run", reason } },
    steps: counts,
  };
}
