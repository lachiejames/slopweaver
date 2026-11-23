/**
 * Read where the token's own user stands on one team — the state `linear team-membership` previews, and the
 * read-back that confirms a join or a leave.
 *
 * The viewer is whoever the configured token belongs to, and nobody else: the verb never addresses another
 * person's membership, so there is no user argument to get wrong. A membership is confirmed by reading the
 * viewer's memberships again rather than by trusting the mutation's payload, which echoes only an id.
 */
import { LinearDocument } from "@linear/sdk";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";
import { type LinearStatesRequest, type LinearTeamIdentity, readLinearTeam } from "./states.js";

const VIEWER_QUERY = String(LinearDocument.ViewerDocument);

const VIEWER_MEMBERSHIPS_QUERY = String(LinearDocument.Viewer_TeamMembershipsDocument);

/**
 * One page of the viewer's memberships. A page that says it has more is REFUSED rather than read as
 * complete, because "not a member" is only provable over the whole list.
 */
const MEMBERSHIP_PAGE = 250;

/** The user the token belongs to. */
export interface LinearViewer {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

/** Where the viewer stands on one team. */
export interface LinearMembershipState {
  readonly team: LinearTeamIdentity;
  readonly viewer: LinearViewer;
  /** The viewer's membership on this team, or undefined when the viewer is not a member. */
  readonly membershipId: string | undefined;
}

/**
 * Shape the viewer out of a `ViewerDocument` response.
 *
 * @param value the GraphQL data
 * @returns the viewer, or the reason the response cannot name one
 */
export function viewerFrom({ value }: { value: unknown }): Result<LinearViewer, LinearLiveError> {
  const viewer = isRecord(value) ? value["viewer"] : undefined;
  const id = isRecord(viewer) ? viewer["id"] : undefined;
  const name = isRecord(viewer) ? viewer["name"] : undefined;
  const url = isRecord(viewer) ? viewer["url"] : undefined;
  if (typeof id !== "string" || typeof name !== "string" || typeof url !== "string") {
    return err(LinearLiveErrors.readFailed({ message: "Linear returned no viewer id, name or URL for this token" }));
  }
  return ok({ id, name, url });
}

/**
 * The viewer's membership on one team, out of a `Viewer_TeamMembershipsDocument` response.
 *
 * @param value the GraphQL data
 * @param teamId the team whose membership is wanted
 * @returns the membership id, undefined when there is none, or the reason the page cannot prove either
 */
export function membershipIdFrom({
  value,
  teamId,
}: {
  value: unknown;
  teamId: string;
}): Result<string | undefined, LinearLiveError> {
  const viewer = isRecord(value) ? value["viewer"] : undefined;
  const connection = isRecord(viewer) ? viewer["teamMemberships"] : undefined;
  const nodes = isRecord(connection) ? connection["nodes"] : undefined;
  const pageInfo = isRecord(connection) ? connection["pageInfo"] : undefined;
  if (!Array.isArray(nodes) || !isRecord(pageInfo)) {
    return err(LinearLiveErrors.readFailed({ message: "Linear returned no team memberships for this token" }));
  }
  if (pageInfo["hasNextPage"] !== false) {
    return err(
      LinearLiveErrors.readFailed({
        message: `the viewer has more than ${String(MEMBERSHIP_PAGE)} team memberships, so absence from one page proves nothing`,
      }),
    );
  }
  const matching = nodes.filter(isRecord).filter((node) => {
    const team = node["team"];
    return isRecord(team) && team["id"] === teamId;
  });
  if (matching.length > 1) {
    return err(
      LinearLiveErrors.ambiguousAddress({
        message: `${String(matching.length)} memberships name team ${teamId}; a user holds one per team, so this read is refused rather than guessed`,
      }),
    );
  }
  const id = matching[0]?.["id"];
  return ok(typeof id === "string" ? id : undefined);
}

/**
 * The viewer's membership on one team, read live.
 *
 * @param request the shared safe GraphQL transport
 * @param teamId the team whose membership is wanted
 * @returns the membership id, undefined when there is none, or a named read failure
 */
export async function readViewerMembershipId({
  request,
  teamId,
}: {
  request: LinearStatesRequest;
  teamId: string;
}): Promise<Result<string | undefined, LinearLiveError>> {
  const response = await request({ query: VIEWER_MEMBERSHIPS_QUERY, variables: { first: MEMBERSHIP_PAGE } });
  return response.andThen((value) => membershipIdFrom({ teamId, value }));
}

/**
 * Read the token's own user — whoever the configured key belongs to.
 *
 * @param request the shared safe GraphQL transport
 * @returns the viewer, or a named read failure
 */
export async function readLinearViewer({
  request,
}: {
  request: LinearStatesRequest;
}): Promise<Result<LinearViewer, LinearLiveError>> {
  const response = await request({ query: VIEWER_QUERY, variables: {} });
  return response.andThen((value) => viewerFrom({ value }));
}

/**
 * Read the team by key, the viewer, and the viewer's membership on that team.
 *
 * @param teamKey the team's key, as it appears in an issue identifier
 * @param request the shared safe GraphQL transport
 * @returns where the viewer stands on the team, or a named read failure
 */
export async function readLinearMembershipState({
  teamKey,
  request,
}: {
  teamKey: string;
  request: LinearStatesRequest;
}): Promise<Result<LinearMembershipState, LinearLiveError>> {
  const team = await readLinearTeam({ request, teamKey });
  if (team.isErr()) {
    return err(team.error);
  }
  const viewer = await readLinearViewer({ request });
  if (viewer.isErr()) {
    return err(viewer.error);
  }
  const membershipId = await readViewerMembershipId({ request, teamId: team.value.id });
  if (membershipId.isErr()) {
    return err(membershipId.error);
  }
  return ok({ membershipId: membershipId.value, team: team.value, viewer: viewer.value });
}
