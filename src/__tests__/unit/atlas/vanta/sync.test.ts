import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../admit/operationLock.js";
import type {
  VantaControlDto,
  VantaDocumentDto,
  VantaPolicyDto,
  VantaVendorDto,
} from "../../../../atlas/vanta/apiSchemas.js";
import { readUnreadVantaChanges, vantaChangeFilePath } from "../../../../atlas/vanta/changesStore.js";
import type { VantaAtlasSyncClient } from "../../../../atlas/vanta/client.js";
import { type VantaRiskScenarioDto } from "../../../../atlas/vanta/riskApiSchemas.js";
import { readVantaAtlas, vantaAtlasPaths } from "../../../../atlas/vanta/store.js";
import { VantaSurfaceErrors } from "../../../../atlas/vanta/surfaceErrors.js";
import { syncVantaAtlas } from "../../../../atlas/vanta/sync.js";
import { logger } from "../../../../lib/logger.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { copyHomeInto } from "../homeTemplate.js";

const AT = "2026-01-01T00:00:00.000Z";

/** A surface read that failed with no more specific explanation. */
const boom = VantaSurfaceErrors.detailUnreadable({ reasons: ["boom"] });

const control: VantaControlDto = {
  creationDate: null,
  customFields: [],
  description: "d",
  domains: [],
  externalId: null,
  id: "c1",
  modificationDate: null,
  name: "n",
  owner: null,
  role: null,
  source: "Custom",
};
const risk: VantaRiskScenarioDto = {
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
  riskId: "r1",
  riskRegister: null,
  treatment: null,
  type: "Risk Scenario",
};
const policy: VantaPolicyDto = {
  approvedAtDate: null,
  description: "d",
  id: "p1",
  latestApprovedVersion: null,
  latestVersion: { status: "APPROVED" },
  name: "n",
  status: "OK",
};
const document: VantaDocumentDto = {
  category: "IT",
  description: "d",
  id: "e1",
  isSensitive: false,
  ownerId: null,
  title: "n",
  uploadStatus: "OK",
  uploadStatusDate: null,
  url: null,
};
const vendor: VantaVendorDto = {
  accountManagerEmail: null,
  accountManagerName: null,
  additionalNotes: null,
  authDetails: {
    method: null,
    passwordMFA: null,
    passwordMinimumLength: null,
    passwordRequiresNumber: null,
    passwordRequiresSymbol: null,
  },
  businessOwnerUserId: null,
  category: null,
  contractAmount: null,
  contractRenewalDate: null,
  contractStartDate: null,
  contractTerminationDate: null,
  customFields: null,
  id: "v1",
  inherentRiskLevel: "LOW",
  isRiskAutoScored: null,
  isVisibleToAuditors: null,
  lastSecurityReviewCompletionDate: null,
  latestDecision: null,
  linkedTaskTrackerTaskProcurementRequest: null,
  name: "n",
  nextSecurityReviewDueDate: null,
  residualRiskLevel: "LOW",
  riskAttributeIds: [],
  securityOwnerUserId: null,
  servicesProvided: null,
  status: "MANAGED",
  vendorHeadquarters: null,
  websiteUrl: null,
};

function fullySucceedingClient(): VantaAtlasSyncClient {
  return {
    listCensusFamily: async () => ok([]),
    listChildSurface: async () => ok({ boundedByProvider: false as const, rows: [] }),
    listControlsActive: async () => ok([control]),
    listControlsDeactivated: async () => ok([]),
    listEventLog: async () => ok([]),
    listEvidenceDocuments: async () => ok([document]),
    listKnowledgeBaseResources: async () => ok([]),
    listPolicies: async () => ok([policy]),
    listRisksEnterpriseRisk: async () => ok([]),
    listRisksRiskScenario: async () => ok([risk]),
    listVendors: async () => ok([vendor]),
  };
}

/**
 * A home holding one fully-succeeding sync at AT, published ONCE and copied into each case that starts from
 * exactly that seed rather than re-published per case (`homeTemplate.ts` says why). Nothing writes into it.
 */
let seededAtAt: string;

beforeAll(async () => {
  seededAtAt = mkdtempSync(join(tmpdir(), "vanta-sync-seed-"));
  unwrap(
    await syncVantaAtlas({
      at: AT,
      buildClient: () => fullySucceedingClient(),
      credentials: ok({ clientId: "c", clientSecret: "s" }),
      home: seededAtAt,
      logger,
    }),
  );
});

afterAll(() => {
  rmSync(seededAtAt, { force: true, recursive: true });
});

describe("syncVantaAtlas", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-sync-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reports credentialsConfigured:false without calling the client builder", async () => {
    let built = false;
    const report = unwrap(
      await syncVantaAtlas({
        at: AT,
        buildClient: () => {
          built = true;
          return fullySucceedingClient();
        },
        credentials: err(["not configured"]),
        home,
        logger,
      }),
    );
    expect(report.credentialsConfigured).toBe(false);
    expect(built).toBe(false);
    expect(report.kinds.every((kind) => !kind.complete)).toBe(true);
  });

  it("syncs every kind completely when every surface succeeds", async () => {
    const report = unwrap(
      await syncVantaAtlas({
        at: AT,
        buildClient: () => fullySucceedingClient(),
        credentials: ok({ clientId: "c", clientSecret: "s" }),
        home,
        logger,
      }),
    );
    expect(report.credentialsConfigured).toBe(true);
    expect(report.kinds.every((kind) => kind.complete)).toBe(true);
    const controlOutcome = report.kinds.find((kind) => kind.kind === "control");
    expect(controlOutcome!.entityCount).toBe(1);
  });

  it("refuses the FIRST generation outright when a surface it has never read fails", async () => {
    // The kit's `mandatoryKinds` gate: publishing an empty `control` file on a home that has never read one
    // would present "this organisation has no controls" as an answer. The publish
    // fails closed rather than exiting non-zero after the fact.
    const client: VantaAtlasSyncClient = { ...fullySucceedingClient(), listControlsActive: async () => err(boom) };
    const refused = await syncVantaAtlas({
      at: AT,
      buildClient: () => client,
      credentials: ok({ clientId: "c", clientSecret: "s" }),
      home,
      logger,
    });

    expect(refused.isErr()).toBe(true);
    // `control-document-link` fans out over `control`, so a control read that failed takes its child kind
    // with it — the refusal names both, which is the propagation working rather than a second defect.
    expect(refused._unsafeUnwrapErr().lines[0]).toContain(
      "would publish control, control-document-link while having never acquired them",
    );
  });

  it("leaves a kind incomplete, without losing the other kinds, when one surface fails", async () => {
    // Seeded with a good generation first: the gate above governs a surface never read, and this test is
    // about the DIFFERENT question of a later failure not costing the kinds that did succeed.
    copyHomeInto({ into: home, template: seededAtAt });
    const client: VantaAtlasSyncClient = { ...fullySucceedingClient(), listControlsActive: async () => err(boom) };
    const report = unwrap(
      await syncVantaAtlas({
        at: "2026-01-03T00:00:00.000Z",
        buildClient: () => client,
        credentials: ok({ clientId: "c", clientSecret: "s" }),
        home,
        logger,
      }),
    );
    const controlOutcome = report.kinds.find((kind) => kind.kind === "control")!;
    const vendorOutcome = report.kinds.find((kind) => kind.kind === "vendor")!;
    expect(controlOutcome.complete).toBe(false);
    expect(vendorOutcome.complete).toBe(true);
  });

  it("merges into a previously-published generation rather than starting over", async () => {
    copyHomeInto({ into: home, template: seededAtAt });
    const later = "2026-01-02T00:00:00.000Z";
    const secondClient: VantaAtlasSyncClient = {
      ...fullySucceedingClient(),
      listControlsActive: async () => ok([control, { ...control, id: "c2" }]),
    };
    await syncVantaAtlas({
      at: later,
      buildClient: () => secondClient,
      credentials: ok({ clientId: "c", clientSecret: "s" }),
      home,
      logger,
    });

    const paths = vantaAtlasPaths({ home });
    const snapshot = unwrap(readVantaAtlas({ paths }));
    expect(snapshot.files.control!.entities).toHaveLength(2);
  });

  it("writes a vendor's contract amount to a companion file, never into the committed entity", async () => {
    const client: VantaAtlasSyncClient = {
      ...fullySucceedingClient(),
      listVendors: async () => ok([{ ...vendor, contractAmount: { amount: 1000, currency: "USD" } }]),
    };
    await syncVantaAtlas({
      at: AT,
      buildClient: () => client,
      credentials: ok({ clientId: "c", clientSecret: "s" }),
      home,
      logger,
    });

    const paths = vantaAtlasPaths({ home });
    const snapshot = unwrap(readVantaAtlas({ paths }));
    const vendorEntity = snapshot.files.vendor!.entities[0]!;
    expect(vendorEntity.financialDetail).not.toBeNull();
    const detail = vendorEntity.channels["manage-api"]!.detail as Record<string, unknown>;
    expect(detail["contractAmount"]).toBeUndefined();
  });
});

describe("syncVantaAtlas records what each sync changed", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-changes-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const credentials = ok({ clientId: "c", clientSecret: "s" });
  const LATER = "2026-01-02T00:00:00.000Z";

  it("records a first sync as a baseline for every kind, comparing nothing", async () => {
    const report = unwrap(
      await syncVantaAtlas({ at: AT, buildClient: () => fullySucceedingClient(), credentials, home, logger }),
    );
    expect(report.changes).toEqual({
      at: AT,
      outcome: "recorded",
      path: vantaChangeFilePath({ at: AT, home }),
      totals: { added: 0, baseline: report.kinds.length, changed: 0, incomplete: 0, removed: 0 },
    });
  });

  it("records an added, a removed and a changed entity on the next sync", async () => {
    copyHomeInto({ into: home, template: seededAtAt });
    const client: VantaAtlasSyncClient = {
      ...fullySucceedingClient(),
      listControlsActive: async () => ok([control, { ...control, id: "c2", name: "second" }]),
      listPolicies: async () => ok([{ ...policy, status: "NEEDS_REMEDIATION" as const }]),
      listVendors: async () => ok([]),
    };
    const report = unwrap(await syncVantaAtlas({ at: LATER, buildClient: () => client, credentials, home, logger }));
    expect(report.changes.outcome).toBe("recorded");

    const unread = unwrap(readUnreadVantaChanges({ home }));
    expect(unread.records.map((record) => record.at)).toEqual([AT, LATER]);
    const kinds = unread.records[1]!.kinds;
    const controlChange = kinds.find((entry) => entry.kind === "control")!;
    const policyChange = kinds.find((entry) => entry.kind === "policy")!;
    const vendorChange = kinds.find((entry) => entry.kind === "vendor")!;
    expect(controlChange).toMatchObject({
      added: [{ name: "second", providerId: "c2", returned: false }],
      counts: { added: 1, changed: 0, removed: 0, returned: 0, unchanged: 1 },
      read: "complete",
      since: AT,
    });
    expect(policyChange).toMatchObject({
      changedGroups: [
        {
          count: 1,
          examples: [{ fields: [{ after: '"NEEDS_REMEDIATION"', before: '"OK"', field: "status" }], providerId: "p1" }],
          fields: ["status"],
        },
      ],
      counts: { added: 0, changed: 1, removed: 0, returned: 0, unchanged: 0 },
    });
    expect(vendorChange).toMatchObject({
      counts: { added: 0, changed: 0, removed: 1, returned: 0, unchanged: 0 },
      removed: [{ name: "n", providerId: "v1" }],
    });
  });

  it("records nothing when credentials are absent", async () => {
    const report = unwrap(
      await syncVantaAtlas({
        at: AT,
        buildClient: () => fullySucceedingClient(),
        credentials: err(["no"]),
        home,
        logger,
      }),
    );
    expect(report.changes).toEqual({
      outcome: "not-recorded",
      reason: "credentials are not configured, so this sync read no kind",
    });
  });

  it("still publishes, and reports the loss, when the change record cannot be written", async () => {
    // A FILE where the change directory belongs, so creating the directory fails.
    mkdirSync(join(home, "vanta"), { recursive: true });
    writeFileSync(join(home, "vanta", "changes"), "not a directory");
    const report = unwrap(
      await syncVantaAtlas({ at: AT, buildClient: () => fullySucceedingClient(), credentials, home, logger }),
    );
    expect(report.changes.outcome).toBe("failed");
    expect(report.kinds.every((kind) => kind.complete)).toBe(true);
    const snapshot = unwrap(readVantaAtlas({ paths: vantaAtlasPaths({ home }) }));
    expect(snapshot.files.control!.entities).toHaveLength(1);
  });

  it("leaves no change record behind when the publish is refused", async () => {
    // The record is written BEFORE the publish; a refused first generation must take it back out.
    const client: VantaAtlasSyncClient = { ...fullySucceedingClient(), listControlsActive: async () => err(boom) };
    const refused = await syncVantaAtlas({ at: AT, buildClient: () => client, credentials, home, logger });
    expect(refused._unsafeUnwrapErr().code).toBe("SYNC_REFUSED");
    expect(refused._unsafeUnwrapErr().lines[0]).toContain("while having never acquired them");
    expect(existsSync(vantaChangeFilePath({ at: AT, home }))).toBe(false);
    expect(unwrap(readUnreadVantaChanges({ home })).records).toEqual([]);
  });

  it("answers SYNC_CONTENDED, building no client, while a live holder has the sync lock", async () => {
    // A scheduled `resync-atlas-vanta` slot met exactly this and exited 1, which held the recipe.
    const holder = unwrap(acquireOperationLock({ home, key: "vanta-atlas-sync", nowIso: AT }));
    let built = false;
    try {
      const refused = await syncVantaAtlas({
        at: AT,
        buildClient: () => {
          built = true;
          return fullySucceedingClient();
        },
        credentials,
        home,
        logger,
      });
      const error = unwrapErr(refused);
      expect(error.code).toBe("SYNC_CONTENDED");
      expect(error.lines).toEqual([
        `could not acquire the Vanta atlas sync lock: held by pid ${String(process.pid)} since ${AT} (0ms old, under the 900000ms stale threshold, and the holder answered signal 0 — it was ALIVE when checked at ${AT}, so this is contention rather than a lock left behind by a dead process)`,
      ]);
      expect(built).toBe(false);
    } finally {
      holder.release();
    }
  });

  it("answers SYNC_REFUSED, building no client, while the sync lock's record cannot be read", async () => {
    // Nothing says an unreadable record ends, so this must stay a failure rather than a deferral.
    expect(acquireOperationLock({ home, key: "vanta-atlas-sync", nowIso: AT }).isOk()).toBe(true);
    const lockDirs = join(home, "ledgers", "operation-locks");
    const lockDir = join(
      lockDirs,
      readdirSync(lockDirs).find((name) => name.endsWith(".lock"))!,
    );
    writeFileSync(join(lockDir, readdirSync(lockDir)[0]!), "{ not json");
    let built = false;
    const refused = await syncVantaAtlas({
      at: AT,
      buildClient: () => {
        built = true;
        return fullySucceedingClient();
      },
      credentials,
      home,
      logger,
    });
    const error = unwrapErr(refused);
    expect(error.code).toBe("SYNC_REFUSED");
    expect(error.lines[0]).toContain("could not acquire the Vanta atlas sync lock");
    expect(built).toBe(false);
  });
});
