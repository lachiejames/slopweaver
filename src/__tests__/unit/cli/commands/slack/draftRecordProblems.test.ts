/** `slack draft record`'s thread, supersedes and approval checks, called directly. */
import { describe, expect, it } from "vitest";

import {
  approvalOptionsOf,
  approvalProblems,
  machineIdProblems,
  supersededIdsOf,
  supersedesProblems,
  threadProblems,
} from "../../../../../cli/commands/slack/draftRecordProblems.js";

describe("threadProblems", () => {
  it("passes a well-formed thread ts and refuses a malformed one", () => {
    expect(threadProblems({ threadTs: "1790145643.664469", why: "THREAD reply" })).toEqual([]);
    expect(threadProblems({ threadTs: "p1790145643664469", why: undefined })[0]).toContain(
      "--thread-ts p1790145643664469 is not a Slack ts",
    );
  });
});

describe("machineIdProblems", () => {
  it("names the incident's why, which named its source call by id", () => {
    const why =
      "recut of sd-97e7fb10 on the owner's word (talk-call efe7b241, 01:16Z): top-level ask to the payments team";
    expect(machineIdProblems({ flags: ["why"], values: { why } })).toEqual([
      '--why names "call efe7b241" by its machine id, which the Queue card prints to them and refuses — name it by ' +
        'what it was doing ("their call this morning", "the recut they asked for") and drop the id',
    ]);
  });

  it("names each flag's id in flag order, and reads only the flags it is given", () => {
    const problems = machineIdProblems({
      flags: ["meaning-changed", "why"],
      values: {
        channel: "the turn 5c0ffee1 is not a printed flag",
        "meaning-changed": "the session 61445570 reworded the ask",
        why: "the run a0000019 asked for it",
      },
    });
    expect(problems.map((line) => line.slice(0, line.indexOf(" by its")))).toEqual([
      '--meaning-changed names "session 61445570"',
      '--why names "run a0000019"',
    ]);
  });

  it("passes prose, a draft id, a Slack ts, a commit SHA, an id inside a URL and an absent flag", () => {
    const why =
      "recut of sd-97e7fb10 at 1790145643.664469 after commit a0373727c1, from https://example.test/call:efe7b241";
    expect(machineIdProblems({ flags: ["why", "meaning-changed"], values: { why } })).toEqual([]);
  });

  // The card joins the two with a space, so "after the call" + a bare machine id names `call <id>`.
  it("names an id only the card's join of two flags forms, once, and never one a flag already named", () => {
    const values = { "meaning-changed": "the request changed after the call ", why: "efe7b241 is the recut" };
    const flags = ["why", "meaning-changed"];
    const drawnTogether = ["meaning-changed", "why"];
    expect(machineIdProblems({ drawnTogether, flags, values })).toEqual([
      '--meaning-changed and --why together name "call efe7b241" where the card joins them, and it refuses that — ' +
        'name it by what it was doing ("their call this morning", "the recut they asked for") and drop the id',
    ]);
    // Without the join each flag alone reads as prose, which is the gap the join closes.
    expect(machineIdProblems({ flags, values })).toEqual([]);
    const named = { ...values, why: "run a0000019 asked for it" };
    expect(
      machineIdProblems({ drawnTogether, flags, values: named }).map((line) => line.slice(0, line.indexOf(" by its"))),
    ).toEqual(['--why names "run a0000019"']);
    expect(machineIdProblems({ drawnTogether, flags, values: { why: "efe7b241 is the recut" } })).toEqual([]);
  });
});

describe("supersededIdsOf and supersedesProblems", () => {
  it("splits the list and names a blank flag, a non-id and a repeat", () => {
    expect(supersededIdsOf({ value: " sd-1a2b3c4d, ,sd-5e6f7a8b" })).toEqual(["sd-1a2b3c4d", "sd-5e6f7a8b"]);
    expect(supersededIdsOf({ value: undefined })).toEqual([]);
    expect(supersedesProblems({ given: true, supersedes: [] })).toEqual([
      "--supersedes names no draft id — pass the held row(s) this one re-cuts, or drop the flag",
    ]);
    expect(supersedesProblems({ given: true, supersedes: ["sd-1a2b3c4d", "nope", "sd-1a2b3c4d"] })).toEqual([
      "--supersedes nope is not a draft id (sd- and eight hex digits, e.g. sd-1a2b3c4d)",
      "--supersedes names sd-1a2b3c4d twice — name each held row once",
    ]);
  });
});

describe("approvalProblems and approvalOptionsOf", () => {
  it("refuses the owner's yes beside a declared change of meaning, and trims each given flag", () => {
    expect(approvalProblems({ values: { approved: "talk-call:f9e9277d#12", "meaning-changed": "new ask" } })).toEqual([
      "--approved and --meaning-changed cannot both be given: one says they said yes, the other that it lapsed",
    ]);
    expect(approvalProblems({ values: {} })).toEqual([]);
    expect(approvalOptionsOf({ values: { approved: " talk-call:f9e9277d#12 " } })).toEqual({
      approved: "talk-call:f9e9277d#12",
    });
    expect(approvalOptionsOf({ values: {} })).toEqual({});
  });
});
