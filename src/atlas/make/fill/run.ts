/**
 * Running a fill — organisations, then their teams, then each team's folders, scenarios, connections and
 * hooks, then each scenario's blueprint and newest executions — through one injected read.
 *
 * The read is a seam rather than an import so the whole walk is testable without a network: production
 * passes `createMakeRead`'s function, a test passes a plain function answering canned bodies.
 *
 * ## All or nothing
 *
 * The first read that fails, or that answers a shape the allowlist refuses, ends the run with that error and
 * nothing is published — the previous generation stays exactly as it was. Make has one token and one set of
 * scopes, so a refusal is almost always the token missing a scope, and a generation that silently lacked
 * every hook would read as "this organisation has no webhooks".
 */
import { err, ok, type Result } from "#lib/result.js";
import { MAKE_PAGE_LIMIT, type MakeRead, type MakeReadRequest } from "../client.js";
import { type MakeAtlasError, MakeAtlasErrors } from "../errors.js";
import { MAKE_ATLAS_KINDS, type MakeAtlasKind } from "../model.js";
import { MAKE_EXECUTION_LIMIT, MAKE_MAX_PAGES } from "./plan.js";
import {
  type MakeProjectedItem,
  projectBlueprintOutline,
  projectExecutions,
  projectFolders,
  projectList,
} from "./project.js";

/** Everything one run brought back — what `sync.ts` publishes from. */
export interface MakeFillObservation {
  readonly filledAtIso: string;
  /** Every kept item, per kind, sorted by provider id. */
  readonly items: Readonly<Record<MakeAtlasKind, readonly MakeProjectedItem[]>>;
  /** Which request kinds were made at least once — the descriptor's `reached`, observed. */
  readonly reached: readonly MakeReadRequest["op"][];
}

/** The walk's working state. */
interface Walk {
  readonly read: MakeRead;
  readonly reached: Set<MakeReadRequest["op"]>;
}

/**
 * Send one read and project its answer.
 *
 * @param walk the run's read and its reached set
 * @param request the read
 * @param project how to cut the answer down, failing on a kept field Make did not send
 * @returns the projection, or the typed reason the read or its projection failed
 */
async function readOne<T>({
  walk,
  request,
  project,
}: {
  walk: Walk;
  request: MakeReadRequest;
  project: (input: { body: unknown }) => Result<T>;
}): Promise<Result<T, MakeAtlasError>> {
  walk.reached.add(request.op);
  const body = await walk.read({ request });
  if (body.isErr()) {
    return err(body.error);
  }
  return project({ body: body.value }).mapErr((reasons) =>
    MakeAtlasErrors.malformedResponse({ operation: request.op, reason: reasons.join("; ") }),
  );
}

/**
 * Follow one paged list until a short page, refusing past {@link MAKE_MAX_PAGES}.
 *
 * @param walk the run's read and its reached set
 * @param requestAt the request for the page starting at an offset
 * @param project how to cut one page down
 * @returns every item, or the typed reason the list could not be read whole
 */
async function readPaged({
  walk,
  requestAt,
  project,
}: {
  walk: Walk;
  requestAt: (input: { offset: number }) => MakeReadRequest;
  project: (input: { body: unknown }) => Result<MakeProjectedItem[]>;
}): Promise<Result<MakeProjectedItem[], MakeAtlasError>> {
  const items: MakeProjectedItem[] = [];
  for (let page = 0; page < MAKE_MAX_PAGES; page += 1) {
    const request = requestAt({ offset: page * MAKE_PAGE_LIMIT });
    const answered = await readOne({ project, request, walk });
    if (answered.isErr()) {
      return err(answered.error);
    }
    items.push(...answered.value);
    if (answered.value.length < MAKE_PAGE_LIMIT) {
      return ok(items);
    }
  }
  const op = requestAt({ offset: 0 }).op;
  return err(
    MakeAtlasErrors.readFailed({
      operation: op,
      reason: `still more after ${String(MAKE_MAX_PAGES)} pages`,
      status: null,
    }),
  );
}

/**
 * The numeric id a projected item was kept under.
 *
 * @param item a kept item
 * @returns its id
 */
function numericId({ item }: { item: MakeProjectedItem }): number {
  return Number(item.providerId);
}

/**
 * Read one scenario's blueprint outline and newest executions.
 *
 * @param walk the run's read and its reached set
 * @param scenario the kept scenario
 * @returns the scenario with its outline, and its executions — or why either read failed
 */
async function readScenario({
  walk,
  scenario,
}: {
  walk: Walk;
  scenario: MakeProjectedItem;
}): Promise<Result<{ scenario: MakeProjectedItem; executions: MakeProjectedItem[] }, MakeAtlasError>> {
  const scenarioId = numericId({ item: scenario });
  const outline = await readOne({
    project: projectBlueprintOutline,
    request: { op: "blueprints.get", scenarioId },
    walk,
  });
  if (outline.isErr()) {
    return err(outline.error);
  }
  const executions = await readOne({
    project: ({ body }) => projectExecutions({ body, scenarioId }),
    request: { limit: MAKE_EXECUTION_LIMIT, op: "executions.list", scenarioId },
    walk,
  });
  if (executions.isErr()) {
    return err(executions.error);
  }
  return ok({
    executions: executions.value.slice(0, MAKE_EXECUTION_LIMIT),
    scenario: { ...scenario, detail: { ...scenario.detail, blueprintOutline: outline.value } },
  });
}

/**
 * Read one team's folders, scenarios (each with its blueprint and executions), connections and hooks.
 *
 * @param walk the run's read and its reached set
 * @param teamId the team
 * @param into the per-kind lists to append to
 * @returns nothing on success, or the first failure
 */
async function readTeam({
  walk,
  teamId,
  into,
}: {
  walk: Walk;
  teamId: number;
  into: Record<MakeAtlasKind, MakeProjectedItem[]>;
}): Promise<Result<void, MakeAtlasError>> {
  const folders = await readOne({
    project: ({ body }) => projectFolders({ body, teamId }),
    request: { op: "folders.list", teamId },
    walk,
  });
  if (folders.isErr()) {
    return err(folders.error);
  }
  into.folder.push(...folders.value);
  const scenarios = await readPaged({
    project: ({ body }) => projectList({ body, extra: {}, what: "scenarios.list" }),
    requestAt: ({ offset }) => ({ offset, op: "scenarios.list", teamId }),
    walk,
  });
  if (scenarios.isErr()) {
    return err(scenarios.error);
  }
  for (const scenario of scenarios.value) {
    const read = await readScenario({ scenario, walk });
    if (read.isErr()) {
      return err(read.error);
    }
    into.scenario.push(read.value.scenario);
    into.execution.push(...read.value.executions);
  }
  const connections = await readOne({
    project: ({ body }) => projectList({ body, extra: {}, what: "connections.list" }),
    request: { op: "connections.list", teamId },
    walk,
  });
  if (connections.isErr()) {
    return err(connections.error);
  }
  into.connection.push(...connections.value);
  const hooks = await readPaged({
    project: ({ body }) => projectList({ body, extra: {}, what: "hooks.list" }),
    requestAt: ({ offset }) => ({ offset, op: "hooks.list", teamId }),
    walk,
  });
  if (hooks.isErr()) {
    return err(hooks.error);
  }
  into.hook.push(...hooks.value);
  return ok(undefined);
}

/**
 * Walk everything the token can see, or stop at the first failure.
 *
 * @param read the injected read — `createMakeRead`'s function in production
 * @param at this run's ISO timestamp
 * @returns the observation, or the typed reason the run stopped
 */
export async function runMakeFill({
  read,
  at,
}: {
  read: MakeRead;
  at: string;
}): Promise<Result<MakeFillObservation, MakeAtlasError>> {
  const walk: Walk = { read, reached: new Set() };
  const into: Record<MakeAtlasKind, MakeProjectedItem[]> = {
    connection: [],
    execution: [],
    folder: [],
    hook: [],
    organization: [],
    scenario: [],
    team: [],
  };
  const organizations = await readPaged({
    project: ({ body }) => projectList({ body, extra: {}, what: "organizations.list" }),
    requestAt: ({ offset }) => ({ offset, op: "organizations.list" }),
    walk,
  });
  if (organizations.isErr()) {
    return err(organizations.error);
  }
  into.organization.push(...organizations.value);
  for (const organization of organizations.value) {
    const organizationId = numericId({ item: organization });
    const teams = await readPaged({
      project: ({ body }) => projectList({ body, extra: {}, what: "teams.list" }),
      requestAt: ({ offset }) => ({ offset, op: "teams.list", organizationId }),
      walk,
    });
    if (teams.isErr()) {
      return err(teams.error);
    }
    into.team.push(...teams.value);
    for (const team of teams.value) {
      const done = await readTeam({ into, teamId: numericId({ item: team }), walk });
      if (done.isErr()) {
        return err(done.error);
      }
    }
  }
  const items = { ...into };
  for (const kind of MAKE_ATLAS_KINDS) {
    items[kind] = into[kind].toSorted((left, right) => left.providerId.localeCompare(right.providerId));
  }
  return ok({ filledAtIso: at, items, reached: [...walk.reached].toSorted() });
}
