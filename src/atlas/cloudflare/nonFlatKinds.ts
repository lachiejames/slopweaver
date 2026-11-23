/**
 * Every NON-FLAT kind this atlas wires, and the one loop that runs them all.
 *
 * A non-flat kind fans out one child read per parent, so each owns a `<kind>Sync.ts` module beside its own
 * reader and projection imports; {@link nonFlatKindSpecs} is the ONE place a new one gets registered, and
 * {@link runNonFlatKind} needs no change for it. What each of them actually does — and every SDK gap,
 * permanently-`410 Gone` surface and security-critical redaction behind it — is in that module's own header
 * rather than restated here.
 *
 * They differ in what a parent OWNS, and that is the axis worth knowing before reading any of them:
 * `access-policy` is bipartite (a policy can belong to many applications); `gateway-list`,
 * `account-filter-list`, `account-certificate`, `pages-project`, `worker-script`, `ruleset` and
 * `zone-ruleset` each embed a child collection back into the one parent that owns it; and
 * `firewall-service`, `legacy-waf`, `zone-certificate`, `api-gateway` and `zone-analytics` each fold several
 * INDEPENDENT subtype reads into one kind, so one retired or refused subtype never discards the others.
 *
 * Six are DEEP-ZONE-ONLY and close over `zoneId` — the same pattern the deep-zone-only flat kinds use in
 * `flatKindSpecs.ts`. `ruleset` and `zone-ruleset` are the SAME provider surface read at the two scopes
 * Cloudflare declares mutually exclusive; `projection/ruleset.ts` says why that has to be two kinds.
 */
import type Cloudflare from "cloudflare";

import type { RichProgressEmitter } from "../../lib/progressRichEmitter.js";
import { err, ok, type Result } from "../../lib/result.js";

import { syncAccessPolicyKind } from "./accessPolicySync.js";
import { syncAccountCertificateKind } from "./accountCertificateSync.js";
import { syncAccountFilterListKind } from "./accountFilterListSync.js";
import { syncApiGatewayKind } from "./apiGatewaySync.js";
import { syncFirewallServiceKind } from "./firewallServiceSync.js";
import { syncGatewayListKind } from "./gatewayListSync.js";
import { type CloudflareSyncKindOutcome, type KindFoldResult, stampKindAttempt } from "./kindFold.js";
import { syncLegacyWafKind } from "./legacyWafSync.js";
import {
  type CloudflareKind,
  type CloudflareKindFile,
  type CloudflareManifest,
  emptyCloudflareKindFile,
} from "./model.js";
import { syncPagesProjectKind } from "./pagesSync.js";
import { syncRulesetKind, syncZoneRulesetKind } from "./rulesetSync.js";
import { type CloudflareAtlasPaths, readCloudflareKindFile } from "./store.js";
import { syncWorkerScriptKind } from "./workerScriptSync.js";
import { syncZoneAnalyticsKind } from "./zoneAnalyticsSync.js";
import { syncZoneCertificateKind } from "./zoneCertificateSync.js";

/** The kind file the store held, or an empty one stamped `at` when it held none. */
function heldKindFile({
  held,
  kind,
  at,
}: {
  held: CloudflareKindFile | null;
  kind: CloudflareKind;
  at: string;
}): CloudflareKindFile {
  if (held == null) {
    return emptyCloudflareKindFile({ kind, updatedAt: at });
  }
  return held;
}

/**
 * Run one non-flat kind's sync attempt and append it to the shared `files`/`outcomes`/`manifest`
 * accumulators — pulled out of `sync.ts`'s own orchestration for the same reason as `flatKinds.ts`'s loop. Shared
 * by every non-flat kind; only the `sync` callback differs between them.
 *
 * @param at this run's ISO timestamp
 * @param paths the resolved atlas paths
 * @param kind the non-flat kind this call handles
 * @param files the accumulator this kind's file is added to
 * @param outcomes the accumulator this kind's outcome is added to
 * @param manifest the manifest as it stands so far this run
 * @param progress where this run's phases are reported
 * @param sync this kind's own read-reconcile-fold function, given its stored file
 * @returns the manifest with this kind's attempt stamped, or why the read/fold itself failed
 */
async function runNonFlatKind({
  at,
  paths,
  kind,
  files,
  outcomes,
  manifest,
  progress,
  sync,
}: {
  at: string;
  paths: CloudflareAtlasPaths;
  kind: CloudflareKind;
  files: Partial<Record<CloudflareKind, CloudflareKindFile>>;
  outcomes: CloudflareSyncKindOutcome[];
  manifest: CloudflareManifest;
  progress: RichProgressEmitter;
  sync: (args: { stored: CloudflareKindFile }) => Promise<Result<KindFoldResult>>;
}): Promise<Result<CloudflareManifest>> {
  progress.emit({ currentItem: { title: kind }, lane: "heartbeat", phase: "reading" });
  const existingFile = readCloudflareKindFile({ kind, paths });
  if (existingFile.isErr()) {
    return err(existingFile.error);
  }
  const stored = heldKindFile({ at, held: existingFile.value, kind });
  const folded = await sync({ stored });
  if (folded.isErr()) {
    return err(folded.error);
  }
  files[kind] = folded.value.file;
  outcomes.push(folded.value.outcome);
  return ok(stampKindAttempt({ at, manifest, outcome: folded.value.outcome }));
}

/**
 * The shape of the one-kind runner {@link runNonFlatKinds} drives, so a test can stand in for it.
 *
 * @internal
 */
export type RunNonFlatKind = typeof runNonFlatKind;

/** Every non-flat kind this atlas wires, in run order. Add a new fan-out kind here — `runNonFlatKind` needs
 * no change. The six deep-zone-only entries close over `zoneId` — see this file's header — the same pattern
 * the deep-zone-only flat kinds already use. */
function nonFlatKindSpecs({
  client,
  accountId,
  zoneId,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
}): readonly {
  kind: CloudflareKind;
  sync: (args: { at: string; stored: CloudflareKindFile }) => Promise<Result<KindFoldResult>>;
}[] {
  return [
    { kind: "access-policy", sync: ({ at, stored }) => syncAccessPolicyKind({ accountId, at, client, stored }) },
    { kind: "gateway-list", sync: ({ at, stored }) => syncGatewayListKind({ accountId, at, client, stored }) },
    {
      kind: "account-filter-list",
      sync: ({ at, stored }) => syncAccountFilterListKind({ accountId, at, client, stored }),
    },
    { kind: "pages-project", sync: ({ at, stored }) => syncPagesProjectKind({ accountId, at, client, stored }) },
    { kind: "worker-script", sync: ({ at, stored }) => syncWorkerScriptKind({ accountId, at, client, stored }) },
    {
      kind: "account-certificate",
      sync: ({ at, stored }) => syncAccountCertificateKind({ accountId, at, client, stored }),
    },
    {
      kind: "firewall-service",
      sync: ({ at, stored }) => syncFirewallServiceKind({ accountId, at, client, stored, zoneId }),
    },
    { kind: "legacy-waf", sync: ({ at, stored }) => syncLegacyWafKind({ accountId, at, client, stored, zoneId }) },
    {
      kind: "zone-certificate",
      sync: ({ at, stored }) => syncZoneCertificateKind({ accountId, at, client, stored, zoneId }),
    },
    {
      kind: "api-gateway",
      sync: ({ at, stored }) => syncApiGatewayKind({ accountId, at, client, stored, zoneId }),
    },
    {
      kind: "zone-analytics",
      sync: ({ at, stored }) => syncZoneAnalyticsKind({ accountId, at, client, stored, zoneId }),
    },
    { kind: "ruleset", sync: ({ at, stored }) => syncRulesetKind({ accountId, at, client, stored }) },
    {
      kind: "zone-ruleset",
      sync: ({ at, stored }) => syncZoneRulesetKind({ accountId, at, client, stored, zoneId }),
    },
  ];
}

/**
 * Run every non-flat kind's sync attempt in turn, appending each to the shared accumulators.
 *
 * @param at this run's ISO timestamp
 * @param paths the resolved atlas paths
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param files the accumulator every kind's file is added to
 * @param outcomes the accumulator every kind's outcome is added to
 * @param manifest the manifest as it stands so far this run
 * @param progress where this run's phases are reported
 * @param runKind the per-kind runner each registered kind is handed to; the real store-reading one by default
 * @returns the manifest with every non-flat kind's attempt stamped, or why a read/fold itself failed
 */
export async function runNonFlatKinds({
  at,
  paths,
  client,
  accountId,
  zoneId,
  files,
  outcomes,
  manifest,
  progress,
  runKind = runNonFlatKind,
}: {
  at: string;
  paths: CloudflareAtlasPaths;
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  files: Partial<Record<CloudflareKind, CloudflareKindFile>>;
  outcomes: CloudflareSyncKindOutcome[];
  manifest: CloudflareManifest;
  progress: RichProgressEmitter;
  runKind?: RunNonFlatKind;
}): Promise<Result<CloudflareManifest>> {
  let next = manifest;
  for (const spec of nonFlatKindSpecs({ accountId, client, zoneId })) {
    const folded = await runKind({
      at,
      files,
      kind: spec.kind,
      manifest: next,
      outcomes,
      paths,
      progress,
      sync: ({ stored }) => spec.sync({ at, stored }),
    });
    if (folded.isErr()) {
      return err(folded.error);
    }
    next = folded.value;
  }
  return ok(next);
}
