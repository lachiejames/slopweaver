/**
 * The Linear team-membership MUTATION lane: join a team, or leave one, as the token's own user.
 *
 * Its own factory beside `./write.ts` rather than two more methods on `LinearWriteApi`, for the reason
 * `./writeAssets.ts` gives: every existing fake of that interface would otherwise carry two methods it has no
 * use for. It shares the ONE write send context (`makeLinearSendContext`), so these writes ride the same
 * mutation labels, the same never-retry posture and the same per-user rate block as every other Linear write.
 *
 * Neither call is confirmed here. A membership's payload echoes only an id, so the caller confirms by
 * reading the viewer's memberships back (`../../live/linear/teamMembership.ts`).
 */
import { LinearDocument } from "@linear/sdk";

import type { IngestError } from "../../lib/ingestError.js";
import type { RateScheduler } from "../../lib/resilience.js";
import type { ResultAsync } from "../../lib/result.js";
import type { LinearWritePrivacy } from "../../outbound/linear/writePrivacy.js";
import type { LinearRequest } from "./transport.js";
import { makeLinearSendContext, type WrittenObject } from "./write.js";
import { deleteVia, mutateVia } from "./writeGraphql.js";

const CREATE_TEAM_MEMBERSHIP_MUTATION = String(LinearDocument.CreateTeamMembershipDocument);

const DELETE_TEAM_MEMBERSHIP_MUTATION = String(LinearDocument.DeleteTeamMembershipDocument);

/** The two membership writes. Each is one raw call; neither retries. */
export interface LinearTeamMembershipWriteApi {
  join(args: { teamId: string; userId: string }): ResultAsync<WrittenObject, IngestError>;
  leave(args: { membershipId: string }): ResultAsync<boolean, IngestError>;
}

/**
 * The membership write lane, bound to a token.
 *
 * @param token the token the writes are made as
 * @param request the GraphQL transport seam; omit for the production `rawRequest`
 * @param scheduler the shared rate scheduler; omit for the production one
 * @param privacy the outbound privacy policy every mutation is judged under, from the verb's own home
 * @returns the join and leave calls
 */
export function makeLinearTeamMembershipWriteApi({
  token,
  request,
  scheduler,
  privacy,
}: {
  token: string;
  request?: LinearRequest;
  scheduler?: RateScheduler;
  privacy: LinearWritePrivacy;
}): LinearTeamMembershipWriteApi {
  const ctx = makeLinearSendContext({ privacy, request, scheduler, token });
  return {
    join: ({ teamId, userId }) =>
      mutateVia({
        ctx,
        field: "teamMembershipCreate",
        node: "teamMembership",
        operation: "linear.teamMembershipCreate",
        query: CREATE_TEAM_MEMBERSHIP_MUTATION,
        variables: { input: { teamId, userId } },
      }),
    leave: ({ membershipId }) =>
      deleteVia({
        ctx,
        field: "teamMembershipDelete",
        id: membershipId,
        operation: "linear.teamMembershipDelete",
        query: DELETE_TEAM_MEMBERSHIP_MUTATION,
      }),
  };
}
