/**
 * The `queue` noun's manifest: `list`, `show`, `deferred`, `refusals` and `stopping` only read (`effect: "none"`),
 * `defer` and `drop` append to a local ledger, and `release` is the one door-routed external write. `show`, `drop`,
 * `release` and `defer` REQUIRE an id (or `--kind`/`--id`) and refuse a bare run; `list`, `deferred`, `refusals` and
 * `stopping` act on one. The defer, refusals and stopping usage strings are the literal-only leaf constants. That the manifest imports nothing heavier is
 * `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { QUEUE_DEFER_USAGE, QUEUE_DEFERRED_USAGE } from "../../../../cli/commands/queue/deferUsage.js";
import { QUEUE_REFUSALS_USAGE } from "../../../../cli/commands/queue/refusalsUsage.js";
import { QUEUE_STOPPING_USAGE } from "../../../../cli/commands/queue/stoppingUsage.js";
import { queueManifest } from "../../../../cli/manifests/queue.js";

import { classificationsOf } from "./_classification.js";

describe("queueManifest", () => {
  it("declares exactly the eight queue verbs", () => {
    expect(Object.keys(queueManifest).toSorted()).toEqual([
      "defer",
      "deferred",
      "drop",
      "list",
      "refusals",
      "release",
      "show",
      "stopping",
    ]);
  });

  it("pins every verb's six classification fields", () => {
    expect(classificationsOf({ manifest: queueManifest })).toEqual({
      defer: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      deferred: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      drop: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      list: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      refusals: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      release: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: true,
        dryParseSafe: true,
        effect: "external-write",
        parseRejectIsIoFree: true,
      },
      show: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      stopping: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
    });
  });

  it("quotes the defer, deferred, refusals and stopping usage leaves by identity", () => {
    expect(queueManifest["defer"]!.meta.usage).toBe(QUEUE_DEFER_USAGE);
    expect(queueManifest["deferred"]!.meta.usage).toBe(QUEUE_DEFERRED_USAGE);
    expect(queueManifest["refusals"]!.meta.usage).toBe(QUEUE_REFUSALS_USAGE);
    expect(queueManifest["stopping"]!.meta.usage).toBe(QUEUE_STOPPING_USAGE);
  });
});
