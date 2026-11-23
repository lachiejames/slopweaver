/**
 * `runNonFlatKinds` — the loop over every registered non-flat kind — driven through its per-kind runner seam,
 * so no store is read and no provider is called.
 */
import Cloudflare from "cloudflare";
import { describe, expect, it } from "vitest";

import type { CloudflareSyncKindOutcome } from "../../../../atlas/cloudflare/kindFold.js";
import {
  type CloudflareKind,
  type CloudflareKindFile,
  initialCloudflareManifest,
} from "../../../../atlas/cloudflare/model.js";
import { type RunNonFlatKind, runNonFlatKinds } from "../../../../atlas/cloudflare/nonFlatKinds.js";
import { cloudflareAtlasPaths } from "../../../../atlas/cloudflare/store.js";
import type { RichProgressEmitter } from "../../../../lib/progressRichEmitter.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-13T00:00:00.000Z";

/** Every non-flat kind, in the run order the module registers them. */
const EXPECTED_ORDER: readonly CloudflareKind[] = [
  "access-policy",
  "gateway-list",
  "account-filter-list",
  "pages-project",
  "worker-script",
  "account-certificate",
  "firewall-service",
  "legacy-waf",
  "zone-certificate",
  "api-gateway",
  "zone-analytics",
  "ruleset",
  "zone-ruleset",
];

/** A progress emitter that drops every event. */
const SILENT: RichProgressEmitter = {
  close: () => undefined,
  emit: () => undefined,
  finish: () => undefined,
  noteStall: () => undefined,
};

/** One call the fake runner saw: the kind, and the manifest instant it was handed. */
interface SeenCall {
  readonly kind: CloudflareKind;
  readonly handedUpdatedAt: string;
}

/**
 * A runner that records each call and returns the manifest re-stamped with the kind's own name, failing at
 * `failAt` when given.
 */
function recordingRunner({ seen, failAt }: { seen: SeenCall[]; failAt?: CloudflareKind }): RunNonFlatKind {
  const runKind: RunNonFlatKind = async ({ kind, manifest }) => {
    seen.push({ handedUpdatedAt: manifest.updatedAt, kind });
    if (kind === failAt) {
      return err([`refused ${kind}`]);
    }
    return ok({ ...manifest, updatedAt: `after-${kind}` });
  };
  return runKind;
}

/** Run the loop with a fake runner and fresh accumulators. */
async function run({ runKind }: { runKind: RunNonFlatKind }): ReturnType<typeof runNonFlatKinds> {
  const files: Partial<Record<CloudflareKind, CloudflareKindFile>> = {};
  const outcomes: CloudflareSyncKindOutcome[] = [];
  return runNonFlatKinds({
    accountId: "0123456789abcdef0123456789abcdef",
    at: AT,
    client: new Cloudflare({ apiToken: "unused-test-token" }),
    files,
    manifest: initialCloudflareManifest({ updatedAt: "start" }),
    outcomes,
    paths: cloudflareAtlasPaths({ home: "/nonexistent-home" }),
    progress: SILENT,
    runKind,
    zoneId: "zone-1",
  });
}

describe("runNonFlatKinds", () => {
  it("runs all thirteen kinds in registered order, ruleset and zone-ruleset both", async () => {
    const seen: SeenCall[] = [];
    await run({ runKind: recordingRunner({ seen }) });

    expect(seen.map((call) => call.kind)).toEqual(EXPECTED_ORDER);
  });

  it("hands each kind the manifest the previous kind returned, and returns the last one", async () => {
    const seen: SeenCall[] = [];
    const result = await run({ runKind: recordingRunner({ seen }) });

    expect(seen.map((call) => call.handedUpdatedAt)).toEqual([
      "start",
      ...EXPECTED_ORDER.slice(0, -1).map((kind) => `after-${kind}`),
    ]);
    expect(unwrap(result).updatedAt).toBe("after-zone-ruleset");
  });

  it("stops at the first failing kind and visits none after it", async () => {
    const seen: SeenCall[] = [];
    const result = await run({ runKind: recordingRunner({ failAt: "legacy-waf", seen }) });

    expect(seen.map((call) => call.kind)).toEqual([
      "access-policy",
      "gateway-list",
      "account-filter-list",
      "pages-project",
      "worker-script",
      "account-certificate",
      "firewall-service",
      "legacy-waf",
    ]);
    expect(unwrapErr(result)).toEqual(["refused legacy-waf"]);
  });
});
