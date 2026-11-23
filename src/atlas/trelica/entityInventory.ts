/**
 * The closed table of first-party reads behind the nine kinds a raised role opened —
 * workflows and their runs, people, integrations, contracts, devices, teams, access reviews and assessments.
 *
 * ## Why a second table beside `inventory.ts`
 *
 * Every row there is consumed as a flat list of records. Every row here is consumed through a strict
 * per-endpoint boundary (`workflowBoundaries.ts`, `peopleBoundaries.ts`, `estateBoundaries.ts`, `assuranceBoundaries.ts`), which needs
 * each page exactly as the provider answered it — a page's `total` and `resultsTruncated` are what tell a
 * complete read from a short one, and two of these answer a bare list or a map rather than `{items, total}`.
 * So these rows are read through `TrelicaClient.pages`, and a row's id is the kind it fills.
 *
 * ## Every row is still a read, and still carries its own `whyRead`
 *
 * The same property as `inventory.ts`: no caller names a URL, a POST row's body is the row's own (an empty
 * filter lists everything, as the platform's own pages do), and nothing here starts, approves, retries or
 * edits anything. A workflow is READ as configuration and its runs as history; none is ever triggered.
 *
 * MEASURED under the raised role across every kind here. Reproduce each kind's count with
 * `slopweaver atlas trelica read --kind <kind> --json`.
 */
import type { TrelicaCall } from "./inventory.js";

/**
 * Every first-party read the nine 15-Oct kinds are filled from.
 *
 * @internal
 */
export const TRELICA_ENTITY_CALLS = {
  accessReviews: {
    httpMethod: "GET",
    id: "access-reviews",
    paged: false,
    path: "/AppsApi/AccessReviewSchedule/GetMany",
    whyRead:
      "lists the access-review schedules and each one's snapshots — the list the Access page renders, changing nothing",
  },
  assessments: {
    httpMethod: "GET",
    id: "assessments",
    paged: false,
    path: "/SurveysApi/SurveyResponses/GetMany",
    whyRead:
      "lists the vendor and application assessments and how far each has been answered — the list the Assessments page renders",
  },
  contracts: {
    body: {},
    httpMethod: "POST",
    id: "contracts",
    paged: true,
    path: "/AppsApi/Contract/FilterItems",
    whyRead:
      "lists the contracts recorded against applications with an empty filter — the POST carries the filter because the Contracts page lists this way",
  },
  devices: {
    body: {},
    httpMethod: "POST",
    id: "devices",
    paged: true,
    path: "/AppsApi/Assets/Asset/FilterItems",
    whyRead:
      "lists the devices every connected source reported, with an empty filter — the same list the Devices page renders",
  },
  integrations: {
    body: {},
    httpMethod: "POST",
    id: "integrations",
    paged: true,
    path: "/IntegrationsApi/Providers/FilterItems",
    whyRead:
      "lists the integration providers and, under each, the connections this tenant holds with their last sync result — the Integrations page's own list, reconnecting and syncing nothing",
  },
  people: {
    body: {},
    httpMethod: "POST",
    id: "people",
    paged: true,
    path: "/CoreApi/People/FilterItems",
    whyRead:
      "lists every person this tenant knows about and the accounts each holds at every source, with an empty filter — the People page's own list, provisioning and deprovisioning nothing",
  },
  teams: {
    httpMethod: "GET",
    id: "teams",
    paged: false,
    path: "/CoreApi/TeamStructure/FilteredTeamStructure",
    whyRead: "reads the team tree the Teams page renders",
  },
  workflowRuns: {
    body: {},
    httpMethod: "POST",
    id: "workflow-runs",
    paged: true,
    path: "/FlowApi/FlowItem/FilterItems",
    whyRead:
      "lists every run of every workflow — its status, the step it stopped on and the person it ran for — as history; no run is started, retried, resumed or aborted",
  },
  workflowTags: {
    httpMethod: "GET",
    id: "workflow-tags",
    paged: false,
    path: "/FlowApi/CustomerSettings/WorkflowTags",
    whyRead: "reads the workflow tag names, so a workflow's tag is held as the label the Workflows page shows",
  },
  workflows: {
    body: {},
    httpMethod: "POST",
    id: "workflows",
    paged: true,
    path: "/FlowApi/Flow/GetMany",
    whyRead:
      "lists every workflow definition, enabled and archived alike, with its trigger, its steps and its run counts — read as configuration; nothing is published, enabled or triggered",
  },
} as const satisfies Readonly<Record<string, TrelicaCall>>;

/**
 * The id of every entity read.
 *
 * @internal
 */
export type TrelicaEntityCallId = (typeof TRELICA_ENTITY_CALLS)[keyof typeof TRELICA_ENTITY_CALLS]["id"];

/**
 * The shape of an id this atlas will place in a path: the platform's own 24-hex record id. MEASURED 2026
 * on every run and workflow id the run list answered. A value of any other shape is refused rather than
 * escaped, so nothing a response carries can steer a read to a different endpoint.
 */
const TRELICA_RECORD_ID = /^[0-9a-f]{24}$/;

/** The id every per-run detail read carries, whichever run it names — its boundary is bound to it. */
export const TRELICA_RUN_DETAIL_CALL_ID = "workflow-run-detail";

/** The id every per-version workflow read carries, whichever version it names — its boundary is bound to it. */
export const TRELICA_WORKFLOW_VERSION_CALL_ID = "workflow-version";

/**
 * The read for one run's detail — the step-by-step outcome the run list does not carry.
 *
 * @param runId the run's own id, as the run list answered it
 * @returns the row, or `null` for an id that is not the platform's record-id shape
 *
 * @internal
 */
export function trelicaRunDetailCall({ runId }: { runId: string }): TrelicaCall | null {
  if (!TRELICA_RECORD_ID.test(runId)) {
    return null;
  }
  return {
    httpMethod: "GET",
    id: TRELICA_RUN_DETAIL_CALL_ID,
    paged: false,
    path: `/FlowApi/FlowItem/${runId}`,
    whyRead:
      "reads one run's record — each step's status and failure count, as the run's own page shows them; the run is not resumed, retried or aborted",
  };
}

/**
 * The read for one version of one workflow definition, which names the steps a run of that version had.
 *
 * A run's version may be negative: measured, runs of one held workflow carried versions below zero
 * (`jq '.channels["first-party-api"].detail.version' ~/.slopweaver/atlas/trelica/workflow-runs.jsonl
 * | sort -n | uniq -c`). Any whole number is admitted, because no integer can steer the path off this endpoint.
 *
 * @param version the definition version a run ran
 * @returns the row, or `null` for an id that is not the platform's record-id shape or a version that is not whole
 *
 * @internal
 */
export function trelicaWorkflowVersionCall({
  workflowId,
  version,
}: {
  workflowId: string;
  version: number;
}): TrelicaCall | null {
  if (!TRELICA_RECORD_ID.test(workflowId) || !Number.isSafeInteger(version)) {
    return null;
  }
  return {
    httpMethod: "GET",
    id: TRELICA_WORKFLOW_VERSION_CALL_ID,
    paged: false,
    path: `/FlowApi/Flow/${workflowId}/${String(version)}`,
    whyRead:
      "reads one historical version of a workflow definition, as the editor's version history shows it — nothing is published or restored",
  };
}

/**
 * Every entity read, in a stable order.
 *
 * @returns the rows, ordered by id
 *
 * @internal
 */
export function trelicaEntityCalls(): readonly TrelicaCall[] {
  return Object.values(TRELICA_ENTITY_CALLS)
    .map((call: TrelicaCall) => call)
    .toSorted((left, right) => left.id.localeCompare(right.id));
}
