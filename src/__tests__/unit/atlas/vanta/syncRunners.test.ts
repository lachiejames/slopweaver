/*
 * The Vanta sync's runner table, driven through a plain {@link VantaAtlasSyncClient} fake that records every
 * method it is asked for: the exact set of kinds it keys, that building it reads nothing, that the control
 * runner reads both control surfaces and stores each row as Vanta returned it, and that the risk runner
 * opens the permanent identity gap between the browser and Manage API channels.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AtlasArtifactWriter } from "../../../../atlas/kit/artifactWriter.js";
import { stableGapId } from "../../../../atlas/kit/identity.js";
import type { VantaControlDto } from "../../../../atlas/vanta/apiSchemas.js";
import type { VantaAtlasSyncClient } from "../../../../atlas/vanta/client.js";
import type { VantaLibraryControlDto } from "../../../../atlas/vanta/libraryControlApiSchemas.js";
import type { VantaKind } from "../../../../atlas/vanta/model.js";
import type { VantaDocumentDownload } from "../../../../atlas/vanta/policyDocuments.js";
import type { VantaRiskScenarioDto } from "../../../../atlas/vanta/riskApiSchemas.js";
import { readVantaAtlas, vantaAtlasPaths } from "../../../../atlas/vanta/store.js";
import { storedFilesFrom } from "../../../../atlas/vanta/storedFiles.js";
import { VantaSurfaceErrors } from "../../../../atlas/vanta/surfaceErrors.js";
import type { VantaParentIds, VantaParentRead } from "../../../../atlas/vanta/syncChildren.js";
import { kindRunners } from "../../../../atlas/vanta/syncRunners.js";
import { err, ok, unwrap } from "../../../../lib/result.js";

const AT = "2026-10-13T00:00:00.000Z";

const activeControl: VantaControlDto = {
  creationDate: null,
  customFields: [],
  description: "an active control",
  domains: [],
  externalId: null,
  id: "c-active",
  modificationDate: null,
  name: "Active",
  owner: null,
  role: null,
  source: "Custom",
};

const deactivatedControl: VantaLibraryControlDto = {
  creationDate: null,
  customFields: [],
  deactivationReason: "not in scope",
  description: "a deactivated control",
  domains: [],
  externalId: null,
  frameworks: [],
  id: "c-deactivated",
  modificationDate: null,
  name: "Deactivated",
  owner: null,
  source: "Vanta",
};

/** One risk row, its id and type the only fields a case varies. */
const riskRow = ({ riskId, type }: { riskId: string; type: VantaRiskScenarioDto["type"] }): VantaRiskScenarioDto => ({
  categories: [],
  ciaCategories: [],
  customFields: [],
  description: "d",
  detailedDescription: null,
  identificationDate: AT,
  impact: null,
  isArchived: false,
  isSensitive: null,
  likelihood: null,
  note: null,
  owner: null,
  requiredApprovers: [],
  residualImpact: null,
  residualLikelihood: null,
  reviewStatus: "NOT_REVIEWED",
  riskId,
  riskRegister: null,
  treatment: null,
  type,
});

/** A client whose every method records its own name and refuses, except the control and risk reads. */
function recordingClient({ calls }: { calls: string[] }): VantaAtlasSyncClient {
  const refuse =
    ({ name }: { name: string }) =>
    async () => {
      calls.push(name);
      return err(VantaSurfaceErrors.detailUnreadable({ reasons: ["not under test"] }));
    };
  return {
    listCensusFamily: refuse({ name: "listCensusFamily" }),
    listChildSurface: refuse({ name: "listChildSurface" }),
    listControlsActive: async () => {
      calls.push("listControlsActive");
      return ok([activeControl]);
    },
    listControlsDeactivated: async () => {
      calls.push("listControlsDeactivated");
      return ok([deactivatedControl]);
    },
    listEventLog: refuse({ name: "listEventLog" }),
    listEvidenceDocuments: refuse({ name: "listEvidenceDocuments" }),
    listKnowledgeBaseResources: refuse({ name: "listKnowledgeBaseResources" }),
    listPolicies: refuse({ name: "listPolicies" }),
    listRisksEnterpriseRisk: async () => {
      calls.push("listRisksEnterpriseRisk");
      return ok([riskRow({ riskId: "r-enterprise", type: "Enterprise Risk" })]);
    },
    listRisksRiskScenario: async () => {
      calls.push("listRisksRiskScenario");
      return ok([riskRow({ riskId: "r-scenario", type: "Risk Scenario" })]);
    },
    listVendors: refuse({ name: "listVendors" }),
  };
}

const noDownload: VantaDocumentDownload = async () => err(["download not under test"]);
const noArtifact: AtlasArtifactWriter = () => err(["artifact write not under test"]);
const noParents = (): VantaParentIds => new Map<VantaKind, VantaParentRead>();

describe("kindRunners", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-sync-runners-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Every kind of a never-published home, read the way a sync reads it. */
  const unpublished = (): ReturnType<typeof storedFilesFrom> =>
    storedFilesFrom({ at: AT, snapshotFiles: unwrap(readVantaAtlas({ paths: vantaAtlasPaths({ home }) })).files });

  const runnersFor = ({ calls }: { calls: string[] }): ReturnType<typeof kindRunners> =>
    kindRunners({
      at: AT,
      client: recordingClient({ calls }),
      download: noDownload,
      parentIds: noParents,
      storedFiles: unpublished(),
      writeArtifact: noArtifact,
    });

  it("keys one runner per Manage API kind, audit and the browser kinds excluded, and reads nothing to build", () => {
    const calls: string[] = [];
    const runners = runnersFor({ calls });

    expect(calls).toEqual([]);
    expect(Object.keys(runners).toSorted()).toEqual([
      "answer-library-entry",
      "control",
      "control-document-link",
      "customer-trust-account",
      "discovered-vendor",
      "discovered-vendor-account",
      "document-link",
      "document-upload",
      "event-shape",
      "evidence",
      "framework",
      "framework-control-link",
      "group",
      "group-member",
      "importable-idp-group",
      "integration",
      "integration-resource",
      "integration-resource-kind",
      "issue",
      "library-control",
      "monitored-computer",
      "person",
      "policy",
      "policy-document",
      "questionnaire",
      "questionnaire-assignable-user",
      "risk",
      "risk-control-link",
      "test",
      "trust-tag-category",
      "user",
      "vendor",
      "vendor-assessment",
      "vendor-assessment-type",
      "vendor-document",
      "vendor-risk-attribute",
      "vendor-security-review",
      "vulnerability",
      "vulnerability-remediation",
      "vulnerable-asset",
    ]);
  });

  it("reads both control surfaces and stores each row as Vanta returned it", async () => {
    const calls: string[] = [];
    const result = unwrap(await runnersFor({ calls }).control());

    expect(calls).toEqual(["listControlsActive", "listControlsDeactivated"]);
    expect(result.kind).toBe("control");
    expect(result.complete).toBe(true);
    expect(result.observedProviderIds).toEqual(["c-active", "c-deactivated"]);
    expect(result.file.coverage.map((cell) => [cell.surface, cell.state])).toEqual([
      ["controls-active", "synced"],
      ["controls-deactivated", "synced"],
    ]);
    expect(result.file.entities.map((entity) => entity.channels["manage-api"]!.detail)).toEqual([
      activeControl,
      deactivatedControl,
    ]);
    expect(result.file.entities.map((entity) => entity.channels.browser)).toEqual([null, null]);
  });

  it("reads both risk surfaces and opens the permanent identity gap between the two channels", async () => {
    const calls: string[] = [];
    const result = unwrap(await runnersFor({ calls }).risk());

    expect(calls).toEqual(["listRisksRiskScenario", "listRisksEnterpriseRisk"]);
    expect(result.kind).toBe("risk");
    expect(result.complete).toBe(true);
    expect(result.observedProviderIds).toEqual(["r-scenario", "r-enterprise"]);
    expect(result.file.gaps).toEqual([
      {
        channel: null,
        condition: "stable-identity-unverified",
        firstDetectedAt: AT,
        id: stableGapId({ condition: "stable-identity-unverified", scope: "risk-browser-api-identity" }),
        kind: "risk",
        lastCheckedAt: AT,
        lastDetectedAt: AT,
        reason:
          "no proven equivalence between a browser-observed risk's identity and the Manage API's riskId, so the two channels are never reconciled for this kind",
        scope: "risk-browser-api-identity",
        status: "open",
      },
    ]);
  });
});
