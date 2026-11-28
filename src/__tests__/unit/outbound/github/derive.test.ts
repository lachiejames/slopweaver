import { describe, expect, it } from "vitest";

import {
  canonicalKindOf,
  levelOf,
  plainTextOf,
  problemBadgeOf,
  proofBadgeOf,
  proofStateOf,
  riskBadgeOf,
  topRiskOf,
} from "../../../../outbound/github/derive.js";
import { WORST_KINDS } from "../../../../outbound/github/schema.js";
import type { RiskItem, WorstKind } from "../../../../outbound/github/types.js";
import {
  FEATURE_BODY,
  FIX_BODY,
  P1_CHECKED,
  P2_CHECKED,
  P3_CHECKED,
  QUOTE_BODY,
  TESTS_BODY,
  TESTS_ONLY_BODY,
  t,
} from "./fixtures.js";

describe("levelOf and canonicalKindOf", () => {
  it("maps each kind of worst case to the level it implies, high first", () => {
    expect(WORST_KINDS.map((worstKind) => levelOf({ worstKind }))).toEqual(["high", "medium", "low"]);
  });

  it("maps each level to its one kind", () => {
    expect((["high", "medium", "low"] as const).map((level) => canonicalKindOf({ level }))).toEqual([
      "loses-leaks-or-changes-off-machine",
      "something-working-breaks",
      "only-tests-docs-or-dev-tooling",
    ]);
  });

  it("reads each level's kind back as the level it came from", () => {
    expect(
      (["high", "medium", "low"] as const).map((level) => levelOf({ worstKind: canonicalKindOf({ level }) })),
    ).toEqual(["high", "medium", "low"]);
  });
});

/** A risk item of a kind, checked or not, with a one-word worst case. */
function itemAt({ worstKind, checked }: { worstKind: WorstKind; checked: boolean }): RiskItem {
  const check = checked ? ({ check: "c", kind: "checked" } as const) : ({ kind: "unchecked", why: "no copy" } as const);
  return { check, worst: "w", worstKind };
}

describe("topRiskOf", () => {
  it("is the first item of a ranked list", () => {
    expect(topRiskOf({ items: [P1_CHECKED, P3_CHECKED] })._unsafeUnwrap()).toBe(P1_CHECKED);
  });

  it("refuses an empty list", () => {
    expect(topRiskOf({ items: [] })._unsafeUnwrapErr().code).toBe("RISK_UNRANKED");
  });

  it("refuses a list ranked out of order, naming the item", () => {
    const error = topRiskOf({ items: [P3_CHECKED, P1_CHECKED] })._unsafeUnwrapErr();
    expect(error.message).toContain("item 2 is high after a low one");
  });

  it("accepts two items at the same level, the first one on top", () => {
    const second = { ...P2_CHECKED, worst: "a second worst case" };
    expect(topRiskOf({ items: [P2_CHECKED, second] })._unsafeUnwrap()).toBe(P2_CHECKED);
  });
});

describe("riskBadgeOf", () => {
  it("is red `high` for a top item that loses data", () => {
    const verdict = riskBadgeOf({ items: [P1_CHECKED] })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["high", "d73a49"]);
  });

  it("is amber `medium` for a checked break and green `low` for a checked tests-only item", () => {
    const medium = riskBadgeOf({ items: [P2_CHECKED] })._unsafeUnwrap();
    const low = riskBadgeOf({ items: [P3_CHECKED] })._unsafeUnwrap();
    expect([medium.message, medium.color, low.message, low.color]).toEqual(["medium", "dbab09", "low", "2ea44f"]);
  });

  it("turns an unchecked top item amber and says so", () => {
    const verdict = riskBadgeOf({
      items: [itemAt({ checked: false, worstKind: "only-tests-docs-or-dev-tooling" })],
    })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["low, unchecked", "dbab09"]);
  });

  it("refuses a hover longer than the cap", () => {
    const top: RiskItem = {
      check: { check: "c".repeat(300), kind: "checked" },
      worst: "w",
      worstKind: "only-tests-docs-or-dev-tooling",
    };
    expect(riskBadgeOf({ items: [top] })._unsafeUnwrapErr().code).toBe("HOVER_TOO_LONG");
  });

  it.each([
    { color: "d73a49", message: "high", worstKind: "loses-leaks-or-changes-off-machine" },
    { color: "dbab09", message: "medium", worstKind: "something-working-breaks" },
    { color: "2ea44f", message: "low", worstKind: "only-tests-docs-or-dev-tooling" },
  ] as const)("a checked $worstKind alone is $message", ({ worstKind, color, message }) => {
    const verdict = riskBadgeOf({ items: [itemAt({ checked: true, worstKind })] })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual([message, color]);
  });

  it("never demotes a red high to amber for an unchecked top item, and the hover says it was not checked", () => {
    const verdict = riskBadgeOf({
      items: [itemAt({ checked: false, worstKind: "loses-leaks-or-changes-off-machine" })],
    })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["high", "d73a49"]);
    expect(verdict.tooltip).toBe("Worst case w. Not checked: no copy.");
  });

  it("says an unchecked medium top item is unchecked, amber", () => {
    const verdict = riskBadgeOf({
      items: [itemAt({ checked: false, worstKind: "something-working-breaks" })],
    })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["medium, unchecked", "dbab09"]);
  });

  it("is decided by the top item alone, so an unchecked item below a checked one changes nothing", () => {
    const verdict = riskBadgeOf({ items: FIX_BODY.risk.items })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["medium", "dbab09"]);
  });

  it("hovers the top item's worst case and its check, each a sentence", () => {
    expect(riskBadgeOf({ items: [P3_CHECKED] })._unsafeUnwrap().tooltip).toBe(
      "Worst case a test passes for the wrong reason. Tests only, no app code changes.",
    );
  });

  it("accepts a hover of exactly the cap and refuses one character more, naming the badge and the length", () => {
    const at = ({ n }: { n: number }): RiskItem => ({
      check: { check: "c".repeat(n), kind: "checked" },
      worst: "w",
      worstKind: "only-tests-docs-or-dev-tooling",
    });
    expect(riskBadgeOf({ items: [at({ n: 185 })] })._unsafeUnwrap().tooltip.length).toBe(200);
    expect(riskBadgeOf({ items: [at({ n: 186 })] })._unsafeUnwrapErr()).toEqual({
      badge: "risk",
      code: "HOVER_TOO_LONG",
      length: 201,
      message: expect.any(String),
    });
  });
});

describe("problemBadgeOf", () => {
  it("is green with the short day for a seen problem", () => {
    const verdict = problemBadgeOf({ seen: TESTS_BODY.problemSeen })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["seen 16 Nov", "2ea44f"]);
  });

  it("is grey `not seen yet` for a not-seen one", () => {
    const verdict = problemBadgeOf({ seen: FEATURE_BODY.problemSeen })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["not seen yet", "6e7781"]);
  });

  it("refuses a malformed day", () => {
    const seen = { by: "agent", kind: "seen", on: "2026-13-45", what: "x" } as const;
    expect(problemBadgeOf({ seen })._unsafeUnwrapErr().code).toBe("INVALID_DAY");
  });

  it("refuses a day of the right shape that is not on the calendar, naming the field and the value", () => {
    const seen = { by: "agent", kind: "seen", on: "2026-02-30", what: "x" } as const;
    expect(problemBadgeOf({ seen })._unsafeUnwrapErr()).toEqual({
      code: "INVALID_DAY",
      field: "problemSeen.on",
      message: expect.any(String),
      value: "2026-02-30",
    });
  });

  it("refuses a day not written as YYYY-MM-DD", () => {
    const seen = { by: "agent", kind: "seen", on: "2026-1-5", what: "x" } as const;
    expect(problemBadgeOf({ seen })._unsafeUnwrapErr().code).toBe("INVALID_DAY");
  });

  it("prints the day of the month without a leading zero", () => {
    const seen = { by: "agent", kind: "seen", on: "2026-01-05", what: "x" } as const;
    expect(problemBadgeOf({ seen })._unsafeUnwrap().message).toBe("seen 5 Jan");
  });

  it("stays green however long ago the problem was seen, since the badge carries no age", () => {
    const seen = { by: "agent", kind: "seen", on: "2020-03-01", what: "x" } as const;
    const verdict = problemBadgeOf({ seen })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["seen 1 Mar", "2ea44f"]);
  });

  it("hovers the long day, what was seen and that nothing records who ran it", () => {
    expect(problemBadgeOf({ seen: TESTS_BODY.problemSeen })._unsafeUnwrap().tooltip).toBe(
      "Seen 16 Nov 2026: widget connect failed after consent on a personal account. Who ran it isn't recorded.",
    );
  });

  it("names an agent, or the owner, as who ran it", () => {
    const owner = {
      by: "owner",
      kind: "seen",
      on: "2026-11-16",
      what: "the store accepted the default password",
    } as const;
    expect(problemBadgeOf({ seen: FIX_BODY.problemSeen })._unsafeUnwrap().tooltip).toBe(
      "Seen 16 Nov 2026: the store accepted the default password. An agent ran it.",
    );
    expect(problemBadgeOf({ seen: owner })._unsafeUnwrap().tooltip).toBe(
      "Seen 16 Nov 2026: the store accepted the default password. The owner ran it.",
    );
  });

  it("hovers why a problem was not seen yet, as a sentence", () => {
    expect(problemBadgeOf({ seen: FEATURE_BODY.problemSeen })._unsafeUnwrap().tooltip).toBe(
      "Not seen on a real sign-in yet.",
    );
  });

  it("refuses a not-seen reason whose hover runs past the cap, naming the problem badge", () => {
    const seen = { kind: "not-seen", why: "x".repeat(200) } as const;
    expect(problemBadgeOf({ seen })._unsafeUnwrapErr()).toEqual({
      badge: "problem",
      code: "HOVER_TOO_LONG",
      length: 201,
      message: expect.any(String),
    });
  });
});

describe("plainTextOf", () => {
  it("joins every run's text", () => {
    expect(plainTextOf({ content: [...t({ text: "a " }), { kind: "code", text: "b" }] })).toBe("a b");
  });

  it("is empty for an empty cell", () => {
    expect(plainTextOf({ content: [] })).toBe("");
  });
});

describe("proofBadgeOf and proofStateOf", () => {
  it("reads two screenshots as green `problem and solution`", () => {
    const verdict = proofBadgeOf({ body: TESTS_BODY, layout: 2 })._unsafeUnwrap();
    expect([verdict.message, verdict.color, proofStateOf({ body: TESTS_BODY })]).toEqual([
      "problem and solution",
      "2ea44f",
      "problem and solution",
    ]);
  });

  it("reads a solution screenshot with a problem reason as green `solution only`", () => {
    expect(proofStateOf({ body: FEATURE_BODY })).toBe("solution only");
  });

  it("reads two reasons on a change nothing on screen shows as grey `tests only`", () => {
    const verdict = proofBadgeOf({ body: TESTS_ONLY_BODY, layout: 2 })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["tests only", "6e7781"]);
  });

  it("reads two reasons on a visible change as amber `not run yet`", () => {
    const body = { ...TESTS_ONLY_BODY, visualProof: "screen-change" } as const;
    expect([proofStateOf({ body }), proofBadgeOf({ body, layout: 2 })._unsafeUnwrap().color]).toEqual([
      "not run yet",
      "dbab09",
    ]);
  });

  it("reads a problem screenshot with a solution reason as amber `problem only`", () => {
    const body = { ...FIX_BODY, solutionProof: TESTS_ONLY_BODY.solutionProof };
    expect([proofStateOf({ body }), proofBadgeOf({ body, layout: 2 })._unsafeUnwrap().color]).toEqual([
      "problem only",
      "dbab09",
    ]);
  });

  it("hovers two screenshots run by one actor as real runs by that actor", () => {
    expect(proofBadgeOf({ body: TESTS_BODY, layout: 2 })._unsafeUnwrap().tooltip).toBe(
      "Screenshots of the problem before this change and the solution after it, from real runs by the owner.",
    );
  });

  it("names each actor when two different ones ran the two screenshots", () => {
    const body = { ...TESTS_BODY, solutionProof: FIX_BODY.solutionProof };
    expect(proofBadgeOf({ body, layout: 2 })._unsafeUnwrap().tooltip).toBe(
      "Screenshots of the problem before this change, run by the owner, and the solution after it, run by an agent.",
    );
  });

  it("hovers a solution-only proof with the reason the problem was not captured, green", () => {
    const verdict = proofBadgeOf({ body: FEATURE_BODY, layout: 2 })._unsafeUnwrap();
    expect(verdict.color).toBe("2ea44f");
    expect(verdict.tooltip).toBe(
      "A screenshot of the solution from a real run by an agent. The problem wasn't captured: Not captured yet: " +
        "the 7-day expiry has to pass first.",
    );
  });

  it("hovers tests only with the solution's own reason, claiming nothing about the screen", () => {
    expect(proofBadgeOf({ body: TESTS_ONLY_BODY, layout: 2 })._unsafeUnwrap().tooltip).toBe(
      "No screenshots. The store reads the same before and after, so there is nothing to show.",
    );
  });

  it("keeps a layout-1 body's tests-only hover as it was published", () => {
    expect(proofBadgeOf({ body: TESTS_ONLY_BODY, layout: 1 })._unsafeUnwrap().tooltip).toBe(
      "No screenshots, since nothing on screen changes. The store reads the same before and after, so there is " +
        "nothing to show.",
    );
  });

  it("closes a reason that carries no full stop with one", () => {
    const body = {
      ...TESTS_ONLY_BODY,
      solutionProof: { kind: "reason", reason: t({ text: "Waiting on a staging deploy" }) },
      visualProof: "screen-change",
    } as const;
    expect(proofBadgeOf({ body, layout: 2 })._unsafeUnwrap().tooltip).toBe(
      "Not run for real yet: Waiting on a staging deploy.",
    );
  });

  it("reads two quotes as green `problem and solution`, whatever the screen claim", () => {
    const shown = { ...QUOTE_BODY, visualProof: "screen-change" } as const;
    expect([proofStateOf({ body: QUOTE_BODY }), proofStateOf({ body: shown })]).toEqual([
      "problem and solution",
      "problem and solution",
    ]);
    expect(proofBadgeOf({ body: QUOTE_BODY, layout: 2 })._unsafeUnwrap().color).toBe("2ea44f");
  });

  it("hovers a quote beside a reason with its medium and the nothing-on-screen marker before the reason", () => {
    const body = { ...QUOTE_BODY, solutionProof: TESTS_ONLY_BODY.solutionProof };
    const verdict = proofBadgeOf({ body, layout: 2 })._unsafeUnwrap();
    expect([proofStateOf({ body }), verdict.tooltip]).toEqual([
      "problem only",
      "Quoted output of the problem from a real run by an agent. Nothing on screen changes. The solution isn't " +
        "shown yet: The store reads the same before and after, so there is nothing to show.",
    ]);
  });

  it("leaves a screenshot-only hover byte-identical when no slot is a quote", () => {
    const body = { ...QUOTE_BODY, problemProof: TESTS_BODY.problemProof, solutionProof: FIX_BODY.solutionProof };
    expect(proofBadgeOf({ body, layout: 2 })._unsafeUnwrap().tooltip).toBe(
      "Screenshots of the problem before this change, run by the owner, and the solution after it, run by an agent.",
    );
  });

  it("refuses a reason whose hover runs past the cap, naming the proof badge", () => {
    const body = {
      ...TESTS_ONLY_BODY,
      solutionProof: { kind: "reason", reason: t({ text: "r".repeat(200) }) },
    } as const;
    expect(proofBadgeOf({ body, layout: 2 })._unsafeUnwrapErr()).toEqual({
      badge: "proof",
      code: "HOVER_TOO_LONG",
      length: 217,
      message: expect.any(String),
    });
  });
});
