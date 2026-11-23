import { describe, expect, it } from "vitest";

import {
  plainProblemStatus,
  plainRiskVerdict,
  problemStatus,
  riskVerdict,
  solvedVerdict,
  stampPrForm,
} from "../../../../../outbound/github/legacy/derive.js";
import type { PrFormDraft, RiskItem } from "../../../../../outbound/github/legacy/types.js";
import { FULL_BODY, GOLD_REVIEW, MINIMAL_BODY, P3_UNCHECKED, PROVEN, t } from "./fixtures.js";

const P2_CHECKED: RiskItem = {
  check: { check: t({ text: "the round-trip test" }), kind: "checked" },
  impact: "medium",
  likelihood: "low",
  priority: 2,
  reach: t({ text: "every reviewer" }),
  worst: t({ text: "A body parses into the wrong form" }),
};

describe("riskVerdict", () => {
  it("is red `high` for a P1 top item and counts the unchecked P0-P3 items", () => {
    const verdict = riskVerdict({ items: FULL_BODY.risk.items })._unsafeUnwrap();
    expect([verdict.message, verdict.color, verdict.line, verdict.unchecked]).toEqual([
      "high",
      "d73a49",
      "Risk: high, 1 unchecked.",
      1,
    ]);
  });

  it("is green `low` for a checked P4 item", () => {
    const verdict = riskVerdict({ items: MINIMAL_BODY.risk.items })._unsafeUnwrap();
    expect([verdict.message, verdict.color, verdict.line]).toEqual(["low", "2ea44f", "Risk: low."]);
  });

  it("is amber `unchecked` when no item carries a check", () => {
    const verdict = riskVerdict({ items: [{ ...P3_UNCHECKED, priority: 4 }] })._unsafeUnwrap();
    expect([verdict.message, verdict.color, verdict.line]).toEqual(["unchecked", "dbab09", "Risk: low, none checked."]);
  });

  it("refuses an empty list and one ranked out of order", () => {
    expect(riskVerdict({ items: [] })._unsafeUnwrapErr().code).toBe("RISK_UNRANKED");
    expect(riskVerdict({ items: [P3_UNCHECKED, FULL_BODY.risk.items[0]!] })._unsafeUnwrapErr().code).toBe(
      "RISK_UNRANKED",
    );
  });
});

describe("plainRiskVerdict", () => {
  it("steps a fully proven medium risk down to low and says so on the line", () => {
    const verdict = plainRiskVerdict({
      blastRadius: t({ text: "Every body." }),
      claims: [PROVEN],
      items: [P2_CHECKED],
    })._unsafeUnwrap();
    expect([verdict.message, verdict.color, verdict.line]).toEqual(["low", "2ea44f", "Risk: low."]);
  });

  it("keeps a medium risk medium when nothing was tested", () => {
    const verdict = plainRiskVerdict({
      blastRadius: t({ text: "Every body." }),
      claims: [],
      items: [P2_CHECKED],
    })._unsafeUnwrap();
    expect([verdict.message, verdict.color, verdict.line]).toEqual(["medium", "dbab09", "Risk: medium."]);
  });

  it("refuses an unranked list with the legacy refusal", () => {
    expect(plainRiskVerdict({ blastRadius: t({ text: "x" }), claims: [], items: [] })._unsafeUnwrapErr().code).toBe(
      "RISK_UNRANKED",
    );
  });
});

describe("problemStatus", () => {
  it("is red `unevidenced` for a problem nobody saw", () => {
    const verdict = problemStatus({ seen: { kind: "unevidenced" }, writtenOn: "2026-10-01" })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["unevidenced", "d73a49"]);
  });

  it("is green when seen within 15 days of the write and amber after that", () => {
    const seen = { kind: "seen", on: "2026-09-20" } as const;
    const fresh = problemStatus({ seen, writtenOn: "2026-10-05" })._unsafeUnwrap();
    const stale = problemStatus({ seen, writtenOn: "2026-10-06" })._unsafeUnwrap();
    expect([fresh.message, fresh.color, stale.message, stale.color]).toEqual([
      "seen 20 Sep",
      "2ea44f",
      "last seen 20 Sep",
      "dbab09",
    ]);
  });

  it("refuses a malformed write day and a seen day after the write", () => {
    const seen = { kind: "seen", on: "2026-09-20" } as const;
    expect(problemStatus({ seen, writtenOn: "2026-02-31" })._unsafeUnwrapErr().code).toBe("INVALID_DAY");
    expect(problemStatus({ seen, writtenOn: "2026-09-01" })._unsafeUnwrapErr().code).toBe("SEEN_AFTER_WRITTEN");
  });
});

describe("plainProblemStatus", () => {
  it("keeps the legacy colour and refuses what the legacy derivation refuses", () => {
    const seen = { kind: "seen", on: "2026-09-20" } as const;
    const ok = plainProblemStatus({
      evidence: undefined,
      problem: t({ text: "The table comes first." }),
      seen,
      writtenOn: "2026-10-01",
    })._unsafeUnwrap();
    expect(ok.color).toBe("2ea44f");
    expect(
      plainProblemStatus({
        evidence: undefined,
        problem: t({ text: "x" }),
        seen,
        writtenOn: "2026-09-01",
      })._unsafeUnwrapErr().code,
    ).toBe("SEEN_AFTER_WRITTEN");
  });
});

describe("solvedVerdict", () => {
  it("shows unproven red when nothing is claimed", () => {
    const verdict = solvedVerdict({ claims: [], review: GOLD_REVIEW });
    expect([verdict.message, verdict.color, verdict.shown]).toEqual(["unproven", "d73a49", "unproven"]);
  });

  it("shows unproven when nobody reviewed, even with a proven claim", () => {
    expect(solvedVerdict({ claims: [PROVEN], review: undefined }).shown).toBe("unproven");
  });

  it("shows the reviewer's grade and counts the gaps", () => {
    const gap = { claim: t({ text: "c" }), proof: { kind: "gap", why: t({ text: "w" }) } } as const;
    const verdict = solvedVerdict({ claims: [PROVEN, gap], review: GOLD_REVIEW });
    expect([verdict.message, verdict.color, verdict.gaps]).toEqual(["gold · 1 gap", "ffd700", 1]);
  });

  it("pins a body with a failed claim to unproven whatever the review says", () => {
    const failed = { claim: t({ text: "c" }), proof: { kind: "failed", why: t({ text: "w" }) } } as const;
    expect(solvedVerdict({ claims: [PROVEN, failed], review: GOLD_REVIEW }).shown).toBe("unproven");
  });
});

/* The cases below are the reading-order derive cases the pre-C3 suite carried, kept against the frozen module. */

const RED = "d73a49";
const AMBER = "dbab09";
const GREEN = "2ea44f";

const P1_CHECKED: RiskItem = { ...P2_CHECKED, impact: "high", priority: 1 };
const GAP = { claim: t({ text: "Old bodies convert." }), proof: { kind: "gap", why: t({ text: "w" }) } } as const;
const FAILED = { claim: t({ text: "It refuses." }), proof: { kind: "failed", why: t({ text: "w" }) } } as const;

/** A checked item at a priority. */
function checkedAt({ priority }: { priority: 0 | 1 | 2 | 3 | 4 }): RiskItem {
  return { ...P2_CHECKED, priority };
}

describe("plainRiskVerdict — proof moves the level one step at most", () => {
  const reach = t({ text: "Only the test suite." });

  it.each([
    ["a P1 item, everything tested, reads medium, never low", [PROVEN], "medium"],
    ["a P1 item with a claim nobody tested stays high", [PROVEN, GAP], "high"],
    ["a P1 item with a failed claim stays high", [FAILED], "high"],
    ["a P1 item with no claims stays high", [], "high"],
  ] as const)("%s", (_name, claims, level) => {
    expect(
      plainRiskVerdict({ blastRadius: reach, claims: [...claims], items: [P1_CHECKED] })._unsafeUnwrap().level,
    ).toBe(level);
  });

  it("does not step down when a lower-priority risk has no check", () => {
    const verdict = plainRiskVerdict({ blastRadius: reach, claims: [PROVEN], items: [P2_CHECKED, P3_UNCHECKED] });
    expect(verdict._unsafeUnwrap().level).toBe("medium");
  });

  it("leads the hover with where it reaches and carries no priority, grade or gap count", () => {
    const { tooltip } = plainRiskVerdict({
      blastRadius: reach,
      claims: [PROVEN, GAP],
      items: [P1_CHECKED],
    })._unsafeUnwrap();
    expect(tooltip.startsWith("Reaches: Only the test suite.")).toBe(true);
    expect([/\bP\d\b/u, /gold|silver|bronze|unproven/u, /\bgaps?\b/u].filter((re) => re.test(tooltip))).toEqual([]);
  });
});

describe("plainProblemStatus — when the problem was last seen, in plain words", () => {
  const problem = t({ text: "Two alerts never reach a channel. More detail." });
  const evidence = t({ text: "the monitor's empty history" });

  it("says last seen and the evidence line, green when recent", () => {
    const verdict = plainProblemStatus({
      evidence,
      problem,
      seen: { kind: "seen", on: "2026-10-03" },
      writtenOn: "2026-10-09",
    })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["last seen 3 Oct", GREEN]);
    expect(verdict.tooltip).toContain("the monitor's empty history");
  });

  it("asks a reader to check an old sighting still happens, amber", () => {
    const verdict = plainProblemStatus({
      evidence,
      problem,
      seen: { kind: "seen", on: "2026-09-01" },
      writtenOn: "2026-10-09",
    })._unsafeUnwrap();
    expect([verdict.color, verdict.tooltip.includes("check it still happens")]).toEqual([AMBER, true]);
  });

  it("says no evidence yet and quotes the Problem cell's first sentence", () => {
    const verdict = plainProblemStatus({
      evidence: undefined,
      problem,
      seen: { kind: "unevidenced" },
      writtenOn: "2026-10-09",
    })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["no evidence yet", RED]);
    expect(verdict.tooltip).toContain("Two alerts never reach a channel.");
    expect(verdict.tooltip).not.toMatch(/unevidenced|assertion/u);
  });
});

describe("riskVerdict — the top item decides, an unchecked P0-P3 item turns a non-red badge amber", () => {
  it.each([
    { color: RED, message: "high", priority: 0 },
    { color: RED, message: "high", priority: 1 },
    { color: AMBER, message: "medium", priority: 2 },
    { color: GREEN, message: "low", priority: 3 },
    { color: GREEN, message: "low", priority: 4 },
  ] as const)("a checked P$priority alone is $message", ({ priority, color, message }) => {
    const verdict = riskVerdict({ items: [checkedAt({ priority })] })._unsafeUnwrap();
    expect([verdict.message, verdict.color, verdict.top]).toEqual([message, color, priority]);
  });

  it("an unchecked P3 turns a low badge amber and says so on the bold line", () => {
    const verdict = riskVerdict({ items: [P3_UNCHECKED] })._unsafeUnwrap();
    expect([verdict.message, verdict.color, verdict.unchecked, verdict.line]).toEqual([
      "unchecked",
      AMBER,
      1,
      "Risk: low, 1 unchecked.",
    ]);
    expect(verdict.tooltip).toBe(
      "Risk if this merges · top item P3; 1 of 1 item at P0-P3 has no check · an item with no check is a guess, not a finding",
    );
  });

  it("does not count an unchecked P4 beside a checked item", () => {
    const verdict = riskVerdict({ items: [checkedAt({ priority: 3 }), { ...P3_UNCHECKED, priority: 4 }] });
    const { message, color, unchecked, line, tooltip } = verdict._unsafeUnwrap();
    expect([message, color, unchecked, line]).toEqual(["low", GREEN, 0, "Risk: low."]);
    expect(tooltip).toBe(
      "Risk if this merges · top item P3; 0 of 1 item at P0-P3 have no check · an item with no check is a guess, not a finding",
    );
  });

  it("says no item at any priority has a check when none does", () => {
    const unchecked = { ...P3_UNCHECKED, priority: 4 } as const;
    expect(riskVerdict({ items: [unchecked, unchecked] })._unsafeUnwrap().tooltip).toBe(
      "Risk if this merges · top item P4; no item at any priority has a check · an item with no check is a guess, not a finding",
    );
  });

  it("never demotes red to amber for an unchecked item", () => {
    const verdict = riskVerdict({ items: [P1_CHECKED, P3_UNCHECKED] })._unsafeUnwrap();
    expect([verdict.message, verdict.color, verdict.line]).toEqual(["high", RED, "Risk: high, 1 unchecked."]);
    expect(verdict.tooltip).toBe(
      "Risk if this merges · top item P1; 1 of 2 items at P0-P3 has no check · an item with no check is a guess, not a finding",
    );
  });

  it("names the item ranked out of order", () => {
    expect(riskVerdict({ items: [P3_UNCHECKED, P1_CHECKED] })._unsafeUnwrapErr().message).toContain(
      "item 2 is P1 after P3",
    );
  });
});

describe("problemStatus — seen within 15 UTC days is green", () => {
  it("is green at exactly 15 days, across a month boundary", () => {
    const verdict = problemStatus({
      seen: { kind: "seen", on: "2026-09-16" },
      writtenOn: "2026-10-01",
    })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["seen 16 Sep", GREEN]);
    expect(verdict.tooltip).toBe(
      "When the problem was last seen · seen 2026-09-16, written 2026-10-01, 15 days apart; green within 15 " +
        "(Datadog retention) · older evidence may have rotated out",
    );
  });

  it("is amber at 16 days", () => {
    const verdict = problemStatus({
      seen: { kind: "seen", on: "2026-09-15" },
      writtenOn: "2026-10-01",
    })._unsafeUnwrap();
    expect([verdict.message, verdict.color]).toEqual(["last seen 15 Sep", AMBER]);
  });

  it("says 1 day, singular", () => {
    const verdict = problemStatus({
      seen: { kind: "seen", on: "2026-09-30" },
      writtenOn: "2026-10-01",
    })._unsafeUnwrap();
    expect(verdict.tooltip).toContain("written 2026-10-01, 1 day apart;");
  });

  it("refuses a day that is not on the calendar, naming it", () => {
    const refused = problemStatus({ seen: { kind: "seen", on: "2026-02-30" }, writtenOn: "2026-10-01" });
    expect(refused._unsafeUnwrapErr().message).toBe(
      'problemSeen.on is "2026-02-30", which is not a real YYYY-MM-DD calendar day',
    );
  });
});

describe("solvedVerdict — unproven red until the floor clears AND a review exists", () => {
  it("hovers not yet reviewed, never a grey unreviewed", () => {
    expect(solvedVerdict({ claims: [PROVEN], review: undefined }).tooltip).toBe(
      "Reviewer verdict on the claims · not yet reviewed; 0 gaps · a gap is a claim nobody checked",
    );
  });

  it("counts two gaps plural", () => {
    const verdict = solvedVerdict({ claims: [PROVEN, GAP, GAP], review: { ...GOLD_REVIEW, grade: "silver" } });
    expect([verdict.message, verdict.gaps]).toEqual(["silver · 2 gaps", 2]);
  });
});

describe("stampPrForm", () => {
  const { writtenOn: _writtenOn, ...stampedFields } = FULL_BODY;
  const draft: PrFormDraft = {
    ...stampedFields,
    draft: true,
    target: { base: "main", head: "h", owner: "acme", repo: "widgets" },
    title: "A title",
  };

  it("stamps the draft with the door's day", () => {
    expect(stampPrForm({ draft, writtenOn: "2026-10-01" })._unsafeUnwrap().writtenOn).toBe("2026-10-01");
  });

  it("refuses a day before the problem was seen", () => {
    expect(stampPrForm({ draft, writtenOn: "2026-09-01" })._unsafeUnwrapErr().code).toBe("SEEN_AFTER_WRITTEN");
  });
});
