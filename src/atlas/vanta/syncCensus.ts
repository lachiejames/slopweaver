/**
 * Every Manage API family that reads one surface and stores every attribute unchanged, plus the event-log
 * shape index.
 *
 * They live here rather than in `syncRunners.ts` because they share one runner: `census.ts` declares them as data,
 * so what would otherwise be one near-identical function per family is one. The runner record below is keyed by
 * kind and typed against {@link VantaCensusKind}, so a family added to the table without a runner — or a
 * runner without a family — fails to compile rather than syncing nothing.
 */
import { err, type Result } from "../../lib/result.js";
import { VANTA_CENSUS_FAMILIES, type VantaCensusDto, type VantaCensusFamily, type VantaCensusKind } from "./census.js";
import type { VantaEventLogDto } from "./censusApiSchemas.js";
import { projectVantaCensusRow, projectVantaEventShape } from "./censusProjection.js";
import type { VantaAtlasSyncClient } from "./client.js";
import { indexVantaEventShapes } from "./eventShapes.js";
import { VANTA_EVENT_LOGS_SURFACE } from "./inventory.js";
import type { VantaKindFile } from "./model.js";
import {
  attemptItems,
  attemptSurface,
  findCoverageCell,
  foldKindSync,
  type KindSyncResult,
  syncSingleSurface,
} from "./syncKind.js";

/** Sync one census family: one surface, one strict schema, every attribute stored as Vanta returned it. */
async function syncCensusFamily({
  client,
  family,
  stored,
  at,
}: {
  client: VantaAtlasSyncClient;
  family: VantaCensusFamily;
  stored: VantaKindFile;
  at: string;
}): Promise<Result<KindSyncResult>> {
  return syncSingleSurface<VantaCensusDto>({
    at,
    fetch: () => client.listCensusFamily({ surface: family.surface }),
    kind: family.kind,
    project: ({ dto, at: runAt }) => ({
      entity: projectVantaCensusRow({ at: runAt, dto, family }),
      pendingWrite: null,
    }),
    stored,
    surface: family.surface,
  });
}

/**
 * Sync the event-shape kind: walk the whole event log, index it by shape, and store one entity per event
 * kind. No entry is stored — see `eventShapes.ts` for the ruling this implements.
 */
async function syncEventShapes({
  client,
  stored,
  at,
}: {
  client: VantaAtlasSyncClient;
  stored: VantaKindFile;
  at: string;
}): Promise<Result<KindSyncResult>> {
  const attempted = await attemptSurface<VantaEventLogDto>({
    at,
    fetch: () => client.listEventLog(),
    kind: "event-shape",
    previousCoverage: findCoverageCell({ coverage: stored.coverage, surface: VANTA_EVENT_LOGS_SURFACE }),
    surface: VANTA_EVENT_LOGS_SURFACE,
  });
  if (attempted.isErr()) {
    return err(attempted.error);
  }
  const attempt = attempted.value;
  const shapes = indexVantaEventShapes({ entries: attemptItems({ attempt }) });
  return foldKindSync({
    at,
    attempts: [attempt],
    kind: "event-shape",
    observedEntities: shapes.map((shape) => projectVantaEventShape({ at, shape })),
    stored,
  });
}

/**
 * A runner per census kind, plus the event-shape runner, keyed by kind.
 *
 * @param client the bound sync client
 * @param storedFiles the previous generation's file per kind, merged against on a complete read
 * @param at this run's ISO timestamp
 * @returns one runner per kind this file owns
 */
export function vantaCensusRunners({
  client,
  storedFiles,
  at,
}: {
  client: VantaAtlasSyncClient;
  storedFiles: Readonly<Record<VantaCensusKind | "event-shape", VantaKindFile>>;
  at: string;
}): Record<VantaCensusKind | "event-shape", () => Promise<Result<KindSyncResult>>> {
  const census =
    ({ kind }: { kind: VantaCensusKind }): (() => Promise<Result<KindSyncResult>>) =>
    () =>
      syncCensusFamily({ at, client, family: VANTA_CENSUS_FAMILIES[kind], stored: storedFiles[kind] });
  return {
    "answer-library-entry": census({ kind: "answer-library-entry" }),
    "customer-trust-account": census({ kind: "customer-trust-account" }),
    "discovered-vendor": census({ kind: "discovered-vendor" }),
    "event-shape": () => syncEventShapes({ at, client, stored: storedFiles["event-shape"] }),
    framework: census({ kind: "framework" }),
    group: census({ kind: "group" }),
    "importable-idp-group": census({ kind: "importable-idp-group" }),
    integration: census({ kind: "integration" }),
    issue: census({ kind: "issue" }),
    "library-control": census({ kind: "library-control" }),
    "monitored-computer": census({ kind: "monitored-computer" }),
    person: census({ kind: "person" }),
    questionnaire: census({ kind: "questionnaire" }),
    "questionnaire-assignable-user": census({ kind: "questionnaire-assignable-user" }),
    test: census({ kind: "test" }),
    "trust-tag-category": census({ kind: "trust-tag-category" }),
    user: census({ kind: "user" }),
    "vendor-assessment-type": census({ kind: "vendor-assessment-type" }),
    "vendor-risk-attribute": census({ kind: "vendor-risk-attribute" }),
    vulnerability: census({ kind: "vulnerability" }),
    "vulnerability-remediation": census({ kind: "vulnerability-remediation" }),
    "vulnerable-asset": census({ kind: "vulnerable-asset" }),
  };
}
