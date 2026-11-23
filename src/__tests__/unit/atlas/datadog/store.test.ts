import { describe, expect, it } from "vitest";

import { type DatadogKindFile, emptyDatadogManifest } from "../../../../atlas/datadog/documents.js";
import { DATADOG_MANIFEST_SCAN_KIND } from "../../../../atlas/datadog/fieldDenial.js";
import { DATADOG_KINDS } from "../../../../atlas/datadog/model.js";
import { datadogAtlasPaths, datadogStoreSpec } from "../../../../atlas/datadog/store.js";
import { unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-05T01:00:00.000Z";

const kindFile = ({ detail }: { detail: unknown }): DatadogKindFile => ({
  coverage: [],
  entities: [
    {
      channels: {
        api: { channel: "api", detail, firstSeenAt: AT, lastSeenAt: AT, source: null, state: "observed" },
        "compiled-catalogue": null,
        console: null,
      },
      id: "i-1",
      kind: "integrations",
      providerId: "acct-1",
      scope: "org/site",
    },
  ],
  gaps: [],
  kind: "integrations",
  platform: "datadog",
  schemaVersion: 2,
  updatedAt: AT,
});

describe("datadogStoreSpec", () => {
  it("tells the kit every kind the model declares, so a generation is never derived from a listing", () => {
    expect(datadogStoreSpec().kinds).toStrictEqual(DATADOG_KINDS);
  });

  // The gate is a property of PUBLISHING, not something a sync remembers to call. This is the assertion
  // that makes it enforcing rather than advisory.
  it("REFUSES a publish whose kind file carries a denied field, before any file is opened", () => {
    const spec = datadogStoreSpec({ files: { integrations: kindFile({ detail: { clientSecret: "live" } }) } });
    // `!`: the spec always declares a guard, and `testing.md` prefers a non-null assertion over an `if`
    // that would let this test pass silently on a spec that stopped declaring one.
    const guarded = spec.guardPublish!({ next: emptyDatadogManifest({ updatedAt: AT }), prior: null });

    expect(guarded.isErr()).toBe(true);
    expect(unwrapErr(guarded)[0]).toContain("refusing the whole integrations generation");
  });

  it("admits a publish whose kind file carries only posture", () => {
    const spec = datadogStoreSpec({ files: { integrations: kindFile({ detail: { accountId: "a-1" } }) } });
    const guarded = spec.guardPublish!({ next: emptyDatadogManifest({ updatedAt: AT }), prior: null });

    expect(guarded.isOk()).toBe(true);
  });

  // A manifest carries failure REASONS — strings this repository composed from a provider error, which is
  // exactly where a credential ends up.
  it("scans the MANIFEST too, under a kind of its own", () => {
    const manifest = emptyDatadogManifest({ updatedAt: AT });
    const poisoned = {
      ...manifest,
      kinds: {
        ...manifest.kinds,
        monitor: {
          digest: null,
          entityCount: 0,
          lastAttempt: { at: AT, outcome: "failed" as const, reasons: ["-----BEGIN PRIVATE KEY-----"] },
          lastSuccessAt: null,
        },
      },
    };
    const guarded = datadogStoreSpec().guardPublish!({ next: poisoned, prior: null });

    expect(unwrapErr(guarded)).toEqual([
      "refusing the whole manifest generation: value matches PEM private key block at " +
        "/kinds/monitor/lastAttempt/reasons/0",
    ]);
  });

  it("scans the manifest under a kind that is not a real atlas kind, so no field rule leaks onto it", () => {
    // Widened to `string[]` on purpose: the two types genuinely do not overlap, so the compiler rejects a
    // direct comparison — a stronger proof than this test — and this test is what makes the property
    // visible to a reader who is not running tsc.
    const declared: readonly string[] = DATADOG_KINDS;

    expect(declared.includes(DATADOG_MANIFEST_SCAN_KIND)).toBe(false);
  });

  it("refuses a credential this process holds, wherever it appears in a kind file", () => {
    const spec = datadogStoreSpec({
      files: { integrations: kindFile({ detail: { note: "see key abc123def456" } }) },
      knownSecrets: ["abc123def456"],
    });
    const guarded = spec.guardPublish!({ next: emptyDatadogManifest({ updatedAt: AT }), prior: null });

    expect(unwrapErr(guarded)).toEqual([
      "refusing the whole integrations generation: value matches a credential this process itself holds at " +
        "/entities/0/channels/api/detail/note",
    ]);
  });
});

describe("datadogAtlasPaths", () => {
  it("gives every declared kind its own file under the platform's own directory", () => {
    const paths = datadogAtlasPaths({ home: "/tmp/a-home-that-is-never-written" });

    expect(Object.keys(paths.kinds).toSorted()).toStrictEqual([...DATADOG_KINDS].toSorted());
    expect(paths.manifest).toBe("/tmp/a-home-that-is-never-written/atlas/datadog/manifest.json");
    expect(paths.kinds.monitor).toBe("/tmp/a-home-that-is-never-written/atlas/datadog/monitor.jsonl");
  });

  it("archives a reset outside the platform directory, so nothing is ever deleted in place", () => {
    const paths = datadogAtlasPaths({ home: "/tmp/a-home-that-is-never-written" });

    expect(paths.superseded).toBe("/tmp/a-home-that-is-never-written/atlas/_superseded/datadog");
  });
});

describe("emptyDatadogManifest", () => {
  // A kind missing from the manifest reads as a kind that does not exist — the same silence the
  // declared-but-unfilled surface state exists to prevent.
  it("carries every kind from the first generation, never only the ones that succeeded", () => {
    const manifest = emptyDatadogManifest({ updatedAt: AT });

    expect(Object.keys(manifest.kinds).toSorted()).toStrictEqual([...DATADOG_KINDS].toSorted());
    expect(manifest.kinds.monitor).toStrictEqual({
      digest: null,
      entityCount: 0,
      lastAttempt: null,
      lastSuccessAt: null,
    });
  });
});
