import { describe, expect, it } from "vitest";

import {
  HOVER_MAX,
  problemHover,
  proofHover,
  readNotSeenHover,
  readProofActors,
  readRiskHover,
  readSeenHover,
  readsNothingOnScreen,
  riskHover,
} from "../../../../outbound/github/tooltips.js";
import type { RiskItem } from "../../../../outbound/github/types.js";

const CHECKED: RiskItem = {
  check: { check: "Tests cover it", kind: "checked" },
  worst: "a widget is lost",
  worstKind: "something-working-breaks",
};
const UNCHECKED: RiskItem = {
  check: { kind: "unchecked", why: "no staging copy" },
  worst: "a widget is lost",
  worstKind: "only-tests-docs-or-dev-tooling",
};

describe("HOVER_MAX", () => {
  it("is the conservative 200-character cap", () => {
    expect(HOVER_MAX).toBe(200);
  });
});

describe("riskHover and readRiskHover", () => {
  it("writes a checked top item as worst case then the check", () => {
    expect(riskHover({ top: CHECKED })).toBe("Worst case a widget is lost. Tests cover it.");
  });

  it("writes an unchecked top item as worst case then Not checked", () => {
    expect(riskHover({ top: UNCHECKED })).toBe("Worst case a widget is lost. Not checked: no staging copy.");
  });

  it("reads both templates back to the fields they carry", () => {
    expect([
      readRiskHover({ text: riskHover({ top: CHECKED }) }),
      readRiskHover({ text: riskHover({ top: UNCHECKED }) }),
    ]).toEqual([
      { check: { check: "Tests cover it", kind: "checked" }, worst: "a widget is lost" },
      { check: { kind: "unchecked", why: "no staging copy" }, worst: "a widget is lost" },
    ]);
  });

  it("reads text that is not the template as undefined", () => {
    expect(readRiskHover({ text: "Something else." })).toBe(undefined);
  });
});

describe("problemHover and its readers", () => {
  it("writes a seen problem with its day, what was seen and who ran it", () => {
    const seen = { by: "agent", kind: "seen", on: "2026-11-16", what: "connect failed" } as const;
    expect(problemHover({ seen })).toBe("Seen 16 Nov 2026: connect failed. An agent ran it.");
  });

  it("round-trips every actor through readSeenHover", () => {
    const seens = (["agent", "owner", "unrecorded"] as const).map((by) => ({
      by,
      kind: "seen" as const,
      on: "2026-11-16",
      what: "connect failed",
    }));
    expect(seens.map((seen) => readSeenHover({ text: problemHover({ seen }) }))).toEqual(seens);
  });

  it("refuses a seen hover whose day is not a real day", () => {
    expect(readSeenHover({ text: "Seen 31 Feb 2026: x. An agent ran it." })).toBe(undefined);
  });

  it("writes a not-seen problem as its reason with a full stop, and reads it back", () => {
    const seen = { kind: "not-seen", why: "Not seen on a real run yet" } as const;
    expect([problemHover({ seen }), readNotSeenHover({ text: "Not seen on a real run yet." })]).toEqual([
      "Not seen on a real run yet.",
      seen,
    ]);
  });

  it("refuses a not-seen hover without the closing full stop", () => {
    expect([readNotSeenHover({ text: "no stop" }), readNotSeenHover({ text: "." })]).toEqual([undefined, undefined]);
  });
});

describe("proofHover and readProofActors", () => {
  it("names one actor when both screenshots were run by the same one", () => {
    const text = proofHover({ input: { kind: "both", problemBy: "owner", solutionBy: "owner" }, layout: 2 });
    expect(text).toBe(
      "Screenshots of the problem before this change and the solution after it, from real runs by the owner.",
    );
    expect(readProofActors({ text })).toEqual({ problemBy: "owner", solutionBy: "owner" });
  });

  it("names both actors when they differ", () => {
    const text = proofHover({ input: { kind: "both", problemBy: "owner", solutionBy: "agent" }, layout: 2 });
    expect(readProofActors({ text })).toEqual({ problemBy: "owner", solutionBy: "agent" });
  });

  it("reads the solution actor alone from a solution-only hover", () => {
    const text = proofHover({
      input: { kind: "solution-only", problemReason: "no repro", solutionBy: "agent" },
      layout: 2,
    });
    expect([text, readProofActors({ text })]).toEqual([
      "A screenshot of the solution from a real run by an agent. The problem wasn't captured: no repro.",
      { problemBy: undefined, solutionBy: "agent" },
    ]);
  });

  it("reads the problem actor alone from a problem-only hover", () => {
    const text = proofHover({
      input: { kind: "problem-only", problemBy: "owner", solutionReason: "Not built yet!" },
      layout: 2,
    });
    expect([text, readProofActors({ text })]).toEqual([
      "A screenshot of the problem from a real run by the owner. The solution isn't shown yet: Not built yet!",
      { problemBy: "owner", solutionBy: undefined },
    ]);
  });

  it("writes the two no-screenshot hovers and reads no actor from them", () => {
    const testsOnly = proofHover({ input: { kind: "tests-only", solutionReason: " A refactor " }, layout: 2 });
    const notRun = proofHover({ input: { kind: "not-run", solutionReason: "waiting on review" }, layout: 2 });
    expect([testsOnly, notRun, readProofActors({ text: notRun })]).toEqual([
      "No screenshots. A refactor.",
      "Not run for real yet: waiting on review.",
      { problemBy: undefined, solutionBy: undefined },
    ]);
  });

  it("names each shown side's medium when one is a quote, and reads both actors back", () => {
    const text = proofHover({
      input: {
        kind: "both",
        problemBy: "owner",
        quoted: { nothingOnScreen: false, problem: false, solution: true },
        solutionBy: "agent",
      },
      layout: 2,
    });
    expect([text, readProofActors({ text }), readsNothingOnScreen({ text })]).toEqual([
      "A screenshot of the problem before this change, run by the owner, and quoted output of the solution after " +
        "it, run by an agent.",
      { problemBy: "owner", solutionBy: "agent" },
      false,
    ]);
  });

  it("says nothing on screen changes on two quotes' hover, and reads it back", () => {
    const text = proofHover({
      input: {
        kind: "both",
        problemBy: "agent",
        quoted: { nothingOnScreen: true, problem: true, solution: true },
        solutionBy: "agent",
      },
      layout: 2,
    });
    expect([text, readProofActors({ text }), readsNothingOnScreen({ text })]).toEqual([
      "Quoted output of the problem before this change, run by an agent, and quoted output of the solution after " +
        "it, run by an agent. Nothing on screen changes.",
      { problemBy: "agent", solutionBy: "agent" },
      true,
    ]);
  });

  it("puts the marker before a one-side quote's reason, so a reason ending the same way is never read as it", () => {
    const solution = proofHover({
      input: {
        kind: "solution-only",
        problemReason: "Nothing on screen changes.",
        quoted: { nothingOnScreen: false },
        solutionBy: "owner",
      },
      layout: 2,
    });
    const problem = proofHover({
      input: {
        kind: "problem-only",
        problemBy: "agent",
        quoted: { nothingOnScreen: true },
        solutionReason: "not built",
      },
      layout: 2,
    });
    expect([solution, readsNothingOnScreen({ text: solution }), readProofActors({ text: solution })]).toEqual([
      "Quoted output of the solution from a real run by the owner. The problem wasn't captured: Nothing on screen " +
        "changes.",
      false,
      { problemBy: undefined, solutionBy: "owner" },
    ]);
    expect([problem, readsNothingOnScreen({ text: problem }), readProofActors({ text: problem })]).toEqual([
      "Quoted output of the problem from a real run by an agent. Nothing on screen changes. The solution isn't " +
        "shown yet: not built.",
      true,
      { problemBy: "agent", solutionBy: undefined },
    ]);
  });

  it("reads no marker off a screenshot or tests-only hover", () => {
    const shots = proofHover({ input: { kind: "both", problemBy: "owner", solutionBy: "owner" }, layout: 2 });
    const testsOnly = proofHover({ input: { kind: "tests-only", solutionReason: "A refactor" }, layout: 2 });
    expect([readsNothingOnScreen({ text: shots }), readsNothingOnScreen({ text: testsOnly })]).toEqual([false, false]);
  });

  it("writes a layout-1 tests-only hover with the screen claim it was published with", () => {
    expect(proofHover({ input: { kind: "tests-only", solutionReason: "A refactor" }, layout: 1 })).toBe(
      "No screenshots, since nothing on screen changes. A refactor.",
    );
  });
});
