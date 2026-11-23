/**
 * The `hand` noun's manifest: every verb spreads one local-state shared meta, and some rows override it — `list` is a
 * diagnostic, `list`, `mute`, `post`, `push`, `recheck`, `show` and `wake` are not dry-parse safe (a bare run acts), `post` is
 * also not parse-reject I/O-free, and `surface` is effect-free (it only prints a report) and quotes its usage from the
 * leaf the command prints. That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { HAND_LINE_RETIRE_USAGE_LINE } from "../../../../cli/commands/hand/lineRetireUsage.js";
import { HAND_SURFACE_USAGE_LINE } from "../../../../cli/commands/hand/surfaceUsage.js";
import { handManifest } from "../../../../cli/manifests/hand.js";

import { classificationsOf } from "./_classification.js";

describe("handManifest", () => {
  it("declares exactly the twelve hand-step verbs", () => {
    expect(Object.keys(handManifest).toSorted()).toEqual([
      "done",
      "line-retire",
      "list",
      "mute",
      "post",
      "push",
      "recheck",
      "retract",
      "show",
      "snooze",
      "surface",
      "wake",
    ]);
  });

  it("classifies the register verbs local-state, `list` a diagnostic and `surface` effect-free", () => {
    expect(classificationsOf({ manifest: handManifest })).toEqual({
      done: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "line-retire": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      list: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      mute: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      post: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
      push: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      recheck: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      retract: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      show: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      snooze: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      surface: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      wake: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });

  it("quotes `surface`'s usage from the leaf the command itself prints", () => {
    expect(handManifest["surface"]!.meta.usage).toBe(HAND_SURFACE_USAGE_LINE);
  });

  it("quotes `line-retire`'s usage from the leaf the command itself prints", () => {
    expect(handManifest["line-retire"]!.meta.usage).toBe(HAND_LINE_RETIRE_USAGE_LINE);
  });
});
