/**
 * The census runner record, driven through a plain {@link VantaAtlasSyncClient} fake that records every method
 * it is asked for: the exact set of kinds it keys, which surface each census runner reads, that a census row
 * is stored exactly as Vanta returned it, that the event-shape runner reads only the event log and stores one
 * entity per event kind rather than any event, and that a refused read keeps the stored file and reports why.
 */
import { describe, expect, it } from "vitest";

import type { VantaCensusDto, VantaCensusKind } from "../../../../atlas/vanta/census.js";
import type { VantaEventLogDto, VantaGroupDto } from "../../../../atlas/vanta/censusApiSchemas.js";
import type { VantaAtlasSyncClient } from "../../../../atlas/vanta/client.js";
import { VantaHttpErrors } from "../../../../atlas/vanta/httpErrors.js";
import { vantaEntityId } from "../../../../atlas/vanta/identity.js";
import { emptyVantaKindFile, type VantaKindFile } from "../../../../atlas/vanta/model.js";
import { VantaSurfaceErrors } from "../../../../atlas/vanta/surfaceErrors.js";
import { vantaCensusRunners } from "../../../../atlas/vanta/syncCensus.js";
import { err, ok, unwrap } from "../../../../lib/result.js";

const AT = "2026-10-13T00:00:00.000Z";

/** Every kind file empty, as a first run sees them. */
function emptyStoredFiles(): Readonly<Record<VantaCensusKind | "event-shape", VantaKindFile>> {
  const empty = ({ kind }: { kind: VantaCensusKind | "event-shape" }): VantaKindFile =>
    emptyVantaKindFile({ kind, updatedAt: AT });
  return {
    "answer-library-entry": empty({ kind: "answer-library-entry" }),
    "customer-trust-account": empty({ kind: "customer-trust-account" }),
    "discovered-vendor": empty({ kind: "discovered-vendor" }),
    "event-shape": empty({ kind: "event-shape" }),
    framework: empty({ kind: "framework" }),
    group: empty({ kind: "group" }),
    "importable-idp-group": empty({ kind: "importable-idp-group" }),
    integration: empty({ kind: "integration" }),
    issue: empty({ kind: "issue" }),
    "library-control": empty({ kind: "library-control" }),
    "monitored-computer": empty({ kind: "monitored-computer" }),
    person: empty({ kind: "person" }),
    questionnaire: empty({ kind: "questionnaire" }),
    "questionnaire-assignable-user": empty({ kind: "questionnaire-assignable-user" }),
    test: empty({ kind: "test" }),
    "trust-tag-category": empty({ kind: "trust-tag-category" }),
    user: empty({ kind: "user" }),
    "vendor-assessment-type": empty({ kind: "vendor-assessment-type" }),
    "vendor-risk-attribute": empty({ kind: "vendor-risk-attribute" }),
    vulnerability: empty({ kind: "vulnerability" }),
    "vulnerability-remediation": empty({ kind: "vulnerability-remediation" }),
    "vulnerable-asset": empty({ kind: "vulnerable-asset" }),
  };
}

/**
 * A client whose every method records its own name (and a census surface) and refuses, except the census walk
 * and the event-log walk, which answer what the test hands in.
 */
function recordingClient({
  calls,
  census,
  events,
}: {
  calls: string[];
  census: VantaAtlasSyncClient["listCensusFamily"];
  events: VantaAtlasSyncClient["listEventLog"];
}): VantaAtlasSyncClient {
  const refuse =
    ({ name }: { name: string }) =>
    async () => {
      calls.push(name);
      return err(VantaSurfaceErrors.detailUnreadable({ reasons: ["not under test"] }));
    };
  return {
    listCensusFamily: async (input) => {
      calls.push(`listCensusFamily:${input.surface}`);
      return census(input);
    },
    listChildSurface: refuse({ name: "listChildSurface" }),
    listControlsActive: refuse({ name: "listControlsActive" }),
    listControlsDeactivated: refuse({ name: "listControlsDeactivated" }),
    listEventLog: async () => {
      calls.push("listEventLog");
      return events();
    },
    listEvidenceDocuments: refuse({ name: "listEvidenceDocuments" }),
    listKnowledgeBaseResources: refuse({ name: "listKnowledgeBaseResources" }),
    listPolicies: refuse({ name: "listPolicies" }),
    listRisksEnterpriseRisk: refuse({ name: "listRisksEnterpriseRisk" }),
    listRisksRiskScenario: refuse({ name: "listRisksRiskScenario" }),
    listVendors: refuse({ name: "listVendors" }),
  };
}

const noCensus: VantaAtlasSyncClient["listCensusFamily"] = async () =>
  err(VantaSurfaceErrors.detailUnreadable({ reasons: ["census not under test"] }));
const noEvents: VantaAtlasSyncClient["listEventLog"] = async () =>
  err(VantaSurfaceErrors.detailUnreadable({ reasons: ["event log not under test"] }));

describe("vantaCensusRunners", () => {
  it("keys exactly one runner per census kind plus event-shape, and no other", () => {
    const runners = vantaCensusRunners({
      at: AT,
      client: recordingClient({ calls: [], census: noCensus, events: noEvents }),
      storedFiles: emptyStoredFiles(),
    });

    expect(Object.keys(runners)).toEqual([
      "answer-library-entry",
      "customer-trust-account",
      "discovered-vendor",
      "event-shape",
      "framework",
      "group",
      "importable-idp-group",
      "integration",
      "issue",
      "library-control",
      "monitored-computer",
      "person",
      "questionnaire",
      "questionnaire-assignable-user",
      "test",
      "trust-tag-category",
      "user",
      "vendor-assessment-type",
      "vendor-risk-attribute",
      "vulnerability",
      "vulnerability-remediation",
      "vulnerable-asset",
    ]);
  });

  it("reads nothing until a runner is invoked, then each census runner reads only its own family's surface", async () => {
    const calls: string[] = [];
    const runners = vantaCensusRunners({
      at: AT,
      client: recordingClient({ calls, census: noCensus, events: noEvents }),
      storedFiles: emptyStoredFiles(),
    });
    expect(calls).toEqual([]);

    for (const [kind, run] of Object.entries(runners)) {
      calls.push(`run:${kind}`);
      await run();
    }

    expect(calls).toEqual([
      "run:answer-library-entry",
      "listCensusFamily:answer-library",
      "run:customer-trust-account",
      "listCensusFamily:customer-trust-accounts",
      "run:discovered-vendor",
      "listCensusFamily:discovered-vendors-list",
      "run:event-shape",
      "listEventLog",
      "run:framework",
      "listCensusFamily:frameworks-list",
      "run:group",
      "listCensusFamily:groups-list",
      "run:importable-idp-group",
      "listCensusFamily:importable-idp-groups",
      "run:integration",
      "listCensusFamily:integrations-list",
      "run:issue",
      "listCensusFamily:issues-list",
      "run:library-control",
      "listCensusFamily:controls-library",
      "run:monitored-computer",
      "listCensusFamily:monitored-computers-list",
      "run:person",
      "listCensusFamily:people-list",
      "run:questionnaire",
      "listCensusFamily:customer-trust-questionnaires",
      "run:questionnaire-assignable-user",
      "listCensusFamily:customer-trust-assignable-users",
      "run:test",
      "listCensusFamily:tests-list",
      "run:trust-tag-category",
      "listCensusFamily:customer-trust-tag-categories",
      "run:user",
      "listCensusFamily:users-list",
      "run:vendor-assessment-type",
      "listCensusFamily:vendor-assessment-types-list",
      "run:vendor-risk-attribute",
      "listCensusFamily:vendor-risk-attributes-list",
      "run:vulnerability",
      "listCensusFamily:vulnerabilities-census",
      "run:vulnerability-remediation",
      "listCensusFamily:vulnerability-remediations",
      "run:vulnerable-asset",
      "listCensusFamily:vulnerable-assets-list",
    ]);
  });

  it("stores a census row exactly as Vanta returned it, under the family's endpoint, on a complete read", async () => {
    const calls: string[] = [];
    const row: VantaCensusDto = { displayName: "Ada", email: "ada@example.test", id: "user-1", isActive: true };
    const runners = vantaCensusRunners({
      at: AT,
      client: recordingClient({ calls, census: async () => ok([row]), events: noEvents }),
      storedFiles: emptyStoredFiles(),
    });

    const result = unwrap(await runners.user());

    expect(calls).toEqual(["listCensusFamily:users-list"]);
    expect(result).toEqual({
      complete: true,
      failedConditions: [],
      file: {
        ...emptyVantaKindFile({ kind: "user", updatedAt: AT }),
        coverage: [
          {
            artifacts: [],
            channel: "manage-api",
            lastSuccessAt: AT,
            latestAttemptFailed: false,
            reason: "1 record(s) read",
            role: "authoritative",
            scope: "users-list",
            state: "synced",
            surface: "users-list",
            unblockedBy: null,
            visibilityScope: "manage-api-all-read",
          },
        ],
        entities: [
          {
            channels: {
              browser: null,
              "manage-api": {
                channel: "manage-api",
                detail: { displayName: "Ada", email: "ada@example.test", id: "user-1", isActive: true },
                firstSeenAt: AT,
                lastSeenAt: AT,
                source: {
                  artifacts: [],
                  channel: "manage-api",
                  deepLink: null,
                  deepLinkStatus: "unavailable",
                  endpoint: "/v1/users",
                  observedAt: AT,
                },
                state: "observed",
              },
            },
            financialDetail: null,
            id: vantaEntityId({ components: { providerId: "user-1" }, kind: "user" }),
            kind: "user",
            providerId: "user-1",
            sensitivity: { handleWithCare: true, providerMarkedSensitive: null },
          },
        ],
      },
      kind: "user",
      observedProviderIds: ["user-1"],
      pendingWrites: [],
      reasons: [],
    });
  });

  it("event-shape reads only the event log and stores one entity per event kind, never a raw event", async () => {
    const calls: string[] = [];
    const created: VantaEventLogDto = {
      action: "policy.created",
      actor: { id: "actor-1", type: "USER" },
      date: "2026-10-02",
      id: "event-1",
      targets: [{ id: "policy-1", type: "POLICY" }],
    };
    const createdAgain: VantaEventLogDto = {
      action: "policy.created",
      actor: { id: "actor-2", type: "SYSTEM" },
      date: "2026-10-01",
      id: "event-2",
      targets: [],
    };
    const deleted: VantaEventLogDto = {
      action: "vendor.deleted",
      actor: { id: "actor-1", type: "USER" },
      date: "2026-10-03",
      id: "event-3",
      targets: [{ id: "vendor-1", type: "VENDOR" }],
    };
    const runners = vantaCensusRunners({
      at: AT,
      client: recordingClient({ calls, census: noCensus, events: async () => ok([created, deleted, createdAgain]) }),
      storedFiles: emptyStoredFiles(),
    });

    const result = unwrap(await runners["event-shape"]());

    expect(calls).toEqual(["listEventLog"]);
    expect(result.complete).toBe(true);
    expect(result.kind).toBe("event-shape");
    expect(result.observedProviderIds).toEqual(["policy.created", "vendor.deleted"]);
    expect(result.file.coverage).toEqual([
      {
        artifacts: [],
        channel: "manage-api",
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: "3 record(s) read",
        role: "authoritative",
        scope: "event-logs-walk",
        state: "synced",
        surface: "event-logs-walk",
        unblockedBy: null,
        visibilityScope: "manage-api-all-read",
      },
    ]);
    const createdEntity = result.file.entities.find((entity) => entity.providerId === "policy.created")!;
    expect(result.file.entities.map((entity) => entity.providerId).toSorted()).toEqual([
      "policy.created",
      "vendor.deleted",
    ]);
    expect(createdEntity.id).toBe(vantaEntityId({ components: { providerId: "policy.created" }, kind: "event-shape" }));
    expect(createdEntity.sensitivity).toBe(null);
    expect(createdEntity.channels["manage-api"]!.source!.endpoint).toBe("/v1/event-logs");
    expect(createdEntity.channels["manage-api"]!.detail).toEqual({
      action: "policy.created",
      actorTypes: ["SYSTEM", "USER"],
      attributes: [
        { path: "action", types: ["string"] },
        { path: "actor", types: ["object"] },
        { path: "actor.id", types: ["string"] },
        { path: "actor.type", types: ["string"] },
        { path: "date", types: ["string"] },
        { path: "id", types: ["string"] },
        { path: "targets", types: ["array"] },
        { path: "targets[]", types: ["object"] },
        { path: "targets[].id", types: ["string"] },
        { path: "targets[].type", types: ["string"] },
      ],
      firstSeenDate: "2026-10-01",
      lastSeenDate: "2026-10-02",
      observedCount: 2,
      samples: [created, createdAgain],
      targetTypes: ["POLICY"],
    });
  });

  it("a refused census read keeps the stored entities and last success, marks the run incomplete and reports the refusal", async () => {
    const storedGroup: VantaGroupDto = {
      creationDate: "2026-01-01T00:00:00.000Z",
      description: null,
      id: "group-1",
      name: "Engineering",
      personnelCount: 3,
      pointOfContact: null,
      source: "VANTA",
    };
    const seeded = unwrap(
      await vantaCensusRunners({
        at: "2026-10-12T00:00:00.000Z",
        client: recordingClient({ calls: [], census: async () => ok([storedGroup]), events: noEvents }),
        storedFiles: emptyStoredFiles(),
      }).group(),
    );
    const calls: string[] = [];
    const runners = vantaCensusRunners({
      at: AT,
      client: recordingClient({
        calls,
        census: async () =>
          err(
            VantaSurfaceErrors.fromTransportFailure({
              failure: VantaHttpErrors.httpStatus({ safePath: "/v1/groups", status: 403 }),
              reasons: ["HTTP 403 forbidden"],
            }),
          ),
        events: noEvents,
      }),
      storedFiles: { ...emptyStoredFiles(), group: seeded.file },
    });

    const result = unwrap(await runners.group());

    expect(calls).toEqual(["listCensusFamily:groups-list"]);
    expect(result.complete).toBe(false);
    expect(result.kind).toBe("group");
    expect(result.reasons).toEqual(["HTTP 403 forbidden"]);
    expect(result.failedConditions).toEqual(["api-scope-refused"]);
    expect(result.observedProviderIds).toEqual([]);
    expect(result.pendingWrites).toEqual([]);
    expect(result.file.entities.map((entity) => entity.providerId)).toEqual(["group-1"]);
    expect(result.file.entities).toEqual(seeded.file.entities);
    expect(result.file.coverage).toEqual([
      {
        artifacts: [],
        channel: "manage-api",
        lastSuccessAt: "2026-10-12T00:00:00.000Z",
        latestAttemptFailed: true,
        reason: "HTTP 403 forbidden",
        role: "authoritative",
        scope: "groups-list",
        state: "unreadable",
        surface: "groups-list",
        unblockedBy: null,
        visibilityScope: "manage-api-all-read",
      },
    ]);
    expect(result.file.gaps.map((gap) => [gap.condition, gap.scope, gap.status])).toEqual([
      ["api-scope-refused", "groups-list", "open"],
    ]);
  });
});
