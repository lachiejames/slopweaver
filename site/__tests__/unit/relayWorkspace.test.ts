/*
 * Whose work a relayed steer is: the card the owner spoke over when it is placed, the console they are on when they spoke over no
 * card, and nothing when the card is itself a finding or one the page cannot see — so a relay row is placed whenever
 * the page knows, and never wears a guess.
 */
import { describe, expect, it } from "vitest";

import { type PlacedQueueRow, relayWorkspace } from "../../lib/relayWorkspace";

const ACME_ROW: PlacedQueueRow = {
  key: "ask:iso-evidence-for-the-access-review",
  placement: {
    by: [{ source: "stated", value: "team", workspace: "team" }],
    kind: "placed",
    workspace: "team",
  },
};

const FOLDED_ROW: PlacedQueueRow = {
  aliases: ["act:first-press"],
  key: "act:latest-press",
  placement: {
    by: [{ source: "repository", value: "lachiejames/slopweaver", workspace: "self" }],
    kind: "placed",
    workspace: "self",
  },
};

const UNPLACED_ROW: PlacedQueueRow = {
  key: "ask:a-row-naming-nothing",
  placement: { kind: "unplaced", why: "names no pull request, Slack destination or workspace" },
};

const ROWS = [ACME_ROW, FOLDED_ROW, UNPLACED_ROW];

describe("relayWorkspace", () => {
  it("states the card's own workspace when it is placed, whichever console the owner is on", () => {
    expect(relayWorkspace({ about: ACME_ROW.key, spokenIn: "slopweaver", rows: ROWS })).toEqual({
      because: "the owner's words answer ask:iso-evidence-for-the-access-review, which is placed in team",
      workspace: "team",
    });
  });

  it("finds the card by an alias the row answers to", () => {
    expect(relayWorkspace({ about: "act:first-press", spokenIn: "work", rows: ROWS })).toEqual({
      because: "the owner's words answer act:first-press, which is placed in self",
      workspace: "self",
    });
  });

  it("states nothing over a card that is a finding, so the row stays one rather than wearing a guess", () => {
    expect(relayWorkspace({ about: UNPLACED_ROW.key, spokenIn: "work", rows: ROWS })).toBe(undefined);
  });

  it("states the console's workspace when the owner spoke over no card at all", () => {
    expect([
      relayWorkspace({ about: "", spokenIn: "work", rows: ROWS }),
      relayWorkspace({ about: "", spokenIn: "slopweaver", rows: [] }),
    ]).toEqual([
      { because: "the owner said it on the team console, over no card", workspace: "team" },
      { because: "the owner said it on the self console, over no card", workspace: "self" },
    ]);
  });

  it("states nothing over no card when no one console places the owner's words, such as a switch mid-steer", () => {
    expect(relayWorkspace({ about: "", rows: ROWS, spokenIn: undefined })).toBe(undefined);
  });

  it("states one workspace when every row answering to the key agrees, and nothing when two disagree", () => {
    const slopweaverCopy: PlacedQueueRow = { ...FOLDED_ROW, aliases: [ACME_ROW.key], key: "ask:joined-later" };
    const unplacedCopy: PlacedQueueRow = { ...UNPLACED_ROW, key: ACME_ROW.key };
    expect([
      relayWorkspace({ about: ACME_ROW.key, rows: [ACME_ROW, ACME_ROW], spokenIn: "work" })!.workspace,
      relayWorkspace({ about: ACME_ROW.key, rows: [ACME_ROW, slopweaverCopy], spokenIn: "work" }),
      relayWorkspace({ about: ACME_ROW.key, rows: [slopweaverCopy, ACME_ROW], spokenIn: "work" }),
      relayWorkspace({ about: ACME_ROW.key, rows: [ACME_ROW, unplacedCopy], spokenIn: "work" }),
    ]).toEqual(["team", undefined, undefined, undefined]);
  });

  it("states nothing over a card the page's Queue does not hold, which may be loading or in the other workspace", () => {
    expect([
      relayWorkspace({ about: ACME_ROW.key, spokenIn: "slopweaver", rows: [] }),
      relayWorkspace({ about: "recipe:nightly-sync", spokenIn: "slopweaver", rows: ROWS }),
    ]).toEqual([undefined, undefined]);
  });
});
