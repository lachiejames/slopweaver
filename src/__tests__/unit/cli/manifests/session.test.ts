/**
 * The `session` noun's manifest: the supervisor's own session ledger, where every write lands under the state home
 * (`local-state`). Pinned per verb: `list` only reads the log (`none`), `depth` and `fallbacks` read transcripts and
 * the cmux inventory (`external-read`), `spend` registers a board row under `--finding` (the one `createsWorkItem`),
 * and the verbs whose bare run reads or acts (`compaction`, `spend`, `close-done`, `depth`, `fallbacks`, `list`,
 * `re-seat`, `standing`, `watch`) are not dry parses. That the manifest imports nothing heavier is
 * `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { sessionManifest } from "../../../../cli/manifests/session.js";

import { classificationsOf } from "./_classification.js";

describe("sessionManifest", () => {
  it("declares exactly the fourteen session verbs", () => {
    expect(Object.keys(sessionManifest).toSorted()).toEqual([
      "close",
      "close-done",
      "compaction",
      "depth",
      "fallbacks",
      "list",
      "no-subagents",
      "re-seat",
      "reach-grant",
      "record",
      "respawn",
      "spend",
      "standing",
      "watch",
    ]);
  });

  it("classifies each verb by what it writes, whether a bare run acts, and whether it files a board row", () => {
    expect(classificationsOf({ manifest: sessionManifest })).toEqual({
      close: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "close-done": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      compaction: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      depth: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      fallbacks: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
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
      "no-subagents": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "re-seat": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "reach-grant": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      record: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      respawn: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      spend: {
        createsWorkItem: true,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      standing: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      watch: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });
});
