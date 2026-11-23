import { describe, expect, it } from "vitest";

import { stableGapId } from "../../../../atlas/kit/identity.js";
import type { LinearApiSurfaceReading } from "../../../../atlas/linear/apiSurface.js";
import type { LinearOperationRecord, LinearTypeRecord } from "../../../../atlas/linear/introspection.js";
import type {
  LinearAtlasEntity,
  LinearAtlasGap,
  LinearAtlasKind,
  LinearCoverageCell,
  LinearSource,
} from "../../../../atlas/linear/model.js";
import { projectApiChannel } from "../../../../atlas/linear/projectApi.js";
import type { LinearSettingRecord } from "../../../../atlas/linear/settings.js";

const AT = "2026-10-12T03:04:05.000Z";
const URL_BASE = "https://linear.app/acme-sentinel";
const REFUSAL = "Only workspace admins may list webhooks (entitlement: admin-sentinel)";
const UNBLOCKED_BY = "a credential whose actor holds the entitlement Linear named in the refusal";

/* Every value below is unique across rows, kinds and sources, so a read of the wrong one shows. */
const OPERATION_LABELS: LinearOperationRecord = {
  detail: {
    deprecationReason: null,
    description: "every issue label the viewer can see",
    isDeprecated: false,
    paramNames: ["after", "first"],
    responsePaths: ["nodes", "nodes.color"],
    returnType: "IssueLabelConnection",
    rootKind: "query",
  },
  providerId: "query.issueLabels",
};

const OPERATION_ARCHIVE: LinearOperationRecord = {
  detail: {
    deprecationReason: "use teamArchive instead",
    description: "archive one team",
    isDeprecated: true,
    paramNames: ["id"],
    responsePaths: ["success", "entity.key"],
    returnType: "TeamArchivePayload",
    rootKind: "mutation",
  },
  providerId: "mutation.archiveTeamLegacy",
};

const TYPE_STATE: LinearTypeRecord = {
  detail: {
    deprecatedFieldNames: ["legacyPosition"],
    description: "one workflow state",
    enumValues: [],
    fieldNames: ["legacyPosition", "position"],
    inputFieldNames: [],
    typeKind: "OBJECT",
  },
  providerId: "WorkflowState",
};

const TYPE_PRIORITY: LinearTypeRecord = {
  detail: {
    deprecatedFieldNames: [],
    description: "issue priority levels",
    enumValues: ["HIGH", "URGENT"],
    fieldNames: [],
    inputFieldNames: [],
    typeKind: "ENUM",
  },
  providerId: "PriorityLevel",
} as const;

/* `detail.group` deliberately differs from its outcome's group: the projection passes `detail` through
   verbatim and must route the deep link and endpoint on the OUTCOME's group. */
const STATE_RECORD: LinearSettingRecord = {
  detail: { group: "detail-group-ws", label: "Ready for review", settingScope: "ENG", value: { position: 3 } },
  providerId: "workflow-state:state-ready",
};

const LABEL_WORKSPACE_RECORD: LinearSettingRecord = {
  detail: { group: "detail-group-il", label: "Bug", settingScope: "workspace", value: { color: "#ff0000" } },
  providerId: "issue-label:label-bug",
};

const LABEL_TEAM_RECORD: LinearSettingRecord = {
  detail: { group: "detail-group-il2", label: "Chore", settingScope: "OPS", value: { color: "#00ff00" } },
  providerId: "issue-label:label-chore",
};

const READING: LinearApiSurfaceReading = {
  introspectionBatches: 7,
  operations: [OPERATION_LABELS, OPERATION_ARCHIVE],
  schemaFingerprint: "types=88",
  settings: [
    { group: "workflow-state", pageBoundReached: false, pagesRead: 3, records: [STATE_RECORD], refusedBecause: null },
    { group: "webhook", pageBoundReached: false, pagesRead: 4, records: [], refusedBecause: REFUSAL },
    {
      group: "issue-label",
      pageBoundReached: true,
      pagesRead: 5,
      records: [LABEL_WORKSPACE_RECORD, LABEL_TEAM_RECORD],
      refusedBecause: null,
    },
  ],
  types: [TYPE_STATE, TYPE_PRIORITY],
  workspaceId: "workspace-sentinel",
};

/**
 * A stored coverage cell, distinct in every field a failed cell could carry forward.
 *
 * @param scope the scope the cell was stored under
 * @param lastSuccessAt when that stored look last succeeded
 * @param sha the digest character of its one artifact
 * @param reason the stored free-form reason, which never has to name its own scope
 * @param relativePath where its one artifact was stored
 * @returns the stored cell
 */
function priorCell({
  scope,
  lastSuccessAt,
  sha,
  reason,
  relativePath,
}: {
  scope: string;
  lastSuccessAt: string;
  sha: string;
  reason: string;
  relativePath: string;
}): LinearCoverageCell {
  return {
    artifacts: [
      {
        byteLength: 41,
        kind: "api-json",
        mediaType: "application/json",
        relativePath,
        sha256: sha.repeat(64),
      },
    ],
    channel: "api",
    lastSuccessAt,
    latestAttemptFailed: false,
    reason,
    role: "authoritative",
    scope,
    state: "synced",
    surface: "graphql-api",
    unblockedBy: null,
    visibilityScope: "one-member-session",
  };
}

/* The decoy's reason and artifact path NAME the refused scope while its own scope does not, and the refused
   scope's cell names it in neither, so only a selector reading `scope` itself finds the right cell. */
const PRIOR_WORKFLOW = priorCell({
  lastSuccessAt: "2026-08-01T00:00:00.000Z",
  reason: "webhook maintenance",
  relativePath: "webhook-adjacent.json",
  scope: "workflow-state",
  sha: "b",
});
const PRIOR_WEBHOOK = priorCell({
  lastSuccessAt: "2026-09-15T11:22:33.000Z",
  reason: "last successful configuration read",
  relativePath: "config-read.json",
  scope: "webhook",
  sha: "c",
});
const PRIOR_OPERATION_WEBHOOK = priorCell({
  lastSuccessAt: "2026-07-07T07:07:07.000Z",
  reason: "operation-side configuration read",
  relativePath: "operation-read.json",
  scope: "webhook",
  sha: "d",
});

/* The decoy sits FIRST, and another kind holds a cell under the refused scope, so neither the first stored
   cell nor the wrong kind's cell can pass for the refused group's own. */
const PREVIOUS: Readonly<Record<LinearAtlasKind, readonly LinearCoverageCell[]>> = {
  operation: [PRIOR_OPERATION_WEBHOOK],
  page: [],
  setting: [PRIOR_WORKFLOW, PRIOR_WEBHOOK],
  type: [],
};

/**
 * The entity one API-channel record must project to.
 *
 * @param kind the entity kind
 * @param providerId the record's provider key
 * @param detail the record's detail, carried verbatim
 * @param source the exact source the record must carry
 * @returns the expected entity
 */
function apiEntity({
  kind,
  providerId,
  detail,
  source,
}: {
  kind: LinearAtlasKind;
  providerId: string;
  detail: unknown;
  source: LinearSource;
}): LinearAtlasEntity {
  return {
    channels: {
      api: { channel: "api", detail, firstSeenAt: AT, lastSeenAt: AT, source, state: "observed" },
      browser: null,
    },
    id: `${kind}:${providerId}`,
    kind,
    providerId,
  };
}

/**
 * The source a schema record must carry.
 *
 * @param endpoint which introspection the record came from
 * @returns the expected source
 */
function schemaSource({ endpoint }: { endpoint: string }): LinearSource {
  return { artifacts: [], channel: "api", deepLink: null, deepLinkStatus: "unavailable", endpoint, observedAt: AT };
}

/**
 * The source a setting record must carry.
 *
 * @param group the outcome's configuration group, which names the endpoint
 * @param deepLink the settings page that shows the record, or `null`
 * @param deepLinkStatus the status that link must carry
 * @returns the expected source
 */
function settingSource({
  group,
  deepLink,
  deepLinkStatus,
}: {
  group: string;
  deepLink: string | null;
  deepLinkStatus: LinearSource["deepLinkStatus"];
}): LinearSource {
  return {
    artifacts: [],
    channel: "api",
    deepLink,
    deepLinkStatus,
    endpoint: `POST /graphql — ${group}`,
    observedAt: AT,
  };
}

/**
 * A fresh-success API cell.
 *
 * @param scope the scope the cell covers
 * @param reason the exact reason the cell must carry
 * @returns the expected cell
 */
function syncedCell({ scope, reason }: { scope: string; reason: string }): LinearCoverageCell {
  return {
    artifacts: [],
    channel: "api",
    lastSuccessAt: AT,
    latestAttemptFailed: false,
    reason,
    role: "authoritative",
    scope,
    state: "synced",
    surface: "graphql-api",
    unblockedBy: null,
    visibilityScope: "one-member-session",
  };
}

/**
 * An open `setting` gap raised on the API surface.
 *
 * @param condition the gap condition
 * @param scope the configuration group it concerns
 * @param reason the exact reason it must carry
 * @returns the expected gap
 */
function settingGap({
  condition,
  scope,
  reason,
}: {
  condition: string;
  scope: string;
  reason: string;
}): LinearAtlasGap {
  return {
    condition,
    fields: [],
    firstDetectedAt: AT,
    id: stableGapId({ condition, scope }),
    kind: "setting",
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason,
    scope,
    status: "open",
    surfaces: ["api"],
  };
}

describe("projectApiChannel — schema half", () => {
  const projection = projectApiChannel({ at: AT, previous: PREVIOUS, reading: READING, workspaceUrlBase: URL_BASE });

  it("projects every operation row from __schema introspection and every type row from __type introspection", () => {
    expect(projection.entities.operation).toEqual([
      apiEntity({
        detail: OPERATION_LABELS.detail,
        kind: "operation",
        providerId: "query.issueLabels",
        source: schemaSource({ endpoint: "POST /graphql — __schema introspection" }),
      }),
      apiEntity({
        detail: OPERATION_ARCHIVE.detail,
        kind: "operation",
        providerId: "mutation.archiveTeamLegacy",
        source: schemaSource({ endpoint: "POST /graphql — __schema introspection" }),
      }),
    ]);
    expect(projection.entities.type).toEqual([
      apiEntity({
        detail: TYPE_STATE.detail,
        kind: "type",
        providerId: "WorkflowState",
        source: schemaSource({ endpoint: "POST /graphql — __type introspection" }),
      }),
      apiEntity({
        detail: TYPE_PRIORITY.detail,
        kind: "type",
        providerId: "PriorityLevel",
        source: schemaSource({ endpoint: "POST /graphql — __type introspection" }),
      }),
    ]);
  });

  it("earns one synced schema cell on each of operation and type, naming the batch count", () => {
    const reason = "the whole GraphQL schema, read in 7 introspection batch(es)";
    expect(projection.coverage.operation).toEqual([syncedCell({ reason, scope: "schema" })]);
    expect(projection.coverage.type).toEqual([syncedCell({ reason, scope: "schema" })]);
  });

  it("leaves the page kind empty and raises no schema gap", () => {
    expect(projection.entities.page).toEqual([]);
    expect(projection.coverage.page).toEqual([]);
    expect(projection.gaps.page).toEqual([]);
    expect(projection.gaps.operation).toEqual([]);
    expect(projection.gaps.type).toEqual([]);
  });
});

describe("projectApiChannel — settings half", () => {
  const projection = projectApiChannel({ at: AT, previous: PREVIOUS, reading: READING, workspaceUrlBase: URL_BASE });

  it("projects every setting record with the page that shows it, routed on the outcome group and record scope", () => {
    expect(projection.entities.setting).toEqual([
      apiEntity({
        detail: STATE_RECORD.detail,
        kind: "setting",
        providerId: "workflow-state:state-ready",
        source: settingSource({
          deepLink: `${URL_BASE}/settings/teams/ENG/workflow`,
          deepLinkStatus: "unverified",
          group: "workflow-state",
        }),
      }),
      apiEntity({
        detail: LABEL_WORKSPACE_RECORD.detail,
        kind: "setting",
        providerId: "issue-label:label-bug",
        source: settingSource({
          deepLink: `${URL_BASE}/settings/labels`,
          deepLinkStatus: "unverified",
          group: "issue-label",
        }),
      }),
      apiEntity({
        detail: LABEL_TEAM_RECORD.detail,
        kind: "setting",
        providerId: "issue-label:label-chore",
        source: settingSource({
          deepLink: `${URL_BASE}/settings/teams/OPS/labels`,
          deepLinkStatus: "unverified",
          group: "issue-label",
        }),
      }),
    ]);
  });

  it("grades a read surface synced, and a refused one unavailable carrying its OWN group's prior success", () => {
    expect(projection.coverage.setting).toEqual([
      syncedCell({ reason: "1 record(s) over 3 page(s)", scope: "workflow-state" }),
      {
        artifacts: PRIOR_WEBHOOK.artifacts,
        channel: "api",
        lastSuccessAt: "2026-09-15T11:22:33.000Z",
        latestAttemptFailed: true,
        reason: `Linear refused this configuration read: ${REFUSAL}`,
        role: "authoritative",
        scope: "webhook",
        state: "unavailable",
        surface: "graphql-api",
        unblockedBy: UNBLOCKED_BY,
        visibilityScope: "one-member-session",
      },
      syncedCell({ reason: "2 record(s) over 5 page(s)", scope: "issue-label" }),
    ]);
  });

  it("raises a refusal gap for the refused group and a paging-bound gap for the bounded one, and no other", () => {
    expect(projection.gaps.setting).toEqual([
      settingGap({
        condition: "settings-surface-refused",
        reason: `the webhook configuration could not be read: ${REFUSAL}`,
        scope: "webhook",
      }),
      settingGap({
        condition: "settings-paging-bound-reached",
        reason: "issue-label was still reporting more pages after the paging bound, so this read is incomplete",
        scope: "issue-label",
      }),
    ]);
  });

  it("starts a refused group with no prior cell from nothing rather than borrowing another's", () => {
    const fresh = projectApiChannel({
      at: AT,
      previous: { operation: [], page: [], setting: [PRIOR_WORKFLOW], type: [] },
      reading: { ...READING, settings: [READING.settings[1]!] },
      workspaceUrlBase: URL_BASE,
    });
    expect(fresh.coverage.setting).toEqual([
      {
        artifacts: [],
        channel: "api",
        lastSuccessAt: null,
        latestAttemptFailed: true,
        reason: `Linear refused this configuration read: ${REFUSAL}`,
        role: "authoritative",
        scope: "webhook",
        state: "unavailable",
        surface: "graphql-api",
        unblockedBy: UNBLOCKED_BY,
        visibilityScope: "one-member-session",
      },
    ]);
  });
});

describe("projectApiChannel — no workspace URL", () => {
  it("leaves every setting's deep link null and unavailable when the workspace is not known", () => {
    const projection = projectApiChannel({ at: AT, previous: PREVIOUS, reading: READING, workspaceUrlBase: null });
    expect(projection.entities.setting).toEqual([
      apiEntity({
        detail: STATE_RECORD.detail,
        kind: "setting",
        providerId: "workflow-state:state-ready",
        source: settingSource({ deepLink: null, deepLinkStatus: "unavailable", group: "workflow-state" }),
      }),
      apiEntity({
        detail: LABEL_WORKSPACE_RECORD.detail,
        kind: "setting",
        providerId: "issue-label:label-bug",
        source: settingSource({ deepLink: null, deepLinkStatus: "unavailable", group: "issue-label" }),
      }),
      apiEntity({
        detail: LABEL_TEAM_RECORD.detail,
        kind: "setting",
        providerId: "issue-label:label-chore",
        source: settingSource({ deepLink: null, deepLinkStatus: "unavailable", group: "issue-label" }),
      }),
    ]);
  });
});
