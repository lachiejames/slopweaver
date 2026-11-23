/**
 * Where Slack's own web client lives for this workspace: the id its routes carry, the origin its `/api/` calls
 * land on, and the one structure row both are read from.
 *
 * Split from `surfacePages.ts`, which declares WHICH pages exist; this file answers where the client that
 * renders them actually is, and refuses any id or host that is not Slack's own, because each value here is
 * interpolated into a navigation path or leased to the relay.
 */
import type { StructureBronzeRow } from "../../corpus/structures/types.js";
import { isRecord } from "../../lib/parsers.js";
import type { SlackSurfaceRoots } from "./surfacePages.js";

/**
 * The newest Slack `org` structure row that carries a workspace URL.
 *
 * The NEWEST row wins, matching the structure store's own doctrine that rows accumulate and a measurement
 * describes the last look — `fetchedAtIso` is ISO-8601 and so sorts lexicographically.
 *
 * @param rows the Slack structure rows, as `refresh` wrote them
 * @returns that row, or `undefined` when none carries a URL
 */
export function newestOrgRowWithUrl({ rows }: { rows: readonly StructureBronzeRow[] }): StructureBronzeRow | undefined {
  let newest: StructureBronzeRow | undefined;
  for (const row of rows) {
    if (row.kind !== "org" || row.identity.url === undefined) {
      continue;
    }
    if (newest === undefined || row.fetchedAtIso > newest.fetchedAtIso) {
      newest = row;
    }
  }
  return newest;
}

/**
 * Which workspace id Slack's own client settles on.
 *
 * MEASURED, and it is the difference between a photograph of the message and a photograph of
 * the activity inbox. On an ENTERPRISE GRID the client's route carries the ENTERPRISE id, not the team id:
 * handed `/client/<teamId>/<dm>/p<ts>` a grid workspace redirected to `/client/<enterpriseId>/activity-inbox`
 * and photographed that instead — a successful capture of the wrong thing. {@link SlackSurfaceRoots}'s
 * `clientWorkspaceId` states the rule in prose; this is it as a function.
 *
 * @param teamId the workspace's own team id
 * @param enterpriseId the enterprise org id, when the workspace is on a grid
 * @returns the id to build a client route with
 */
export function slackClientWorkspaceId({
  teamId,
  enterpriseId,
}: {
  teamId: string;
  enterpriseId: string | undefined;
}): string {
  return enterpriseId !== undefined && enterpriseId.length > 0 ? enterpriseId : teamId;
}

/**
 * The origin Slack's own web client sends its `/api/` calls to.
 *
 * MEASURED by listing every response one load of `/later` made: on an ENTERPRISE GRID the client
 * calls `https://<enterprise_domain>.enterprise.slack.com/api/…`, NOT the team origin the org row's `url`
 * carries — so a relay lease naming only the team origin silently dropped `saved.list` and reported nothing.
 * `team.info` returns `enterprise_domain` and the org row keeps that answer in `raw.team`, so it is read from
 * there; a workspace off a grid calls its own origin.
 *
 * @param rows the Slack structure rows, as `refresh` wrote them
 * @returns the API origin, or `null` when no row carries a workspace URL or what it carries is not a Slack host
 */
export function slackClientApiOriginFromStructures({ rows }: { rows: readonly StructureBronzeRow[] }): string | null {
  const newest = newestOrgRowWithUrl({ rows });
  if (newest?.identity.url === undefined) {
    return null;
  }
  const team = isRecord(newest.raw) ? newest.raw["team"] : undefined;
  const enterpriseDomain = isRecord(team) ? team["enterprise_domain"] : undefined;
  if (typeof enterpriseDomain === "string" && enterpriseDomain.length > 0) {
    // It becomes a leased ORIGIN, so anything but a bare subdomain label is refused rather than built into one.
    return /^[a-z0-9-]+$/.test(enterpriseDomain) ? `https://${enterpriseDomain}.enterprise.slack.com` : null;
  }
  // The same holds off a grid: only a Slack workspace origin is ever leased, whatever the row's URL says.
  const workspaceOrigin = newest.identity.url.replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9-]+\.slack\.com$/.test(workspaceOrigin) ? workspaceOrigin : null;
}

/** A Slack team id, the only shape a client or console route may carry for one. */
const SLACK_TEAM_ID = /^T[A-Z0-9]{8,}$/;

/** A Slack enterprise org id. */
const SLACK_ENTERPRISE_ID = /^E[A-Z0-9]{8,}$/;

/**
 * Every root a client route needs, read off ONE structure row — the newest `org` row carrying a URL.
 *
 * One row rather than `workspaceRootsFromStructures` plus a second scan for the enterprise id, so the team,
 * the origin and the client id can never come from two different looks at the workspace.
 *
 * @param rows the Slack structure rows, as `refresh` wrote them
 * @returns the three roots, or `null` when no row carries a workspace URL or either id is not a Slack id
 */
export function slackClientRootsFromStructures({
  rows,
}: {
  rows: readonly StructureBronzeRow[];
}): SlackSurfaceRoots | null {
  const newest = newestOrgRowWithUrl({ rows });
  if (newest?.identity.url === undefined) {
    return null;
  }
  const enterpriseId = newest.attrs["enterpriseId"];
  const enterprise = typeof enterpriseId === "string" && enterpriseId.length > 0 ? enterpriseId : undefined;
  // Both ids are interpolated into a navigation path, so one that is not a Slack id (`../../account/reset?`)
  // would steer the relay to another route on the same leased origin. Refused, never escaped.
  if (
    !SLACK_TEAM_ID.test(newest.identity.nativeId) ||
    (enterprise !== undefined && !SLACK_ENTERPRISE_ID.test(enterprise))
  ) {
    return null;
  }
  return {
    clientWorkspaceId: slackClientWorkspaceId({ enterpriseId: enterprise, teamId: newest.identity.nativeId }),
    teamId: newest.identity.nativeId,
    workspaceOrigin: newest.identity.url.replace(/\/+$/, ""),
  };
}
