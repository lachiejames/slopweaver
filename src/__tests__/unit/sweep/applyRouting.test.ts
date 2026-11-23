import { describe, expect, it } from "vitest";

import { parseHandoverSettleArgs } from "../../../cli/commands/handover/askRowArgs.js";
import { settlePlan } from "../../../cli/commands/handover/settleRowPlan.js";
import { actCall } from "../../../cli/commands/sweep/applyRun.js";
import { VERB_ARG_OFFSET } from "../../../cli/commands/sweep/core.js";
import { registerVerbArgv } from "../../../cli/commands/sweep/registerVerbCall.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { SweepCandidate } from "../../../sweep/classify.js";
import { SweepErrors } from "../../../sweep/errors.js";

function candidate(over: Partial<SweepCandidate> = {}): SweepCandidate {
  return {
    act: "close",
    path: "/h/some-row.md",
    slug: "some-row",
    verdict: "SHIPPED",
    witness: "all 1 declared probe(s) pass against the tree — the work is in",
    ...over,
  };
}

const ORPHAN = candidate({ act: "settle", verdict: "ORPHANED", witness: "it can never run" });
const ENDED = candidate({
  act: "settle",
  verdict: "PR_ENDED",
  witness: "every pull request its question names has ended: https://github.com/acme/app/pull/2 closed unmerged at x",
});
const HIS_WORDS = "that whole stack is dead, drop it";
const HIS_ANCHOR = "https://example.slack.com/archives/C0/p1760000000000000";

describe("registerVerbArgv", () => {
  it("pads the argv to the position every handover runner slices from", () => {
    const call = registerVerbArgv({ rest: ["some-row", "--summary", "it shipped"], verb: "close" });
    expect(call.argv.slice(0, 4)).toEqual(["node", "slopweaver", "handover", "close"]);
    expect(call.argv.slice(4)).toEqual(["some-row", "--summary", "it shipped"]);
  });

  it("records the line a reader can re-run by hand", () => {
    const call = registerVerbArgv({ rest: ["some-row", "--summary", "it shipped"], verb: "close" });
    expect(call.line).toBe("slopweaver handover close some-row --summary it shipped");
  });
});

describe("actCall", () => {
  it("routes SHIPPED to handover close, carrying the witness as the summary", () => {
    const routed = actCall({
      candidate: candidate(),
      declineAnchor: undefined,
      declineReason: undefined,
      dir: undefined,
      home: "/state",
    });
    expect(unwrap(routed)!.argv).toEqual([
      "node",
      "slopweaver",
      "handover",
      "close",
      "some-row",
      "--summary",
      "all 1 declared probe(s) pass against the tree — the work is in",
      "--home",
      "/state",
    ]);
  });

  it("routes ORPHANED to settle --as declined with the owner's anchor as the witness and the owner's words as the reason", () => {
    const routed = actCall({
      candidate: ORPHAN,
      declineAnchor: HIS_ANCHOR,
      declineReason: HIS_WORDS,
      dir: undefined,
      home: "/state",
    });
    expect(unwrap(routed)!.argv.slice(3)).toEqual([
      "settle",
      "some-row",
      "--as",
      "declined",
      "--witness",
      HIS_ANCHOR,
      "--reason",
      HIS_WORDS,
      "--home",
      "/state",
    ]);
  });

  it("routes SUPERSEDED exactly as ORPHANED, because the declaring row is evidence and not the owner's decline", () => {
    const superseded = candidate({ act: "settle", verdict: "SUPERSEDED", witness: "newer-row declares it" });
    const routed = actCall({
      candidate: superseded,
      declineAnchor: ` ${HIS_ANCHOR} `,
      declineReason: ` ${HIS_WORDS} `,
      dir: undefined,
      home: "/state",
    });
    expect(unwrap(routed)!.line).toBe(
      `slopweaver handover settle some-row --as declined --witness ${HIS_ANCHOR} --reason ${HIS_WORDS} --home /state`,
    );
  });

  it("refuses a decline carrying neither the owner's words nor the owner's anchor, naming both", () => {
    const routed = actCall({
      candidate: ORPHAN,
      declineAnchor: undefined,
      declineReason: undefined,
      dir: undefined,
      home: "/state",
    });
    expect(unwrapErr(routed)).toStrictEqual(
      SweepErrors.declineAuthorityRequired({
        missing: ["--reason", "--anchor"],
        slug: "some-row",
        verdict: "ORPHANED",
      }),
    );
  });

  it("counts a blank reason as absent rather than settling on whitespace", () => {
    const routed = actCall({
      candidate: ORPHAN,
      declineAnchor: HIS_ANCHOR,
      declineReason: "   ",
      dir: undefined,
      home: "/state",
    });
    expect(unwrapErr(routed).code).toBe("DECLINE_AUTHORITY_REQUIRED");
    expect(unwrapErr(routed).message).toContain("missing --reason. Ask the owner");
  });

  it("refuses decline-only flags on a close, where they would be silently dropped", () => {
    const routed = actCall({
      candidate: candidate(),
      declineAnchor: undefined,
      declineReason: HIS_WORDS,
      dir: undefined,
      home: "/state",
    });
    expect(unwrapErr(routed)).toStrictEqual(
      SweepErrors.declineAuthorityInapplicable({ slug: "some-row", verdict: "SHIPPED" }),
    );
  });

  it("passes an explicit handovers directory through when the caller named one", () => {
    const routed = actCall({
      candidate: candidate(),
      declineAnchor: undefined,
      declineReason: undefined,
      dir: "/elsewhere",
      home: "/state",
    });
    expect(unwrap(routed)!.argv.slice(-4)).toEqual(["--home", "/state", "--dir", "/elsewhere"]);
  });

  it("offers no call at all for a verdict that carries no act", () => {
    const unactable = candidate({ act: "none", verdict: "UNWITNESSED", witness: "declares no doneWhen probe" });
    const routed = actCall({
      candidate: unactable,
      declineAnchor: undefined,
      declineReason: undefined,
      dir: undefined,
      home: "/state",
    });
    expect(unwrap(routed)).toBeUndefined();
  });

  it("offers no call for a CONTRADICTED row, which is a finding rather than an act", () => {
    const contradicted = candidate({ act: "none", verdict: "CONTRADICTED", witness: "its probes disagree" });
    const routed = actCall({
      candidate: contradicted,
      declineAnchor: undefined,
      declineReason: undefined,
      dir: undefined,
      home: "/state",
    });
    expect(unwrap(routed)).toBeUndefined();
  });

  it("offers no call for an act its verdict does not carry, even with the owner's words and anchor", () => {
    const built = { act: "settle", verdict: "OVERTAKEN", witness: "a later slug epoch" } as const;
    const overtaken = actCall({
      candidate: candidate(built),
      declineAnchor: HIS_ANCHOR,
      declineReason: HIS_WORDS,
      dir: undefined,
      home: "/state",
    });
    const shippedSettle = actCall({
      candidate: candidate({ act: "settle", verdict: "SHIPPED" }),
      declineAnchor: HIS_ANCHOR,
      declineReason: HIS_WORDS,
      dir: undefined,
      home: "/state",
    });
    expect(unwrap(overtaken)).toBeUndefined();
    expect(unwrap(shippedSettle)).toBeUndefined();
  });
});

// The seam the fake register verb hid: the argv `actCall` builds is fed to the REAL settle flag parser and
// planner, so a decline the settle verb would refuse — the missing --reason this row found — fails here.
describe("actCall against the real handover settle plan", () => {
  it("produces a decline the real settle planner accepts, with the owner's anchor and words", () => {
    const call = unwrap(
      actCall({ candidate: ORPHAN, declineAnchor: HIS_ANCHOR, declineReason: HIS_WORDS, dir: "/hd", home: "/state" }),
    )!;
    const parsed = unwrap(parseHandoverSettleArgs({ rest: call.argv.slice(VERB_ARG_OFFSET) }));
    expect(settlePlan({ positionals: parsed.positionals, values: parsed.values })).toStrictEqual({
      disposition: undefined,
      reason: HIS_WORDS,
      settlement: "declined",
      slug: "some-row",
      witness: HIS_ANCHOR,
    });
  });

  it("settles PR_ENDED as answered on GitHub's record, a plan the real settle planner accepts", () => {
    const call = unwrap(
      actCall({ candidate: ENDED, declineAnchor: undefined, declineReason: undefined, dir: undefined, home: "/state" }),
    )!;
    expect(call.line).toBe(
      `slopweaver handover settle some-row --as answered --witness ${ENDED.witness} --home /state`,
    );
    const parsed = unwrap(parseHandoverSettleArgs({ rest: call.argv.slice(VERB_ARG_OFFSET) }));
    expect(settlePlan({ positionals: parsed.positionals, values: parsed.values })).toStrictEqual({
      disposition: undefined,
      reason: undefined,
      settlement: "answered",
      slug: "some-row",
      witness: ENDED.witness,
    });
  });

  it("refuses the owner's decline words on PR_ENDED, whose act is not a decline", () => {
    const routed = actCall({
      candidate: ENDED,
      declineAnchor: HIS_ANCHOR,
      declineReason: HIS_WORDS,
      dir: undefined,
      home: "/state",
    });
    expect(unwrapErr(routed)).toEqual(
      SweepErrors.declineAuthorityInapplicable({ slug: "some-row", verdict: "PR_ENDED" }),
    );
  });

  it("is the shape the old route produced, and the real planner refuses it — the defect this guards", () => {
    const parsed = unwrap(
      parseHandoverSettleArgs({ rest: ["some-row", "--as", "declined", "--witness", "it can never run"] }),
    );
    expect(settlePlan({ positionals: parsed.positionals, values: parsed.values })).toStrictEqual({
      refusal: "--reason is required for --as declined — only the owner declines an ask, and a decline says why",
    });
  });
});
