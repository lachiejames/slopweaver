/**
 * What this atlas could NOT see, and what would clear it — the gap one failed call raises, the roster gap a
 * workspace this account cannot list raises, and the rechecks that say whether either has since resolved.
 *
 * Split out of {@link ./webData.js} (the file-size ratchet, step 4), which now builds the observation and
 * grades its coverage while stating none of the gaps itself. Same shape `../braze/syncGaps.ts` already has.
 */
import { type AtlasGap, type AtlasGapRecheck, openGap } from "../kit/gaps.js";
import { loaderData } from "./dataRoute.js";
import type { NxCloudAtlasChannel, NxCloudAtlasGap, NxCloudAtlasKind } from "./model.js";
import { projectOrganizationRoster } from "./projection.js";

/**
 * The kit's gap, narrowed to this atlas's own stored vocabulary.
 *
 * The kit types `kind` and `surfaces` as open strings so one lifecycle can serve every platform; the stored
 * schema is closed. Narrowing here, at the one place gaps are built, is what keeps the cast out of the
 * publisher.
 *
 * @param gap the gap as the kit constructed it
 * @param kind the entity kind this gap is about, or `null` for a cross-kind one
 * @param surfaces which of this atlas's channels the gap concerns
 * @returns the gap as this atlas stores it
 */
function storedGap({
  gap,
  kind,
  surfaces,
}: {
  gap: AtlasGap;
  kind: NxCloudAtlasKind | null;
  surfaces: readonly NxCloudAtlasChannel[];
}): NxCloudAtlasGap {
  return { ...gap, fields: [...gap.fields], kind, surfaces: [...surfaces] };
}

import type { NxCloudCallOutcome, NxCloudScope } from "./webData.js";

/**
 * The gap one failed call raises, or `null` when the call was fine.
 *
 * A 401 or 403 is a REFUSAL — a bound on this account's role — and everything else that failed is a
 * `call-failed` a later run could clear. Keeping them apart is the difference between "the platform will
 * never show us this" and "try again".
 *
 * @param outcome the call's outcome
 * @param scope the organisation and workspace being read
 * @param at this run's ISO timestamp
 * @returns the gap, or `null`
 *
 * @internal
 */
export function callGap({
  outcome,
  scope,
  at,
}: {
  outcome: NxCloudCallOutcome;
  scope: NxCloudScope;
  at: string;
}): NxCloudAtlasGap | null {
  const status = outcome.response?.statusCode;
  const gapScope = `${scope.workspaceId}:${outcome.callId}`;
  if (status !== undefined && status >= 400) {
    const refused = status === 401 || status === 403;
    return storedGap({
      gap: openGap({
        at,
        condition: refused ? "call-refused" : "call-failed",
        fields: [],
        kind: "endpoint",
        reason:
          `the ${outcome.callId} call answered HTTP ${String(status)} — this account's Nx Cloud role does` +
          " not reach it, which is a bound on the atlas rather than an absence in the platform",
        scope: gapScope,
        surfaces: ["web-data"],
      }),
      kind: "endpoint",
      surfaces: ["web-data"],
    });
  }
  if (outcome.failure === null) {
    return null;
  }
  return storedGap({
    gap: openGap({
      at,
      condition: "call-failed",
      fields: [],
      kind: "endpoint",
      reason: outcome.failure.message,
      scope: gapScope,
      surfaces: ["web-data"],
    }),
    kind: "endpoint",
    surfaces: ["web-data"],
  });
}

/**
 * The organisations this session's own `/orgs` list named.
 *
 * @param outcomes every call this pass made
 * @returns the organisations listed, empty when the roster call did not answer
 *
 * @internal
 */
export function listedOrganizations({ outcomes }: { outcomes: readonly NxCloudCallOutcome[] }): readonly string[] {
  const roster = outcomes.find((candidate) => candidate.callId === "organizations");
  if (roster === undefined) {
    return [];
  }
  return projectOrganizationRoster({
    data: loaderData({ routeId: "routes/_auth.orgs._index", value: roster.decoded }),
  }).map((organization) => organization.id);
}

/**
 * The finding this file was written around: a reachable workspace whose organisation the roster omits.
 *
 * @param outcomes every call this pass made
 * @param scope the organisation and workspace being read
 * @param at this run's ISO timestamp
 * @returns the gap, or `null` when the roster does name this organisation or the workspace was unreachable
 *
 * @internal
 */
export function rosterGap({
  outcomes,
  scope,
  at,
}: {
  outcomes: readonly NxCloudCallOutcome[];
  scope: NxCloudScope;
  at: string;
}): NxCloudAtlasGap | null {
  const overview = outcomes.find((candidate) => candidate.callId === "workspace-overview");
  const reachable = overview !== undefined && overview.response?.statusCode === 200;
  const listed = listedOrganizations({ outcomes });
  if (!reachable || listed.includes(scope.orgId)) {
    return null;
  }
  return storedGap({
    gap: openGap({
      at,
      condition: "roster-omits-reachable-workspace",
      fields: [],
      kind: "organization",
      reason:
        `the account reads this organisation's workspace and its /orgs roster lists ${String(listed.length)}` +
        " organisation(s), none of them this one — Nx Cloud builds that list from the VCS accounts a" +
        " profile has linked rather than from membership, so an atlas that discovered its scope from the" +
        " roster alone would report a fully reachable workspace as none at all",
      scope: scope.orgId,
      surfaces: ["web-data"],
    }),
    kind: "organization",
    surfaces: ["web-data"],
  });
}

/**
 * Every gap one `web-data` pass raises: a call that was refused, a call that failed, and the roster finding.
 *
 * @param outcomes every call this pass made
 * @param scope the organisation and workspace being read
 * @param at this run's ISO timestamp
 * @returns the gaps, in the order they were found
 */
export function webDataGaps({
  outcomes,
  scope,
  at,
}: {
  outcomes: readonly NxCloudCallOutcome[];
  scope: NxCloudScope;
  at: string;
}): readonly NxCloudAtlasGap[] {
  const calls = outcomes.flatMap((outcome): readonly NxCloudAtlasGap[] => {
    const gap = callGap({ at, outcome, scope });
    return gap === null ? [] : [gap];
  });
  const roster = rosterGap({ at, outcomes, scope });
  return roster === null ? calls : [...calls, roster];
}

/**
 * What this pass genuinely rechecked, so a gap it has now answered closes rather than lingering.
 *
 * A recheck is only honest for a call this pass actually MADE: a run that never reached an endpoint has not
 * established that its refusal is over, and `kit/gaps.ts` closes a gap on nothing else.
 *
 * @param outcomes every call this pass made
 * @param scope the organisation and workspace being read
 * @returns one recheck per condition this pass could speak to
 */
export function webDataRechecks({
  outcomes,
  scope,
}: {
  outcomes: readonly NxCloudCallOutcome[];
  scope: NxCloudScope;
}): readonly AtlasGapRecheck[] {
  const rechecks: AtlasGapRecheck[] = [];
  for (const outcome of outcomes) {
    const status = outcome.response?.statusCode;
    const succeeded = status !== undefined && status >= 200 && status < 300 && outcome.failure === null;
    for (const condition of ["call-refused", "call-failed"] as const) {
      rechecks.push({ condition, resolved: succeeded, scope: `${scope.workspaceId}:${outcome.callId}` });
    }
  }
  const roster = outcomes.find((candidate) => candidate.callId === "organizations");
  if (roster !== undefined && roster.response?.statusCode === 200) {
    rechecks.push({
      condition: "roster-omits-reachable-workspace",
      resolved: listedOrganizations({ outcomes }).includes(scope.orgId),
      scope: scope.orgId,
    });
  }
  return rechecks;
}
