import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { VantaResourceKindDto } from "../../../../atlas/vanta/childApiSchemas.js";
import { VANTA_CHILD_FAMILIES } from "../../../../atlas/vanta/childCensus.js";
import type { VantaChildKind } from "../../../../atlas/vanta/childSurface.js";
import type { VantaAtlasSyncClient, VantaChildAnswer } from "../../../../atlas/vanta/client.js";
import { VantaHttpErrors, vantaHttpErrorLines } from "../../../../atlas/vanta/httpErrors.js";
import { emptyVantaKindFile, type VantaKind, type VantaKindFile } from "../../../../atlas/vanta/model.js";
import { readVantaKindFile, vantaAtlasPaths } from "../../../../atlas/vanta/store.js";
import { type VantaSurfaceError, VantaSurfaceErrors } from "../../../../atlas/vanta/surfaceErrors.js";
import { syncVantaAtlas } from "../../../../atlas/vanta/sync.js";
import { type VantaParentIds, type VantaParentRead, vantaChildRunners } from "../../../../atlas/vanta/syncChildren.js";
import { VantaSyncErrors } from "../../../../atlas/vanta/syncErrors.js";
import { logger } from "../../../../lib/logger.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { copyHomeInto } from "../homeTemplate.js";

const AT = "2026-09-10T00:00:00.000Z";

/** What one child-surface request answers, as the sync-facing client answers it. */
type ChildResult = Result<VantaChildAnswer, VantaSurfaceError>;

/** A child request Vanta answered with `status`, graded and rendered exactly as the client does. */
function refusedWith({ safePath, status }: { safePath: string; status: number }): ChildResult {
  const failure = VantaHttpErrors.httpStatus({ safePath, status });
  return err(VantaSurfaceErrors.fromTransportFailure({ failure, reasons: vantaHttpErrorLines({ error: failure }) }));
}

/** One integration row, which is the parent `integration-resource-kind` fans out over. */
const integration = ({ id }: { id: string }) => ({
  connectionCount: 0,
  connections: [],
  displayName: id,
  installationStatus: "INSTALLED" as const,
  integrationId: id,
  resourceKinds: [],
});

/**
 * A client that answers every family emptily, and answers ONE child surface however the caller says.
 *
 * `vi.mock` is banned here, so this is a plain fake passed in — a seam, not a mock. It is the only way to
 * put the fan-out in a state today's tenant does not produce: one where every parent refuses.
 */
function clientAnswering({
  resourceKinds,
  resources = () => ok({ boundedByProvider: false, rows: [] }),
  ids = ["i1", "i2"],
}: {
  resourceKinds: (input: { parentId: string }) => ChildResult;
  resources?: (input: { parentId: string }) => ChildResult;
  ids?: readonly string[];
}): VantaAtlasSyncClient {
  const empty = async (): Promise<Result<readonly never[], VantaSurfaceError>> => ok([]);
  const noRows: VantaChildAnswer = { boundedByProvider: false, rows: [] };
  const answerFor = ({ surface, parentId }: { surface: string; parentId: string }): ChildResult => {
    if (surface === "integration-resource-kinds") {
      return resourceKinds({ parentId });
    }
    return surface === "integration-resources" ? resources({ parentId }) : ok(noRows);
  };
  return {
    listCensusFamily: async ({ surface }) =>
      surface === "integrations-list" ? ok(ids.map((id) => integration({ id }))) : ok([]),
    listChildSurface: async ({ surface, parentId }) => answerFor({ parentId, surface }),
    listControlsActive: empty,
    listControlsDeactivated: empty,
    listEventLog: empty,
    listEvidenceDocuments: empty,
    listKnowledgeBaseResources: empty,
    listPolicies: empty,
    listRisksEnterpriseRisk: empty,
    listRisksRiskScenario: empty,
    listVendors: empty,
  };
}

describe("the ids a fan-out walks", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-child-parents-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("walks only the parents OBSERVED this run, never the stale ones the merged file retains", async () => {
    // Run one: both integrations exist and both answer, so the store holds i1 and i2.
    const first = await syncVantaAtlas({
      at: AT,
      buildClient: () =>
        clientAnswering({ ids: ["i1", "i2"], resourceKinds: () => ok({ boundedByProvider: false, rows: [] }) }),
      credentials: ok({ clientId: "c", clientSecret: "s" }),
      home,
      logger,
    });
    expect(first.isOk()).toBe(true);

    // Run two: Vanta returns only i1. The merged file still HOLDS i2, marked stale — so a fan-out reading
    // the file would ask for it, and would then be judged against two parents rather than the one that
    // exists. Asking for i2 at all is the defect; the walk below refuses if it is asked for.
    const asked: string[] = [];
    const second = await syncVantaAtlas({
      at: "2026-09-11T00:00:00.000Z",
      buildClient: () =>
        clientAnswering({
          ids: ["i1"],
          resourceKinds: ({ parentId }) => {
            asked.push(parentId);
            return ok({ boundedByProvider: false, rows: [] });
          },
        }),
      credentials: ok({ clientId: "c", clientSecret: "s" }),
      home,
      logger,
    });
    expect(second.isOk()).toBe(true);
    expect(asked).toEqual(["i1"]);
  });
});

describe("a declared per-parent ceiling", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-child-ceiling-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("fails the kind when EVERY parent is refused, rather than publishing an empty answer", async () => {
    const report = await syncVantaAtlas({
      at: AT,
      buildClient: () =>
        clientAnswering({
          resourceKinds: () => refusedWith({ safePath: "/v1/integrations/x/resource-kinds", status: 422 }),
        }),
      credentials: ok({ clientId: "c", clientSecret: "s" }),
      home,
      logger,
    });
    expect(unwrapErr(report).lines).toEqual([
      // The resources beneath the resource kinds were never acquired either: their parent never read.
      "the vanta atlas would publish integration-resource, integration-resource-kind while having never acquired them",
      "a file written for a surface that has never been read presents as this organisation's answer, which a reader cannot tell apart from an organisation that holds none",
      "acquire the missing surfaces, or declare them optional with a reason in this atlas's store spec — an exemption is a decision this atlas should be seen to make",
      "nothing was written — this generation is not published",
    ]);
  });

  it("fails the kind on ANY error the client did not classify as a bound, rather than publishing a subset", () => {
    // Which errors ARE a bound is the client's decision now, because only it knows the exact path and query
    // the request went out with — see `client.test.ts`. What this asserts is the other half: an error that
    // reached here unclassified takes the whole kind down.
    return (async () => {
      const report = await syncVantaAtlas({
        at: AT,
        buildClient: () =>
          clientAnswering({
            resourceKinds: ({ parentId }) =>
              parentId === "i2"
                ? refusedWith({ safePath: "/oauth/token", status: 422 })
                : ok({ boundedByProvider: false, rows: [] }),
          }),
        credentials: ok({ clientId: "c", clientSecret: "s" }),
        home,
        logger,
      });
      expect(report.isErr()).toBe(true);
      expect(report._unsafeUnwrapErr().lines.join(" ")).toContain("integration-resource-kind");
    })();
  });

  it("completes the kind when one parent is refused and another answers", async () => {
    const report = await syncVantaAtlas({
      at: AT,
      buildClient: () =>
        clientAnswering({
          resourceKinds: ({ parentId }) =>
            parentId === "i2"
              ? ok({ because: "bounded", boundedByProvider: true })
              : ok({ boundedByProvider: false, rows: [] }),
        }),
      credentials: ok({ clientId: "c", clientSecret: "s" }),
      home,
      logger,
    });
    expect(report.isOk()).toBe(true);
    const kinds = report.isOk() ? report.value.kinds : [];
    expect(kinds.find((kind) => kind.kind === "integration-resource-kind")!.complete).toBe(true);
    const file = readVantaKindFile({ kind: "integration-resource-kind", paths: vantaAtlasPaths({ home }) });
    expect(file.isOk()).toBe(true);
  });
});

describe("integration resources, fanned out over the resource kinds this run read", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-child-resources-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const awsRoleKind = (): ChildResult =>
    ok({
      boundedByProvider: false,
      rows: [
        {
          canUpdateDescription: true,
          canUpdateOwner: true,
          integrationId: "i1",
          isScopable: true,
          resourceKind: "AwsRole",
        },
      ],
    });
  /** A row the document's `Resource` arm accepts. Synthetic values throughout. */
  const declared = {
    connectionId: null,
    creationDate: "2026-01-01T00:00:00.000Z",
    description: null,
    displayName: "example-role",
    inScope: true,
    owner: null,
    resourceId: "res-1",
    resourceKind: "AwsRole",
    responseType: "Resource" as const,
  };
  /** A row no declared arm accepts: `Resource`'s fields plus one the document never names. */
  const undeclared = ({ id }: { id: string }) => ({ ...declared, novelField: "x", resourceId: id });
  const sync = ({ at, resources }: { at: string; resources: () => ChildResult }) =>
    syncVantaAtlas({
      at,
      buildClient: () => clientAnswering({ ids: ["i1"], resourceKinds: awsRoleKind, resources }),
      credentials: ok({ clientId: "c", clientSecret: "s" }),
      home,
      logger,
    });
  const shapeGaps = () =>
    unwrap(readVantaKindFile({ kind: "integration-resource", paths: vantaAtlasPaths({ home }) }))!.gaps.filter(
      (gap) => gap.condition === "schema-drift",
    );
  const shapeScope =
    "integration-resources:undeclared-shape:connectionId,creationDate,description,displayName,inScope,novelField,owner,resourceId,resourceKind,responseType";

  /**
   * The first run both recheck cases start from — one undeclared row read at AT — published ONCE and copied
   * into each case rather than re-published per case (`homeTemplate.ts` says why). Nothing writes into it.
   */
  let undeclaredAtAt: string;
  beforeAll(async () => {
    undeclaredAtAt = mkdtempSync(join(tmpdir(), "vanta-child-resources-seed-"));
    const seeded = await syncVantaAtlas({
      at: AT,
      buildClient: () =>
        clientAnswering({
          ids: ["i1"],
          resourceKinds: awsRoleKind,
          resources: () => ok({ boundedByProvider: false, rows: [undeclared({ id: "res-2" })] }),
        }),
      credentials: ok({ clientId: "c", clientSecret: "s" }),
      home: undeclaredAtAt,
      logger,
    });
    unwrap(seeded);
  });
  afterAll(() => {
    rmSync(undeclaredAtAt, { force: true, recursive: true });
  });

  it("stores every row keyed by integration, kind and resource, and opens ONE gap per undeclared shape", async () => {
    const report = await sync({
      at: AT,
      resources: () =>
        ok({ boundedByProvider: false, rows: [declared, undeclared({ id: "res-2" }), undeclared({ id: "res-3" })] }),
    });
    expect(report.isOk()).toBe(true);
    const file = unwrap(readVantaKindFile({ kind: "integration-resource", paths: vantaAtlasPaths({ home }) }))!;
    expect(file.entities.map((entity) => entity.providerId).toSorted()).toEqual([
      "i1:AwsRole:res-1",
      "i1:AwsRole:res-2",
      "i1:AwsRole:res-3",
    ]);
    expect(shapeGaps().map((gap) => ({ reason: gap.reason, scope: gap.scope, status: gap.status }))).toEqual([
      {
        reason:
          "2 integration-resources row(s) under i1:AwsRole match no arm the published document declares; stored as returned. Their fields: connectionId,creationDate,description,displayName,inScope,novelField,owner,resourceId,resourceKind,responseType",
        scope: shapeScope,
        status: "open",
      },
    ]);
  });

  it("closes that gap on a COMPLETE walk that no longer reads the shape", async () => {
    copyHomeInto({ into: home, template: undeclaredAtAt });
    await sync({ at: "2026-09-11T00:00:00.000Z", resources: () => ok({ boundedByProvider: false, rows: [declared] }) });
    expect(shapeGaps().map((gap) => ({ scope: gap.scope, status: gap.status }))).toEqual([
      { scope: shapeScope, status: "closed" },
    ]);
  });

  it("leaves that gap open when the walk that would have rechecked it FAILED", async () => {
    copyHomeInto({ into: home, template: undeclaredAtAt });
    await sync({
      at: "2026-09-11T00:00:00.000Z",
      resources: () => refusedWith({ safePath: "/v1/integrations", status: 500 }),
    });
    expect(shapeGaps().map((gap) => ({ scope: gap.scope, status: gap.status }))).toEqual([
      { scope: shapeScope, status: "open" },
    ]);
  });
});

describe("vantaChildRunners, called directly", () => {
  /** A stored file per child kind, every one empty, with `resourceKinds` substituted when given. */
  const storeOf = ({ resourceKinds }: { resourceKinds?: VantaKindFile }): Record<VantaChildKind, VantaKindFile> => {
    const empty = ({ kind }: { kind: VantaChildKind }): VantaKindFile => emptyVantaKindFile({ kind, updatedAt: AT });
    const store: Record<VantaChildKind, VantaKindFile> = {
      "control-document-link": empty({ kind: "control-document-link" }),
      "discovered-vendor-account": empty({ kind: "discovered-vendor-account" }),
      "document-link": empty({ kind: "document-link" }),
      "document-upload": empty({ kind: "document-upload" }),
      "framework-control-link": empty({ kind: "framework-control-link" }),
      "group-member": empty({ kind: "group-member" }),
      "integration-resource": empty({ kind: "integration-resource" }),
      "integration-resource-kind": empty({ kind: "integration-resource-kind" }),
      "risk-control-link": empty({ kind: "risk-control-link" }),
      "vendor-assessment": empty({ kind: "vendor-assessment" }),
      "vendor-document": empty({ kind: "vendor-document" }),
      "vendor-security-review": empty({ kind: "vendor-security-review" }),
    };
    if (resourceKinds !== undefined) {
      store["integration-resource-kind"] = resourceKinds;
    }
    return store;
  };
  const TWO_INTEGRATIONS: VantaParentIds = new Map<VantaKind, VantaParentRead>([
    ["integration", { ids: ["i1", "i2"], outcome: "read" }],
  ]);
  const awsRole: VantaResourceKindDto = {
    canUpdateDescription: true,
    canUpdateOwner: true,
    integrationId: "i1",
    isScopable: true,
    resourceKind: "AwsRole",
  };
  const BOUNDED = "Accessing resource kinds not supported for Connectors integrations";

  /** A client that answers the resource-kinds surface per parent and records every child request it gets. */
  const recordingClient = ({
    resourceKinds,
  }: {
    resourceKinds: (input: { parentId: string }) => ChildResult;
  }): { client: VantaAtlasSyncClient; requests: { surface: string; parentId: string }[] } => {
    const requests: { surface: string; parentId: string }[] = [];
    const base = clientAnswering({ resourceKinds });
    const client: VantaAtlasSyncClient = {
      ...base,
      listChildSurface: async (input) => {
        requests.push({ parentId: input.parentId, surface: input.surface });
        return base.listChildSurface(input);
      },
    };
    return { client, requests };
  };

  /** i1 answers one resource kind; i2 is bounded by the provider. */
  const oneBounded = ({ parentId }: { parentId: string }): ChildResult =>
    parentId === "i2"
      ? ok({ because: BOUNDED, boundedByProvider: true })
      : ok({ boundedByProvider: false, rows: [awsRole] });

  it("builds one runner per declared child family", () => {
    const { client } = recordingClient({ resourceKinds: oneBounded });
    const runners = vantaChildRunners({ at: AT, client, parentIds: () => TWO_INTEGRATIONS, storedFiles: storeOf({}) });

    expect(Object.keys(VANTA_CHILD_FAMILIES).length).toBeGreaterThan(0);
    expect(Object.keys(runners).toSorted((left, right) => left.localeCompare(right))).toEqual(
      Object.keys(VANTA_CHILD_FAMILIES).toSorted((left, right) => left.localeCompare(right)),
    );
  });

  it("samples parentIds() when a runner is invoked, not when the map is built", async () => {
    const { client } = recordingClient({ resourceKinds: oneBounded });
    let sampled = 0;
    const parentIds = (): VantaParentIds => {
      sampled += 1;
      return TWO_INTEGRATIONS;
    };

    const runners = vantaChildRunners({ at: AT, client, parentIds, storedFiles: storeOf({}) });
    const builtCount = sampled;
    await runners["integration-resource-kind"]();

    expect([builtCount, sampled]).toEqual([0, 1]);
  });

  it("completes integration-resource-kind over the parent that answered and records the bounded one as a gap", async () => {
    const { client, requests } = recordingClient({ resourceKinds: oneBounded });
    const runners = vantaChildRunners({
      at: AT,
      client,
      parentIds: () => TWO_INTEGRATIONS,
      storedFiles: storeOf({}),
    });

    const result = unwrap(await runners["integration-resource-kind"]());

    expect(requests).toEqual([
      { parentId: "i1", surface: "integration-resource-kinds" },
      { parentId: "i2", surface: "integration-resource-kinds" },
    ]);
    expect({
      complete: result.complete,
      kind: result.kind,
      observedProviderIds: result.observedProviderIds,
      pendingWrites: result.pendingWrites,
      reasons: result.reasons,
      stored: result.file.entities.map((entity) => entity.providerId),
    }).toEqual({
      complete: true,
      kind: "integration-resource-kind",
      observedProviderIds: ["i1:AwsRole"],
      pendingWrites: [],
      reasons: [],
      stored: ["i1:AwsRole"],
    });
    expect(result.file.coverage.map((cell) => ({ reason: cell.reason, surface: cell.surface }))).toEqual([
      {
        reason: "1 record(s) read across 1 of 2 parent(s) — the rest the provider itself bounded",
        surface: "integration-resource-kinds",
      },
    ]);
    expect(
      result.file.gaps.map((gap) => ({
        condition: gap.condition,
        reason: gap.reason,
        scope: gap.scope,
        status: gap.status,
      })),
    ).toEqual([
      {
        condition: "child-surface-unsupported-for-parent",
        reason: `integration i2 cannot serve integration-resource-kinds: ${BOUNDED}`,
        scope: "integration-resource-kinds:i2",
        status: "open",
      },
    ]);
  });

  it("leaves integration-resource-kind incomplete with each parent's refusal when both are bounded, keeping the stored entity", async () => {
    const seeded = unwrap(
      await vantaChildRunners({
        at: AT,
        client: recordingClient({ resourceKinds: oneBounded }).client,
        parentIds: () => TWO_INTEGRATIONS,
        storedFiles: storeOf({}),
      })["integration-resource-kind"](),
    ).file;
    const { client } = recordingClient({ resourceKinds: () => ok({ because: BOUNDED, boundedByProvider: true }) });
    const runners = vantaChildRunners({
      at: "2026-09-11T00:00:00.000Z",
      client,
      parentIds: () => TWO_INTEGRATIONS,
      storedFiles: storeOf({ resourceKinds: seeded }),
    });

    const result = unwrap(await runners["integration-resource-kind"]());

    const expectedReason =
      "every one of the 2 integration(s) refused integration-resource-kinds — a surface no parent can serve is an absent surface, not an empty one;" +
      `   i1: ${BOUNDED};   i2: ${BOUNDED}`;
    expect({ complete: result.complete, reasons: result.reasons }).toEqual({
      complete: false,
      reasons: [expectedReason],
    });
    expect(expectedReason).toBe(
      VantaSyncErrors.childSurfaceAbsent({
        asked: 2,
        parentKind: "integration",
        refused: [
          { parentId: "i1", reason: BOUNDED },
          { parentId: "i2", reason: BOUNDED },
        ],
        surface: "integration-resource-kinds",
      }).message,
    );
    expect(seeded.entities.map((entity) => entity.providerId)).toEqual(["i1:AwsRole"]);
    expect(result.file.entities).toEqual(seeded.entities);
  });
});
