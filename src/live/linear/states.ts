/**
 * Read a team's WORKFLOW STATES and its assignable MEMBERS live — the only honest source of the two opaque
 * ids the issue write form accepts.
 *
 * ## Why this verb exists at all
 *
 * `stateId` and `assigneeId` are UUIDs with no derivable form. Before this, nothing in the product emitted
 * either one, so the only place to find a state id was `corpus/history/linear.jsonl` — bronze, captured
 * months ago, and passed through a redaction pass that **carves a UUID up** when its final group holds nine
 * or more consecutive digits (`…-956b-[number]efe`; under 0.1% in the measured store). A mangled id is
 * the dangerous kind of wrong: it still looks like an id, so it reaches the provider and fails there, or —
 * worse — a caller "repairs" it by hand and files a ticket into a state nobody asked for.
 *
 * So the fix is not a better parser over bronze. It is a live read whose output the write door then INSISTS
 * on: `../../outbound/linear/stateCatalog.ts` records what this verb saw, and the issue form refuses a
 * `stateId` that is not in it. A state id that never came through here cannot be written.
 *
 * Members ride along in the same query rather than in a second verb, and that is a cost decision with a
 * number behind it: Linear bills a complexity budget per request (see `../../corpus/linear/transport.ts`),
 * the two connections hang off the same `team` node, and a caller filling an issue form needs both at once.
 */

import { LinearDocument } from "@linear/sdk";

import { ORGANIZATION_QUERY } from "../../corpus/linear/organization.js";
import { sharedLinearTransport } from "../../corpus/linear/transport.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";

/**
 * One workflow state, as Linear defines it for one team.
 *
 * `type` is Linear's own state CATEGORY (`triage`, `backlog`, `unstarted`, `started`, `completed`,
 * `cancelled`) and is carried because it is the only field that means the same thing across teams — a team
 * may call its started state anything, and a caller choosing "the in-progress one" is really choosing a type.
 *
 * @internal — reached through {@link LinearStatesDocument.states}; nothing outside names the shape.
 */
export interface LinearWorkflowState {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly position: number;
}

/** One person who may be assigned an issue on this team. */
interface LinearTeamMember {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly email: string | undefined;
  readonly active: boolean;
}

/** A team's identity, both the human key an operator types and the UUID the write form takes. */
export interface LinearTeamIdentity {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

/**
 * Everything one `linear states` read establishes: the workspace the token reached, the team, its states, and
 * who may be assigned on it.
 */
export interface LinearStatesDocument {
  readonly source: "linear";
  readonly readAtIso: string;
  /**
   * The Linear workspace's URL key, as Linear itself reported it to the token that made this read. The PR gate
   * forgives a recorded team key only when this matches the organisation's configured workspace, so it comes
   * from the provider and never the organisation record: stamped from the record, a foreign workspace's token
   * would label its teams as the installation's own.
   */
  readonly workspace: string;
  readonly team: LinearTeamIdentity;
  readonly states: readonly LinearWorkflowState[];
  readonly members: readonly LinearTeamMember[];
}

/**
 * The team lookup, addressed by team KEY.
 *
 * `teams(filter:)` rather than `team(id:)`: `team` takes the UUID, which is the very thing an operator does
 * not have and cannot look up. The key (`ENG`, `AIL`) is what a Linear URL and every issue identifier
 * already show them, so it is the only address this verb can ask for and expect to be typed correctly. The
 * SDK's `TeamsDocument` declares `$filter: TeamFilter`, so the address survives the move onto it unchanged.
 */
const TEAMS_QUERY = String(LinearDocument.TeamsDocument);

/**
 * The states and the members, each now its own request rather than a connection nested in the team node.
 *
 * That is the SDK's `Team` fragment forcing the shape rather than a preference: it carries no connections at
 * all, so what was one request is three. MEASURED live through this repo's gated transport
 * (probe in `~/.slopweaver/probes/linear-sdk-<date>/`), against the `ENG` team: our nested query cost
 * 1,453 complexity points in one request; the three SDK documents cost 26 + 1,000 + the members page. This
 * is an operator lookup — `slopweaver linear states ENG`, run to copy a state id into a form — not the
 * bot's answer path, so three paced round trips buy the schema contract at a cost nobody waits on.
 *
 * `workflowStates` is filtered by the team's KEY, so it needs nothing the team lookup returns; the members
 * page is addressed by the team's UUID, which that lookup has by then.
 */
const WORKFLOW_STATES_QUERY = String(LinearDocument.WorkflowStatesDocument);

const TEAM_MEMBERS_QUERY = String(LinearDocument.Team_MembersDocument);

/** The injected request seam. Production uses the process-wide safe, paced Linear transport. */
export type LinearStatesRequest = (args: {
  query: string;
  variables: Readonly<Record<string, unknown>>;
}) => Promise<Result<unknown, LinearLiveError>>;

/** The `nodes` array under a nested connection, defensively narrowed. Pure. */
function connectionNodes({
  node,
  field,
}: {
  node: Record<string, unknown>;
  field: string;
}): readonly Record<string, unknown>[] {
  const connection = node[field];
  const nodes = isRecord(connection) ? connection["nodes"] : undefined;
  return Array.isArray(nodes) ? nodes.filter(isRecord) : [];
}

/** One state node, or nothing when it is missing a field the write gate would later need. Pure. */
function stateFrom({ node }: { node: Record<string, unknown> }): readonly LinearWorkflowState[] {
  const id = node["id"];
  const name = node["name"];
  const type = node["type"];
  const position = node["position"];
  return typeof id !== "string" || typeof name !== "string" || typeof type !== "string"
    ? []
    : [{ id, name, position: typeof position === "number" ? position : 0, type }];
}

/** One member node, or nothing when it carries no id or name. Pure. */
function memberFrom({ node }: { node: Record<string, unknown> }): readonly LinearTeamMember[] {
  const id = node["id"];
  const name = node["name"];
  if (typeof id !== "string" || typeof name !== "string") {
    return [];
  }
  const displayName = node["displayName"];
  const email = node["email"];
  return [
    {
      active: node["active"] !== false,
      displayName: typeof displayName === "string" ? displayName : name,
      email: typeof email === "string" && email.length > 0 ? email : undefined,
      id,
      name,
    },
  ];
}

/**
 * The single team node the filter matched, or the named reason there is not exactly one.
 *
 * Two matches is REFUSED rather than resolved first-wins. A team key is unique per workspace, so two nodes
 * means the filter did not mean what the caller thought — and picking one would silently file into the wrong
 * team, which is the class of failure this whole verb exists to close.
 */
function soleTeam({ value, key }: { value: unknown; key: string }): Result<Record<string, unknown>, LinearLiveError> {
  const root = isRecord(value) ? value["teams"] : undefined;
  const nodes = isRecord(root) ? root["nodes"] : undefined;
  const teams = Array.isArray(nodes) ? nodes.filter(isRecord) : [];
  const first = teams[0];
  if (first === undefined) {
    return err(LinearLiveErrors.notFound({ identity: key, kind: "team with that key" }));
  }
  if (teams.length > 1) {
    return err(
      LinearLiveErrors.ambiguousAddress({
        message: `${String(teams.length)} teams match the key ${JSON.stringify(key)}; a key addresses exactly one team, so this read is refused rather than guessed`,
      }),
    );
  }
  return ok(first);
}

/**
 * Resolve one team by its KEY to the identity a write takes, refusing a missing or ambiguous key.
 *
 * Shared by `linear states` and `linear team-membership`, so the two verbs cannot disagree about which team
 * a key names.
 *
 * @param teamKey the team's human key, as it appears in every issue identifier (`ENG` in `ENG-42`)
 * @param request the shared safe GraphQL transport
 * @returns the team's id, key and name, or a named read failure
 */
export async function readLinearTeam({
  teamKey,
  request,
}: {
  teamKey: string;
  request: LinearStatesRequest;
}): Promise<Result<LinearTeamIdentity, LinearLiveError>> {
  const response = await request({
    query: TEAMS_QUERY,
    variables: { filter: { key: { eq: teamKey } }, first: 2, includeArchived: true },
  });
  if (response.isErr()) {
    return err(response.error);
  }
  const team = soleTeam({ key: teamKey, value: response.value });
  if (team.isErr()) {
    return err(team.error);
  }
  const node = team.value;
  const id = node["id"];
  const key = node["key"];
  const name = node["name"];
  if (typeof id !== "string" || typeof key !== "string" || typeof name !== "string") {
    return err(
      LinearLiveErrors.readFailed({ message: `Linear returned a team for ${teamKey} with no id, key or name` }),
    );
  }
  return ok({ id, key, name });
}

/**
 * The URL key of the workspace the token reaches, or a named failure when Linear returned none. Read through the
 * narrow `ORGANIZATION_QUERY`, never the SDK's document, for the reason `../../corpus/linear/organization.ts` gives.
 *
 * @param request the shared safe GraphQL transport
 * @returns the workspace's URL key, or a named read failure
 */
async function readWorkspace({ request }: { request: LinearStatesRequest }): Promise<Result<string, LinearLiveError>> {
  const response = await request({ query: ORGANIZATION_QUERY, variables: {} });
  if (response.isErr()) {
    return err(response.error);
  }
  const organization = isRecord(response.value) ? response.value["organization"] : undefined;
  const urlKey = isRecord(organization) ? organization["urlKey"] : undefined;
  if (typeof urlKey !== "string" || urlKey.length === 0) {
    return err(LinearLiveErrors.readFailed({ message: "Linear returned no workspace URL key for this token" }));
  }
  return ok(urlKey);
}

/**
 * Read one team's workflow states and assignable members, and the workspace they were read from.
 *
 * @param teamKey the team's human key, as it appears in every issue identifier (`ENG` in `ENG-42`)
 * @param limit the maximum states and members requested
 * @param request the shared safe GraphQL transport
 * @param nowIso the freshness clock
 * @returns the workspace, the team's identity, its states and its members, or a named read failure
 */
export async function readLinearStates({
  teamKey,
  limit,
  request,
  nowIso,
}: {
  teamKey: string;
  limit: number;
  request: LinearStatesRequest;
  nowIso: () => string;
}): Promise<Result<LinearStatesDocument, LinearLiveError>> {
  const team = await readLinearTeam({ request, teamKey });
  if (team.isErr()) {
    return err(team.error);
  }
  const { id, key, name } = team.value;
  // The team is established BEFORE either follow-up is sent: an ambiguous or missing key is refused above,
  // so neither of these can be aimed at a team the caller did not mean.
  const states = await request({
    query: WORKFLOW_STATES_QUERY,
    variables: { filter: { team: { key: { eq: teamKey } } }, first: limit },
  });
  if (states.isErr()) {
    return err(states.error);
  }
  const members = await request({ query: TEAM_MEMBERS_QUERY, variables: { first: limit, id } });
  if (members.isErr()) {
    return err(members.error);
  }
  const memberTeam = isRecord(members.value) ? members.value["team"] : undefined;
  const stateSet = completeStates({ teamKey, value: states.value });
  if (stateSet.isErr()) {
    return err(stateSet.error);
  }
  const workspace = await readWorkspace({ request });
  if (workspace.isErr()) {
    return err(workspace.error);
  }
  return ok({
    members: (isRecord(memberTeam) ? connectionNodes({ field: "members", node: memberTeam }) : []).flatMap((member) =>
      memberFrom({ node: member }),
    ),
    readAtIso: nowIso(),
    source: "linear",
    states: stateSet.value.toSorted(
      (left, right) => left.position - right.position || left.name.localeCompare(right.name),
    ),
    team: { id, key, name },
    workspace: workspace.value,
  });
}

/**
 * Every workflow state the page returned, or a refusal when the set is not provably whole: a node missing its
 * id, name or type, or a page Linear says another follows. Dropped, either would hide a state — and a move
 * that maps a state by NAME would then see one `Todo` where the team has two. Pure.
 *
 * @param teamKey the team the states were read for, named in the refusal
 * @param value the raw `workflowStates` response
 * @returns the readable states, or a named read failure
 */
function completeStates({
  teamKey,
  value,
}: {
  teamKey: string;
  value: unknown;
}): Result<readonly LinearWorkflowState[], LinearLiveError> {
  const connection = isRecord(value) ? value["workflowStates"] : undefined;
  const nodes = isRecord(connection) ? connection["nodes"] : undefined;
  if (!Array.isArray(nodes)) {
    return err(LinearLiveErrors.readFailed({ message: `Linear returned no workflow state list for ${teamKey}` }));
  }
  const states = nodes.flatMap((state) => (isRecord(state) ? stateFrom({ node: state }) : []));
  if (states.length !== nodes.length) {
    return err(
      LinearLiveErrors.readFailed({
        message: `Linear returned ${String(nodes.length - states.length)} workflow state(s) for ${teamKey} with no id, name or type`,
      }),
    );
  }
  const pageInfo = isRecord(connection) ? connection["pageInfo"] : undefined;
  const lastPage = isRecord(pageInfo) && pageInfo["hasNextPage"] === false;
  if (!lastPage) {
    return err(
      LinearLiveErrors.readFailed({
        message: `Linear did not say ${teamKey}'s workflow states fit one page; raise the limit rather than read part of the set`,
      }),
    );
  }
  return ok(states);
}

/**
 * Build the production request seam over Linear's process-wide paced transport.
 *
 * @param token the configured Linear API key
 * @returns a result-returning request seam
 */
export function linearStatesRequest({ token }: { token: string }): LinearStatesRequest {
  const transport = sharedLinearTransport({ token });
  return async ({ query, variables }) => {
    try {
      return ok(await transport.request({ query, variables: { ...variables } }));
    } catch (error: unknown) {
      return err(
        LinearLiveErrors.readFailed({
          cause: error,
          message: error instanceof Error ? error.message : "Linear team states read failed",
        }),
      );
    }
  };
}

/**
 * Render a states document as stable, pretty JSON.
 *
 * @param document the states document
 * @returns one JSON document, with a trailing newline supplied by the logger rather than embedded here
 */
export function renderLinearStatesJson({ document }: { document: LinearStatesDocument }): string {
  return JSON.stringify(document, undefined, 2);
}

/**
 * Render a states document as an operator-readable list.
 *
 * The id is printed FIRST on every row, unpadded and unabbreviated, because the whole reason to run this verb
 * is to copy one into a form. A truncated id would reproduce the exact defect this verb exists to fix.
 *
 * @param document the states document
 * @returns text listing every state and assignable member with its id
 */
export function renderLinearStatesText({ document }: { document: LinearStatesDocument }): string {
  return [
    `linear states: ${document.team.key} — ${document.team.name} (${document.team.id})`,
    `read at: ${document.readAtIso}`,
    `states (${String(document.states.length)}):`,
    ...document.states.map((state) => `  ${state.id}  ${state.type.padEnd(9)}  ${state.name}`),
    `members (${String(document.members.length)}):`,
    ...document.members.map(
      (member) => `  ${member.id}  ${member.active ? "active  " : "inactive"}  ${member.displayName}  ${member.name}`,
    ),
  ].join("\n");
}
