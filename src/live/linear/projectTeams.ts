/**
 * A project's teams, which the SDK's `ProjectDocument` does not select and `linear project update` must send
 * back whole: the form's `teamIds` REPLACES the set, so an update written without them read live would drop a
 * team. MEASURED: one project held SOPS and SUP issues, and no verb could say which
 * teams the project itself was on. Always read for a project — one extra round trip on a rare read.
 */

import { LinearDocument } from "@linear/sdk";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";
import type { LinearStatesRequest } from "./states.js";

const PROJECT_TEAMS_QUERY = String(LinearDocument.Project_TeamsDocument);

/**
 * Teams requested for a project: Linear's own page maximum, NOT the caller's `--limit`, which bounds activity.
 * A teams list cut short is exactly the list an update would then drop a team from, so it is never shortened.
 */
const PROJECT_TEAMS_PAGE = 250;

/**
 * Read one project's `teams` connection, keyed as `teams` so it sits on the payload beside the project's own
 * fields. Any other object kind carries no teams and reads as an empty spread without a request. A connection
 * that says it has another page is REFUSED rather than shown short.
 *
 * @param kind the object kind the read address resolved to; only a project is read
 * @param id the object's id
 * @param request the shared safe GraphQL transport
 * @returns `{ teams }` for a project, `{}` for any other kind, or the read failure
 */
export async function readProjectTeams({
  kind,
  id,
  request,
}: {
  kind: string;
  id: string;
  request: LinearStatesRequest;
}): Promise<Result<Record<string, unknown>, LinearLiveError>> {
  if (kind !== "project") {
    return ok({});
  }
  // An archived team stays on the project, and Linear leaves it out of the connection unless asked for it.
  const response = await request({
    query: PROJECT_TEAMS_QUERY,
    variables: { first: PROJECT_TEAMS_PAGE, id, includeArchived: true },
  });
  if (response.isErr()) {
    return err(response.error);
  }
  const project = isRecord(response.value) ? response.value["project"] : undefined;
  const teams = isRecord(project) ? project["teams"] : undefined;
  if (!isRecord(teams)) {
    return err(LinearLiveErrors.readFailed({ message: `Linear returned no teams for project ${id}` }));
  }
  const pageInfo = teams["pageInfo"];
  if (!isRecord(pageInfo) || pageInfo["hasNextPage"] !== false) {
    return err(
      LinearLiveErrors.readFailed({
        message: `Linear did not return every team of project ${id} in one page; refused rather than shown short`,
      }),
    );
  }
  return ok({ teams });
}
