/**
 * Everything `slopweaver linear move-issues` must read live before it can plan a team move: the named issues, the
 * children of any of them, the token's own user, and the workflow states of the destination and of every team an
 * issue sits in now.
 *
 * Named issues are read by TEAM KEY plus NUMBER — `{ team: { key: { eq } }, number: { in } }`, the filter
 * `./verify.ts` already proves live — one walk per distinct key, so a set of 37 is one request rather than 37, and
 * an identifier that no longer exists simply does not come back rather than failing its siblings. The stated
 * residue of that address: an identifier the issue had BEFORE an earlier move is not matched, so it reads as not
 * returned rather than as already moved.
 *
 * Children are read because Linear has moved a parent's same-team children along with it (per Linear's own
 * changelog): a move of the parent alone could change rows the plan never named.
 */

import { err, ok, type Result } from "../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";
import { type LinearIssueRow, readAllLinearIssues } from "./issues.js";
import { type LinearStatesDocument, type LinearStatesRequest, readLinearStates } from "./states.js";
import { type LinearViewer, readLinearViewer } from "./teamMembership.js";

/** States and members read per team; a team holds far fewer, and `linear states` caps a read at the same. */
const STATES_LIMIT = 250;

/** An issue identifier, split: the `SUP` and the `9285` of `SUP-9285`, bounded like the parser's so `Number` never overflows. */
const IDENTIFIER = /^([A-Z][A-Z0-9]*)-([1-9]\d{0,8})$/u;

/** Everything one move plan is computed from. */
export interface LinearIssueMoveInputs {
  /** The named issues Linear returned; an identifier with no row here was not found. */
  readonly issues: readonly LinearIssueRow[];
  /** Every issue whose parent is one of {@link issues}. */
  readonly children: readonly LinearIssueRow[];
  readonly viewer: LinearViewer;
  readonly destination: LinearStatesDocument;
  /** The states of every team a returned issue sits in now. */
  readonly sources: readonly LinearStatesDocument[];
}

/**
 * The named identifiers grouped by team key, each key's numbers in caller order. Pure.
 *
 * @param identifiers validated issue identifiers
 * @returns one entry per distinct key, or the identifier that is not one
 */
export function identifierNumbersByKey({
  identifiers,
}: {
  identifiers: readonly string[];
}): Result<ReadonlyMap<string, readonly number[]>, LinearLiveError> {
  const grouped = new Map<string, number[]>();
  for (const identifier of identifiers) {
    const match = IDENTIFIER.exec(identifier);
    if (match === null) {
      return err(LinearLiveErrors.invalidAddress({ message: `${identifier} is not an issue identifier like SUP-42` }));
    }
    const [, key, digits] = match;
    const numbers = grouped.get(key!);
    if (numbers === undefined) {
      grouped.set(key!, [Number(digits)]);
      continue;
    }
    numbers.push(Number(digits));
  }
  return ok(grouped);
}

/**
 * Read the named issues live, one complete walk per team key.
 *
 * @param identifiers validated issue identifiers
 * @param request the shared safe GraphQL transport
 * @returns every named issue Linear returned, or a named read failure
 */
export async function readLinearIssuesByIdentifiers({
  identifiers,
  request,
}: {
  identifiers: readonly string[];
  request: LinearStatesRequest;
}): Promise<Result<readonly LinearIssueRow[], LinearLiveError>> {
  const grouped = identifierNumbersByKey({ identifiers });
  if (grouped.isErr()) {
    return err(grouped.error);
  }
  const rows: LinearIssueRow[] = [];
  for (const [key, numbers] of grouped.value) {
    const read = await readAllLinearIssues({
      filter: { number: { in: numbers }, team: { key: { eq: key } } },
      request,
    });
    if (read.isErr()) {
      return err(read.error);
    }
    rows.push(...read.value);
  }
  return ok(rows);
}

/**
 * Read every issue whose parent is one of the named ones.
 *
 * @param parentIds the parents' issue UUIDs
 * @param request the shared safe GraphQL transport
 * @returns every child, or a named read failure; no request at all for an empty set
 */
export async function readLinearIssueChildren({
  parentIds,
  request,
}: {
  parentIds: readonly string[];
  request: LinearStatesRequest;
}): Promise<Result<readonly LinearIssueRow[], LinearLiveError>> {
  if (parentIds.length === 0) {
    return ok([]);
  }
  return readAllLinearIssues({ filter: { parent: { id: { in: parentIds } } }, request });
}

/** Every distinct team key the returned issues sit in, in first-seen order. Pure. */
function sourceTeamKeys({ issues }: { issues: readonly LinearIssueRow[] }): readonly string[] {
  return [...new Set(issues.map((issue) => issue.teamKey))];
}

/** Read the states of each team key in turn, refusing on the first that fails. */
async function readTeamStates({
  keys,
  request,
  nowIso,
}: {
  keys: readonly string[];
  request: LinearStatesRequest;
  nowIso: () => string;
}): Promise<Result<readonly LinearStatesDocument[], LinearLiveError>> {
  const documents: LinearStatesDocument[] = [];
  for (const teamKey of keys) {
    const read = await readLinearStates({ limit: STATES_LIMIT, nowIso, request, teamKey });
    if (read.isErr()) {
      return err(read.error);
    }
    documents.push(read.value);
  }
  return ok(documents);
}

/**
 * Read everything one move plan needs: the issues, their children, the viewer, and the destination's and every
 * source team's states.
 *
 * @param identifiers validated issue identifiers
 * @param destinationTeamKey the key of the team the issues move into
 * @param request the shared safe GraphQL transport
 * @param nowIso the freshness clock
 * @returns the plan's inputs, or the first named read failure
 */
export async function readLinearIssueMoveInputs({
  identifiers,
  destinationTeamKey,
  request,
  nowIso,
}: {
  identifiers: readonly string[];
  destinationTeamKey: string;
  request: LinearStatesRequest;
  nowIso: () => string;
}): Promise<Result<LinearIssueMoveInputs, LinearLiveError>> {
  const destination = await readLinearStates({ limit: STATES_LIMIT, nowIso, request, teamKey: destinationTeamKey });
  if (destination.isErr()) {
    return err(destination.error);
  }
  if (destination.value.team.key !== destinationTeamKey) {
    return err(
      LinearLiveErrors.readFailed({
        message: `Linear answered a lookup for team ${destinationTeamKey} with team ${destination.value.team.key}; refusing to move anything into a team that was not asked for`,
      }),
    );
  }
  const issues = await readLinearIssuesByIdentifiers({ identifiers, request });
  if (issues.isErr()) {
    return err(issues.error);
  }
  const children = await readLinearIssueChildren({ parentIds: issues.value.map((issue) => issue.id), request });
  if (children.isErr()) {
    return err(children.error);
  }
  const viewer = await readLinearViewer({ request });
  if (viewer.isErr()) {
    return err(viewer.error);
  }
  const sources = await readTeamStates({ keys: sourceTeamKeys({ issues: issues.value }), nowIso, request });
  if (sources.isErr()) {
    return err(sources.error);
  }
  return ok({
    children: children.value,
    destination: destination.value,
    issues: issues.value,
    sources: sources.value,
    viewer: viewer.value,
  });
}
