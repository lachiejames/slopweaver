/**
 * The runner table a Vanta atlas sync walks: one deferred runner per Manage API kind. The two kinds that
 * read two surfaces each (`control`, `risk`) are written out here; every other kind is a census or fan-out
 * runner, or one `syncSingleSurface` call. `sync.ts` keeps the lock, the trusted read, the walk order and
 * the publish.
 */
import { err, ok, type Result } from "#lib/result.js";
import { pdfAttachmentFrom } from "../../pdf/attachment.js";
import type { AtlasArtifactWriter } from "../kit/artifactWriter.js";
import type { VantaControlDto, VantaDocumentDto, VantaPolicyDto, VantaVendorDto } from "./apiSchemas.js";
import type { VantaAtlasSyncClient } from "./client.js";
import { openVantaGap, reconcileVantaGaps } from "./gaps.js";
import type { VantaLibraryControlDto } from "./libraryControlApiSchemas.js";
import type { VantaApiKind, VantaKind, VantaKindFile } from "./model.js";
import { syncVantaPolicyDocuments, type VantaDocumentDownload } from "./policyDocuments.js";
import {
  projectVantaControl,
  projectVantaEvidence,
  projectVantaPolicy,
  projectVantaRisk,
  projectVantaVendor,
} from "./projection.js";
import { type VantaRiskScenarioDto } from "./riskApiSchemas.js";
import { vantaCensusRunners } from "./syncCensus.js";
import { type VantaParentIds, vantaChildRunners } from "./syncChildren.js";
import { attemptItems, attemptSurfaces, foldKindSync, type KindSyncResult, syncSingleSurface } from "./syncKind.js";

/** Sync the two-surface control kind. */
async function syncControls({
  client,
  stored,
  at,
}: {
  client: VantaAtlasSyncClient;
  stored: VantaKindFile;
  at: string;
}): Promise<Result<KindSyncResult>> {
  const attempts = await attemptSurfaces<VantaControlDto | VantaLibraryControlDto>({
    at,
    coverage: stored.coverage,
    kind: "control",
    surfaces: [
      { fetch: () => client.listControlsActive(), surface: "controls-active" },
      { fetch: () => client.listControlsDeactivated(), surface: "controls-deactivated" },
    ],
  });
  if (attempts.isErr()) {
    return err(attempts.error);
  }
  const observed = attempts.value
    .flatMap((attempt) => attemptItems({ attempt }))
    .map((dto) => projectVantaControl({ at, dto }).entity);
  return foldKindSync({ at, attempts: attempts.value, kind: "control", observedEntities: observed, stored });
}

/** Sync the two-surface risk kind. Also opens the permanent unresolved-identity gap for this kind. */
async function syncRisks({
  client,
  stored,
  at,
}: {
  client: VantaAtlasSyncClient;
  stored: VantaKindFile;
  at: string;
}): Promise<Result<KindSyncResult>> {
  const attempts = await attemptSurfaces<VantaRiskScenarioDto>({
    at,
    coverage: stored.coverage,
    kind: "risk",
    surfaces: [
      { fetch: () => client.listRisksRiskScenario(), surface: "risks-risk-scenario" },
      { fetch: () => client.listRisksEnterpriseRisk(), surface: "risks-enterprise-risk" },
    ],
  });
  if (attempts.isErr()) {
    return err(attempts.error);
  }
  const observed = attempts.value
    .flatMap((attempt) => attemptItems({ attempt }))
    .map((dto) => projectVantaRisk({ at, dto }).entity);
  const folded = foldKindSync({
    at,
    attempts: attempts.value,
    kind: "risk",
    observedEntities: observed,
    stored,
  });
  if (folded.isErr()) {
    return folded;
  }
  const identityGap = openVantaGap({
    at,
    channel: null,
    condition: "stable-identity-unverified",
    kind: "risk",
    reason:
      "no proven equivalence between a browser-observed risk's identity and the Manage API's riskId, so the two channels are never reconciled for this kind",
    scope: "risk-browser-api-identity",
  });
  const gaps = reconcileVantaGaps({
    at,
    observed: [identityGap],
    rechecks: [],
    runFailed: false,
    stored: folded.value.file.gaps,
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({ ...folded.value, file: { ...folded.value.file, gaps: [...gaps.value] } });
}

/**
 * The runner for every API-synced kind, keyed by kind — one table so `syncAllKinds` is a loop and nothing else.
 *
 * @returns one deferred runner per Manage API kind, none of which reads anything until it is called
 */
export function kindRunners({
  client,
  storedFiles,
  at,
  download,
  parentIds,
  writeArtifact,
}: {
  client: VantaAtlasSyncClient;
  storedFiles: Readonly<Record<VantaKind, VantaKindFile>>;
  at: string;
  download: VantaDocumentDownload;
  /** Read at CALL time, never at build time — a fan-out's parents are the kinds this run just walked. */
  parentIds: () => VantaParentIds;
  writeArtifact: AtlasArtifactWriter;
}): Record<VantaApiKind, () => Promise<Result<KindSyncResult>>> {
  return {
    ...vantaCensusRunners({ at, client, storedFiles }),
    ...vantaChildRunners({ at, client, parentIds, storedFiles }),
    control: () => syncControls({ at, client, stored: storedFiles.control }),
    evidence: () =>
      syncSingleSurface<VantaDocumentDto>({
        at,
        fetch: () => client.listEvidenceDocuments(),
        kind: "evidence",
        project: projectVantaEvidence,
        stored: storedFiles.evidence,
        surface: "evidence-documents",
      }),
    policy: () =>
      syncSingleSurface<VantaPolicyDto>({
        at,
        fetch: () => client.listPolicies(),
        kind: "policy",
        project: projectVantaPolicy,
        stored: storedFiles.policy,
        surface: "policies-list",
      }),
    "policy-document": () =>
      syncVantaPolicyDocuments({
        at,
        download,
        extract: pdfAttachmentFrom,
        list: () => client.listKnowledgeBaseResources(),
        stored: storedFiles["policy-document"],
        writeArtifact,
      }),
    risk: () => syncRisks({ at, client, stored: storedFiles.risk }),
    vendor: () =>
      syncSingleSurface<VantaVendorDto>({
        at,
        fetch: () => client.listVendors(),
        kind: "vendor",
        project: projectVantaVendor,
        stored: storedFiles.vendor,
        surface: "vendors-list",
      }),
  };
}
