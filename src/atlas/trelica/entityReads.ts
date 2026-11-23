/**
 * The read half of the nine 15-Oct kinds: call each `entityInventory.ts` row, admit it through its strict
 * boundary, and project what was admitted. A kind that could not be read whole comes back as a reason
 * (`entityList.ts` says why), and `entitySync.ts` keeps what the generation already held for it.
 */
import {
  trelicaAccessReviewsBoundary,
  trelicaAssessmentsBoundary,
  trelicaDevicesBoundary,
} from "./assuranceBoundaries.js";
import type { TrelicaCallResult, TrelicaClient } from "./client.js";
import { TRELICA_ENTITY_CALLS } from "./entityInventory.js";
import {
  readTrelicaList,
  readTrelicaOne,
  type TrelicaEntityKind,
  type TrelicaEntityRead,
  type TrelicaKindOutcome,
  unreadTrelicaKind,
} from "./entityList.js";
import {
  trelicaAccessReviewDetail,
  trelicaAssessmentDetail,
  trelicaConnections,
  trelicaContractDetail,
  trelicaDeviceDetail,
  trelicaFirstPartyEntities,
  trelicaIntegrationDetail,
  trelicaPersonDetail,
  trelicaTeamDetail,
} from "./entityProjection.js";
import { trelicaContractsBoundary, trelicaIntegrationsBoundary } from "./estateBoundaries.js";
import type { TrelicaCall } from "./inventory.js";
import type { TrelicaAtlasEntity } from "./model.js";
import { trelicaPeopleBoundary, trelicaTeamsBoundary } from "./peopleBoundaries.js";
import { readTrelicaRuns, type TrelicaRunStepCounts } from "./runSteps.js";
import type { TrelicaAtlasPaths } from "./store.js";
import type { TrelicaBoundary } from "./trelicaBoundary.js";
import { trelicaWorkflowsBoundary, trelicaWorkflowTagsBoundary } from "./workflowBoundaries.js";
import { trelicaWorkflowDetail } from "./workflowProjection.js";

/** Everything the entity half of one run collected. */
export interface TrelicaEntityRun {
  readonly reads: readonly TrelicaEntityRead[];
  readonly steps: TrelicaRunStepCounts;
  /** Every read that answered, in the shape the method map records an admitted call in. */
  readonly calls: readonly TrelicaCallResult[];
}

/** A kind read whole. */
function held({
  kind,
  entities,
  reason,
  calls,
}: {
  kind: TrelicaEntityKind;
  entities: readonly TrelicaAtlasEntity[];
  reason: string;
  calls: readonly TrelicaCallResult[];
}): TrelicaKindOutcome {
  return { calls, read: { entities, held: true, kind, reason } };
}

/** Workflows, with each one's tag held as the label the Workflows page shows. */
async function readWorkflows({ client, at }: { client: TrelicaClient; at: string }): Promise<TrelicaKindOutcome> {
  const call = TRELICA_ENTITY_CALLS.workflows;
  const workflows = await readTrelicaList({ boundary: trelicaWorkflowsBoundary, call, client });
  if (workflows.isErr()) {
    return unreadTrelicaKind({ kind: "workflow", reasons: workflows.error });
  }
  const tagCall = TRELICA_ENTITY_CALLS.workflowTags;
  const tags = await readTrelicaOne({ boundary: trelicaWorkflowTagsBoundary, call: tagCall, client });
  if (tags.isErr()) {
    return unreadTrelicaKind({ kind: "workflow", reasons: tags.error });
  }
  const labels = new Map(tags.value.record.map((tag) => [tag.id, tag.label]));
  const entities = trelicaFirstPartyEntities({
    at,
    detailOf: (record) => trelicaWorkflowDetail({ record, tags: labels }),
    endpoint: call.path,
    idOf: (record) => record.id.id,
    kind: "workflow",
    records: workflows.value.records,
  });
  const enabled = workflows.value.records.filter((record) => record.enabled).length;
  return held({
    calls: [workflows.value.call, tags.value.call],
    entities,
    kind: "workflow",
    reason: `${String(entities.length)} workflow definition(s), ${String(enabled)} enabled, read as configuration`,
  });
}

/** The team tree, one entity per team. */
async function readTeams({ client, at }: { client: TrelicaClient; at: string }): Promise<TrelicaKindOutcome> {
  const call = TRELICA_ENTITY_CALLS.teams;
  const tree = await readTrelicaOne({ boundary: trelicaTeamsBoundary, call, client });
  if (tree.isErr()) {
    return unreadTrelicaKind({ kind: "team", reasons: tree.error });
  }
  const rootIds = new Set(tree.value.record.rootTeamIds);
  const entities = trelicaFirstPartyEntities({
    at,
    detailOf: (record) => trelicaTeamDetail({ record, rootIds }),
    endpoint: call.path,
    idOf: (record) => record.id,
    kind: "team",
    records: Object.values(tree.value.record.teamsById),
  });
  const { noTeamPersonCount, totalPersonCount } = tree.value.record;
  return held({
    calls: [tree.value.call],
    entities,
    kind: "team",
    reason: `${String(entities.length)} team(s) over ${String(totalPersonCount)} people, ${String(noTeamPersonCount)} in no team`,
  });
}

/** Every connection the tenant holds, out of the provider catalogue. */
async function readIntegrations({ client, at }: { client: TrelicaClient; at: string }): Promise<TrelicaKindOutcome> {
  const call = TRELICA_ENTITY_CALLS.integrations;
  const catalogue = await readTrelicaList({ boundary: trelicaIntegrationsBoundary, call, client });
  if (catalogue.isErr()) {
    return unreadTrelicaKind({ kind: "integration", reasons: catalogue.error });
  }
  const entities = trelicaFirstPartyEntities({
    at,
    detailOf: (entry) => trelicaIntegrationDetail({ entry }),
    endpoint: call.path,
    idOf: (entry) => entry.connection.id,
    kind: "integration",
    records: trelicaConnections({ providers: catalogue.value.records }),
  });
  return held({
    calls: [catalogue.value.call],
    entities,
    kind: "integration",
    reason: `${String(entities.length)} connection(s) across a catalogue of ${String(catalogue.value.records.length)} provider(s)`,
  });
}

/** A kind whose list read projects one entity per record, keyed by the record's own id. */
async function readFlat<T extends { readonly id: string }>({
  client,
  at,
  kind,
  call,
  boundary,
  detailOf,
  noun,
}: {
  client: TrelicaClient;
  at: string;
  kind: TrelicaEntityKind;
  call: TrelicaCall;
  boundary: TrelicaBoundary<{
    readonly items: readonly T[];
    readonly total: number;
    readonly resultsTruncated: boolean;
  }>;
  detailOf: (record: T) => unknown;
  noun: string;
}): Promise<TrelicaKindOutcome> {
  const list = await readTrelicaList({ boundary, call, client });
  if (list.isErr()) {
    return unreadTrelicaKind({ kind, reasons: list.error });
  }
  const entities = trelicaFirstPartyEntities({
    at,
    detailOf,
    endpoint: call.path,
    idOf: (record) => record.id,
    kind,
    records: list.value.records,
  });
  return held({ calls: [list.value.call], entities, kind, reason: `${String(entities.length)} ${noun}` });
}

/** The five kinds read by {@link readFlat}, each a list projected one entity per record. */
async function readFlatKinds({ client, at }: { client: TrelicaClient; at: string }): Promise<TrelicaKindOutcome[]> {
  const calls = TRELICA_ENTITY_CALLS;
  return [
    await readFlat({
      at,
      boundary: trelicaAccessReviewsBoundary,
      call: calls.accessReviews,
      client,
      detailOf: (record) => trelicaAccessReviewDetail({ record }),
      kind: "access-review",
      noun: "access-review schedule(s)",
    }),
    await readFlat({
      at,
      boundary: trelicaAssessmentsBoundary,
      call: calls.assessments,
      client,
      detailOf: (record) => trelicaAssessmentDetail({ record }),
      kind: "assessment",
      noun: "assessment(s)",
    }),
    await readFlat({
      at,
      boundary: trelicaContractsBoundary,
      call: calls.contracts,
      client,
      detailOf: (record) => trelicaContractDetail({ record }),
      kind: "contract",
      noun: "contract(s)",
    }),
    await readFlat({
      at,
      boundary: trelicaDevicesBoundary,
      call: calls.devices,
      client,
      detailOf: (record) => trelicaDeviceDetail({ record }),
      kind: "device",
      noun: "device(s), merged across every source that reported them",
    }),
    await readFlat({
      at,
      boundary: trelicaPeopleBoundary,
      call: calls.people,
      client,
      detailOf: (record) => trelicaPersonDetail({ record }),
      kind: "person",
      noun: "person record(s), each with the accounts it holds at every source",
    }),
  ];
}

/**
 * Read all nine 15-Oct kinds, keeping a kind that could not be read whole as a reason rather than a short list.
 *
 * @param client the session-holding client
 * @param paths the atlas paths, read only to reuse a run's step detail when the run has not changed
 * @param at this run's ISO timestamp
 * @returns every kind's outcome, the step-detail counts and every call that answered
 */
export async function readTrelicaEntities({
  client,
  paths,
  at,
}: {
  client: TrelicaClient;
  paths: TrelicaAtlasPaths;
  at: string;
}): Promise<TrelicaEntityRun> {
  const outcomes = [
    ...(await readFlatKinds({ at, client })),
    await readIntegrations({ at, client }),
    await readTeams({ at, client }),
    await readWorkflows({ at, client }),
  ];
  const runs = await readTrelicaRuns({ at, client, paths });
  return {
    calls: [...outcomes.flatMap((outcome) => outcome.calls), ...runs.outcome.calls],
    reads: [...outcomes.map((outcome) => outcome.read), runs.outcome.read],
    steps: runs.steps,
  };
}
