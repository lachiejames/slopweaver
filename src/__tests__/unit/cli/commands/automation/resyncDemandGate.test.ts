import { describe, expect, it } from "vitest";

import { demandGate, lastSuccessOf } from "../../../../../cli/commands/automation/resyncDemandGate.js";
import type { ResyncDemandRecord } from "../../../../../live/resync/demand.js";
import type { ResyncState } from "../../../../../live/resync/outcome.js";

const record: ResyncDemandRecord = {
  author: "Tobias Wren",
  occurredAt: "2026-10-06T22:03:01Z",
  source: "slack",
  url: "https://acme.slack.com/archives/C0SYN000019/p1791324181655509",
};

describe("demandGate", () => {
  it("stamps a slot no person asked for, and defers one whose check could not read", () => {
    expect([
      demandGate({ demand: { kind: "unwanted", sinceIso: null, terms: ["aether"] } }).exitCode,
      demandGate({ demand: { kind: "unreadable", why: "no store" } }).exitCode,
    ]).toEqual([3, 4]);
  });

  it("says why a deferred slot did not walk", () => {
    expect(demandGate({ demand: { kind: "unreadable", why: "no store" } }).line).toBe(
      "DEFERRED · the demand check could not run, so nothing walked: no store",
    );
  });

  it("lets a wanted target walk, naming who asked and linking the mention", () => {
    expect(demandGate({ demand: { kind: "wanted", record } })).toEqual({
      exitCode: undefined,
      line: "WANTED by Tobias Wren in slack at 2026-10-06T22:03:01Z — https://acme.slack.com/archives/C0SYN000019/p1791324181655509",
    });
  });

  it("lets an ungated target walk and adds no line, so its output is unchanged", () => {
    expect(demandGate({ demand: { kind: "ungated" } })).toEqual({ exitCode: undefined, line: undefined });
  });
});

describe("lastSuccessOf", () => {
  it("is null with no record, and the record's last success otherwise", () => {
    const state: ResyncState = {
      blocker: null,
      lastAttempt: null,
      lastSuccessAtIso: "2026-10-04T21:27:13.151Z",
      recipeId: "resync-atlas-aether",
    };
    expect([lastSuccessOf({ state: null }), lastSuccessOf({ state })]).toEqual([null, "2026-10-04T21:27:13.151Z"]);
  });
});
