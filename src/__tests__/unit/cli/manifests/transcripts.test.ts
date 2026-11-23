/**
 * The `transcripts` noun's manifest: every verb reads Claude session transcripts outside the state home and writes
 * nothing (`external-read`). The bare noun and `sessions` share one handler whose scope is optional, so a bare run
 * stats and lists every transcript and is not a dry parse; every other verb refuses a bare run before it reads.
 * That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { transcriptsManifest } from "../../../../cli/manifests/transcripts.js";

import { classificationsOf } from "./_classification.js";

describe("transcriptsManifest", () => {
  it("declares exactly the bare noun and eight verbs", () => {
    expect(Object.keys(transcriptsManifest).toSorted()).toEqual([
      "",
      "boot-hooks",
      "draw",
      "errors",
      "last-turn",
      "latency",
      "sessions",
      "summary",
      "turns",
    ]);
  });

  it("classifies every verb as an external read, and only the bare noun and `sessions` as not dry parses", () => {
    expect(classificationsOf({ manifest: transcriptsManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      "boot-hooks": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      draw: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      errors: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      "last-turn": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      latency: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      sessions: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      summary: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      turns: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
    });
  });
});
