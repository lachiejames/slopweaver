/**
 * The `supervisor` noun's manifest: twenty verbs, all local-state bar the pure readers `intake`, `owner-turn-show`
 * and `state-check`. Five verbs (`chain`, `intake`, `owner-turns`, `reoriented`, `tick-reseal`) take only optional
 * flags, so a bare run reads and prints and is not a dry parse; `tick-record` and `sweep-prompt` run the chair gate before their flags
 * parse, so neither a bare run nor a parse reject is I/O-free. That the manifest imports nothing heavier is
 * `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { supervisorManifest } from "../../../../cli/manifests/supervisor.js";
import { supervisorStateDocManifest } from "../../../../cli/manifests/supervisorStateDoc.js";

import { classificationsOf } from "./_classification.js";

describe("supervisorStateDocManifest", () => {
  it("declares exactly the four state-doc verbs", () => {
    expect(Object.keys(supervisorStateDocManifest).toSorted()).toEqual([
      "state-amend",
      "state-archive",
      "state-check",
      "state-fold",
    ]);
  });

  it("is the one declaration supervisorManifest carries for each, not a second copy", () => {
    const carried = Object.keys(supervisorStateDocManifest).filter(
      (verb) => supervisorManifest[verb] !== supervisorStateDocManifest[verb],
    );
    expect(carried).toEqual([]);
  });
});

describe("supervisorManifest", () => {
  it("declares exactly the twenty supervisor verbs", () => {
    expect(Object.keys(supervisorManifest).toSorted()).toEqual([
      "chain",
      "intake",
      "intake-mark",
      "owner-turn-record",
      "owner-turn-show",
      "owner-turns",
      "refresh-run",
      "reoriented",
      "scratch-carry",
      "state-amend",
      "state-archive",
      "state-check",
      "state-fold",
      "successor-summary",
      "sweep-prompt",
      "tick",
      "tick-capture",
      "tick-draft",
      "tick-record",
      "tick-reseal",
    ]);
  });

  it("classifies each verb by its effect, whether a bare run acts, and whether the chair gate runs before the parse", () => {
    expect(classificationsOf({ manifest: supervisorManifest })).toEqual({
      chain: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      intake: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      "intake-mark": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "owner-turn-record": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "owner-turn-show": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      "owner-turns": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "refresh-run": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      reoriented: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "scratch-carry": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "state-amend": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "state-archive": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "state-check": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      "state-fold": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "successor-summary": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "sweep-prompt": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
      tick: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "tick-capture": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "tick-draft": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "tick-record": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
      "tick-reseal": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });
});
