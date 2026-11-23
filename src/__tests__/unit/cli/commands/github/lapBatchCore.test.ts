import { describe, expect, it } from "vitest";

import { LAP_BATCH_MAX, lapMembersFrom, parseLapNumbers } from "../../../../../cli/commands/github/lapBatchArgs.js";
import {
  batchMemberRefusals,
  batchNote,
  batchPreflightOverrun,
  batchStoppedStatuses,
  LAP_BATCH_PREFLIGHT_DEADLINE_MS,
  landedCommitFindings,
  memberAcknowledgement,
  memberAcknowledgementRefusals,
  memberRevertRefusal,
} from "../../../../../cli/commands/github/lapBatchCore.js";
import { STATUS_DESCRIPTION_MAX } from "../../../../../cli/commands/github/lapCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const TIP = "1111111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LANDED = "2222222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const LINK = { commit: "3333333333cc", headSha: "4444444444dd", number: 12, tree: "5555555555ee" };

describe("parseLapNumbers", () => {
  it("keeps the order it was given", () => {
    expect(unwrap(parseLapNumbers({ value: "30,10,20" }))).toEqual([30, 10, 20]);
  });

  it("refuses a member named twice, a non-number and an empty entry", () => {
    const shape = "--number must be a positive whole number, or an ordered comma-separated list of them";
    expect(unwrapErr(parseLapNumbers({ value: "3,3" }))).toEqual([
      "--number names a pull request twice; a batch lands each member once",
    ]);
    expect(unwrapErr(parseLapNumbers({ value: "3,x" }))).toEqual([shape]);
    expect(unwrapErr(parseLapNumbers({ value: "3,,4" }))).toEqual([shape]);
    expect(unwrapErr(parseLapNumbers({ value: "0" }))).toEqual([shape]);
  });

  it("refuses a batch over the bound, naming it", () => {
    const value = Array.from({ length: LAP_BATCH_MAX + 1 }, (_, index) => String(index + 1)).join(",");
    expect(unwrapErr(parseLapNumbers({ value }))).toEqual([
      `--number names ${String(LAP_BATCH_MAX + 1)} pull requests; a batch carries at most ${String(LAP_BATCH_MAX)}`,
    ]);
  });
});

describe("lapMembersFrom", () => {
  it("refuses --land-only with a batch, since a batch's green was earned in combination", () => {
    expect(lapMembersFrom({ landOnly: true, value: "1,2" }).errors).toEqual([
      "--land-only lands one pull request on the lap it already earned; a batch lands only on its own lap",
    ]);
  });

  it("allows --land-only with one pull request", () => {
    expect(lapMembersFrom({ landOnly: true, value: "7" })).toEqual({ errors: [], members: [7] });
  });

  it("names the flag when it carried no text", () => {
    expect(lapMembersFrom({ landOnly: false, value: undefined }).errors).toEqual([
      "--number must be a positive whole number, or an ordered comma-separated list of them",
    ]);
  });
});

describe("batchMemberRefusals", () => {
  it("passes open members on one base", () => {
    const members = [1, 2].map((number) => ({ baseRef: "main", headSha: "h", number, state: "open" }));
    expect(batchMemberRefusals({ members })).toEqual([]);
  });

  it("refuses a closed member and a member on another base", () => {
    expect(
      batchMemberRefusals({
        members: [
          { baseRef: "main", headSha: "h", number: 1, state: "closed" },
          { baseRef: "feature", headSha: "h", number: 2, state: "open" },
        ],
      }),
    ).toEqual([
      "#1 is closed, so the batch cannot land it",
      "a batch lands on ONE base branch, and these members target 2 (#1 → main, #2 → feature); a native-stack member targeting the one below it lands through GitHub's stack route, not a batch lap",
    ]);
  });
});

describe("batchPreflightOverrun", () => {
  it("lets a preflight that reached its deadline exactly through, and refuses one a millisecond past, naming the stage", () => {
    expect(batchPreflightOverrun({ nowMs: LAP_BATCH_PREFLIGHT_DEADLINE_MS, stage: "fetching #3", startedMs: 0 })).toBe(
      undefined,
    );
    expect(
      batchPreflightOverrun({ nowMs: LAP_BATCH_PREFLIGHT_DEADLINE_MS + 1, stage: "fetching #3", startedMs: 0 }),
    ).toBe(
      "the batch preflight passed its 10-minute deadline while fetching #3 (600s in); nothing was posted or run " +
        "and the machine's lock is released, so lap a shorter batch or land the members singly",
    );
  });
});

describe("memberRevertRefusal", () => {
  it("names every restored path with the commit that held it, and the two ways on", () => {
    expect(
      memberRevertRefusal({
        number: 9,
        reverted: [
          { path: "a.ts", restoresBaseCommit: TIP },
          { path: "b.ts", restoresBaseCommit: LANDED },
        ],
      }),
    ).toBe(
      "#9 would restore content the base or a member before it once held, in a.ts (restores 1111111111), " +
        "b.ts (restores 2222222222), which its merge refuses as reverts-main: rebase it over what it undoes, " +
        "or lap it alone with --acknowledge <path> if the revert is meant",
    );
  });

  it("has nothing to say about a member that restores nothing", () => {
    expect(memberRevertRefusal({ number: 9, reverted: [] })).toBeUndefined();
  });
});

describe("batchNote and batchStoppedStatuses", () => {
  it("notes the batch size only", () => {
    expect(batchNote({ size: 3 })).toBe(", batch of 3");
  });

  it("posts a failure per context that --land-only never reads as a lap's green, capped at GitHub's limit", () => {
    const statuses = batchStoppedStatuses({ baseTip: TIP, why: "x".repeat(400) });
    expect(statuses.map((status) => [status.context, status.state])).toEqual([
      ["build", "failure"],
      ["integration", "failure"],
    ]);
    expect(statuses[0]!.description.startsWith("local lap batch stopped over base 1111111111: ")).toBe(true);
    expect(statuses[0]!.description.startsWith("local lap: ")).toBe(false);
    expect(Array.from(statuses[0]!.description)).toHaveLength(STATUS_DESCRIPTION_MAX);
  });
});

describe("memberAcknowledgementRefusals", () => {
  const actual = { baseMoved: ["b.ts", "a.ts"], headChanged: ["c.ts"], headContainsTip: false, reverted: [] };

  it("accepts a measurement that matches the simulation in any order", () => {
    expect(
      memberAcknowledgementRefusals({ actual, freshnessSubject: "base-moved", number: 4, simulated: ["a.ts", "b.ts"] }),
    ).toEqual([]);
  });

  it("refuses when the real tip's paths drifted from the simulated link's", () => {
    expect(memberAcknowledgementRefusals({ actual, freshnessSubject: "base-moved", number: 4, simulated: [] })).toEqual(
      [
        "#4's base-moved paths over the real tip (a.ts,b.ts) are not the ones over its simulated link (none), so the base it would land on is not the tree the lap tested",
      ],
    );
  });

  it("compares the paths themselves, so a path literally named none never reads as the empty set", () => {
    expect(
      memberAcknowledgementRefusals({
        actual: { baseMoved: ["none"], headChanged: [], headContainsTip: false, reverted: [] },
        freshnessSubject: "base-moved",
        number: 4,
        simulated: [],
      }),
    ).toEqual([
      "#4's base-moved paths over the real tip (none) are not the ones over its simulated link (none), so the base it would land on is not the tree the lap tested",
    ]);
  });

  it("refuses a base-moved path the member itself changes, since its subject would accept that path's other finding", () => {
    expect(
      memberAcknowledgementRefusals({
        actual: { ...actual, headChanged: ["a.ts"] },
        freshnessSubject: "base-moved",
        number: 4,
        simulated: ["a.ts", "b.ts"],
      }),
    ).toEqual([
      "#4 itself changes a.ts, which its merge also reports as base-moved; accepting that subject would accept its other finding too, which the lap never answered",
    ]);
  });

  it("refuses a base-moved path git quoted, which no exact compare can match to the member's raw paths", () => {
    const quoted = '"odd\\nname"';
    expect(
      memberAcknowledgementRefusals({
        actual: { baseMoved: [quoted], headChanged: ["odd\nname"], headContainsTip: false, reverted: [] },
        freshnessSubject: "base-moved",
        number: 4,
        simulated: [quoted],
      }),
    ).toEqual([
      `#4's base-moved paths include ${quoted}, which git quoted, so the batch cannot compare it with the member's own unquoted paths: lap it alone`,
    ]);
  });

  it("refuses a base-moved path holding a comma, which --acknowledge's list cannot name exactly", () => {
    expect(
      memberAcknowledgementRefusals({
        actual: { baseMoved: ["docs/a,b.md"], headChanged: [], headContainsTip: false, reverted: [] },
        freshnessSubject: "base-moved",
        number: 4,
        simulated: ["docs/a,b.md"],
      }),
    ).toEqual([
      "#4's base-moved paths include docs/a,b.md, which a comma-separated --acknowledge cannot name exactly: lap it alone",
    ]);
  });

  it("refuses a member changing a path spelled as the freshness subject, which that subject would accept", () => {
    expect(
      memberAcknowledgementRefusals({
        actual: { baseMoved: [], headChanged: ["base-moved"], headContainsTip: false, reverted: [] },
        freshnessSubject: "base-moved",
        number: 4,
        simulated: [],
      }),
    ).toEqual([
      "#4 itself changes a path named base-moved, which the freshness subject the batch adds would also accept as a path finding: lap it alone",
    ]);
  });

  it("refuses a member changing a path spelled as its own loop subject, and only when it names that subject", () => {
    const loopNamed = { baseMoved: [], headChanged: ["codex-loop-incomplete"], headContainsTip: true, reverted: [] };
    const refusal = {
      actual: loopNamed,
      freshnessSubject: "base-moved",
      number: 4,
      simulated: [],
    };
    expect(memberAcknowledgementRefusals({ ...refusal, loopSubject: "codex-loop-incomplete" })).toEqual([
      "#4 itself changes a path named codex-loop-incomplete, which its own Codex loop acknowledgement would also accept as a path finding: lap it alone",
    ]);
    expect(memberAcknowledgementRefusals(refusal)).toEqual([]);
  });

  it("refuses a base-moved path padded with whitespace, which --acknowledge trims into another subject", () => {
    const padded = { baseMoved: [" secret"], headChanged: ["secret"], headContainsTip: true, reverted: [] };
    expect(
      memberAcknowledgementRefusals({
        actual: padded,
        freshnessSubject: "base-moved",
        number: 8,
        simulated: [" secret"],
      }),
    ).toEqual([
      '#8\'s base-moved paths include " secret", which --acknowledge trims into a different subject: lap it alone',
    ]);
  });

  it("refuses ANY member whose base-moved paths include one named as the loop subject", () => {
    const loopMoved = { baseMoved: ["codex-loop-incomplete"], headChanged: [], headContainsTip: false, reverted: [] };
    expect(
      memberAcknowledgementRefusals({
        actual: loopMoved,
        freshnessSubject: "base-moved",
        number: 7,
        simulated: ["codex-loop-incomplete"],
      }),
    ).toEqual([
      "#7's base-moved paths include one named codex-loop-incomplete, which as a subject would also accept the Codex loop finding for a member that never acknowledged it: lap it alone",
    ]);
  });
});

describe("memberAcknowledgement", () => {
  it("accepts exactly the member's base-moved paths and the freshness subject, with the lap's reason", () => {
    expect(
      memberAcknowledgement({
        facts: { baseMoved: ["a.ts"], headChanged: [], headContainsTip: false, reverted: [] },
        freshnessSubject: "base-moved",
        tested: LANDED,
      }),
    ).toEqual({
      reason:
        "the base moved past this head (1 path(s) it never saw): a local batch lap tested 2222222222, the simulated squash of every member onto the base, which holds each of them",
      subjects: "a.ts,base-moved",
    });
  });

  it("adds nothing for a head that already contains the tip and misses no path", () => {
    expect(
      memberAcknowledgement({
        facts: { baseMoved: [], headChanged: ["a.ts"], headContainsTip: true, reverted: [] },
        freshnessSubject: "base-moved",
        tested: LANDED,
      }),
    ).toBeUndefined();
  });

  it("adds the member's own loop subject and reason to its base-moved acknowledgement", () => {
    expect(
      memberAcknowledgement({
        facts: { baseMoved: ["a.ts"], headChanged: [], headContainsTip: true, reverted: [] },
        freshnessSubject: "base-moved",
        loop: { reason: "capped at two passes: r1-02 left", subject: "codex-loop-incomplete" },
        tested: LANDED,
      }),
    ).toEqual({
      reason:
        "the base moved past this head (1 path(s) it never saw): a local batch lap tested 2222222222, the simulated squash of every member onto the base, which holds each of them; codex-loop-incomplete: capped at two passes: r1-02 left",
      subjects: "a.ts,codex-loop-incomplete",
    });
  });

  it("hands a member with nothing else to accept its loop subject alone", () => {
    expect(
      memberAcknowledgement({
        facts: { baseMoved: [], headChanged: ["a.ts"], headContainsTip: true, reverted: [] },
        freshnessSubject: "base-moved",
        loop: { reason: "capped", subject: "codex-loop-incomplete" },
        tested: LANDED,
      }),
    ).toEqual({ reason: "codex-loop-incomplete: capped", subjects: "codex-loop-incomplete" });
  });
});

describe("landedCommitFindings", () => {
  it("finds nothing when the landing is the prediction", () => {
    const landed = { parents: [TIP], sha: LANDED, tree: LINK.tree };
    expect(landedCommitFindings({ expectedParent: TIP, landed, link: LINK })).toEqual([]);
  });

  it("names another landing that slipped in, and a merge commit's second parent", () => {
    expect(
      landedCommitFindings({
        expectedParent: TIP,
        landed: { parents: [TIP, LINK.headSha], sha: LANDED, tree: LINK.tree },
        link: LINK,
      }),
    ).toEqual([
      "the base tip after #12 is 2222222222, whose parent(s) 1111111111, 4444444444 are not the tip 1111111111 it was landed onto, so another landing slipped in",
    ]);
  });

  it("names a tree GitHub's squash wrote differently", () => {
    expect(
      landedCommitFindings({
        expectedParent: TIP,
        landed: { parents: [TIP], sha: LANDED, tree: "9999999999ff" },
        link: LINK,
      }),
    ).toEqual([
      "#12 landed as tree 9999999999, not the simulated 5555555555, so GitHub's squash disagreed with the lap's and the members after it were never tested over what is now the base",
    ]);
  });
});
