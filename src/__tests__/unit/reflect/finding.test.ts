import { describe, expect, it } from "vitest";

import {
  clampDial,
  classKeyOf,
  type FrictionFinding,
  findingId,
  findingPattern,
  hasConsequence,
  namedClassOf,
  namedClassOrOther,
  patternSentence,
  recurringImpact,
  scoreOf,
} from "../../../reflect/finding.js";

const finding = (over: Partial<FrictionFinding> = {}): FrictionFinding => ({
  classKey: "donewhen-probe-named-a-flag-that-does-not-exist",
  consequence: "a measured cost",
  cost: 2,
  coveredBy: [],
  evidence: ["one"],
  firstSeenIso: "2026-08-27T01:00:00.000Z",
  impact: 3,
  knownBy: [],
  refutedBy: [],
  lastSeenIso: "2026-08-27T02:00:00.000Z",
  locus: "handover amend",
  occurrences: 6,
  safety: 4,
  source: "run-journal",
  summary: "6 run(s) amended a live brief over the same thing",
  ...over,
});

describe("findingId", () => {
  it("is unchanged when only the count moves", () => {
    const before = findingId({ signal: finding({ occurrences: 6 }) });
    const after = findingId({ signal: finding({ occurrences: 41 }) });
    expect(after).toBe(before);
  });

  it("is unchanged when only the timestamps and the summary move", () => {
    const before = findingId({ signal: finding() });
    const after = findingId({
      signal: finding({
        firstSeenIso: "2026-09-01T00:00:00.000Z",
        lastSeenIso: "2026-09-02T00:00:00.000Z",
        summary: "41 run(s) amended a live brief over the same thing",
      }),
    });
    expect(after).toBe(before);
  });

  it("changes when the class changes", () => {
    const before = findingId({ signal: finding() });
    const after = findingId({ signal: finding({ classKey: "donewhen-probes-registered-after-the-run-opened" }) });
    expect(after).not.toBe(before);
  });

  it("changes when the locus changes", () => {
    const before = findingId({ signal: finding() });
    expect(findingId({ signal: finding({ locus: "handover abandoned" }) })).not.toBe(before);
  });

  it("changes when the source changes", () => {
    const before = findingId({ signal: finding() });
    expect(findingId({ signal: finding({ source: "dev-gate" }) })).not.toBe(before);
  });

  it("is twelve hex characters", () => {
    expect(findingId({ signal: finding() })).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("classKeyOf", () => {
  it("drops stopwords, short tokens and identifiers", () => {
    expect(classKeyOf({ text: "the probe was 4471 for abc1234def and failed" })).toBe("failed-probe");
  });

  it("is order-independent, so a re-wording of the same words is the same class", () => {
    expect(classKeyOf({ text: "probe failed loudly" })).toBe(classKeyOf({ text: "loudly failed probe" }));
  });

  it("returns the empty string when nothing is classifiable", () => {
    expect(classKeyOf({ text: "the and 12 99" })).toBe("");
  });

  it("keeps at most the requested number of tokens", () => {
    expect(classKeyOf({ limit: 2, text: "alphaaaaa betaaaaaa gammaaaaa deltaaaaa" }).split("-")).toHaveLength(2);
  });
});

describe("namedClassOf", () => {
  it("merges two differently-worded reports of the vitest --filter probe defect", () => {
    const first = namedClassOf({
      text: "the doneWhen probe spelled a vitest flag that does not exist (--filter)",
    });
    const second = namedClassOf({
      text: "doneWhen probe used vitest's non-existent --filter flag; fixed to the positional filter syntax",
    });
    expect(first).toBe("donewhen-probe-named-a-flag-that-does-not-exist");
    expect(second).toBe("donewhen-probe-named-a-flag-that-does-not-exist");
  });

  it("separates a late probe registration from the flag defect", () => {
    expect(namedClassOf({ text: "registered four doneWhen probes now the port's shape is known" })).toBe(
      "donewhen-probes-registered-after-the-run-opened",
    );
  });

  it("falls back to the general key when no named class matches", () => {
    const text = "the corpus watermark advanced past a channel nobody crawled";
    expect(namedClassOf({ text })).toBe(classKeyOf({ text }));
  });

  it("merges two differently-worded scope-change amendments into one key", () => {
    const first = namedClassOf({ text: "supervisor added #16357 to scope mid-run; registered new probes" });
    const second = namedClassOf({ text: "Owner expanded scope mid-run: also design additional posting shapes" });
    expect(first).toBe("scope-changed-mid-run");
    expect(second).toBe("scope-changed-mid-run");
  });

  it("merges two differently-worded correction amendments into one key", () => {
    const first = namedClassOf({ text: "corrected the case, no scope change" });
    const second = namedClassOf({ text: "CORRECTION to the previous amendment: item (3) lost a fragment" });
    expect(first).toBe("a-correction-was-recorded");
    expect(second).toBe("a-correction-was-recorded");
  });
});

describe("namedClassOrOther", () => {
  it("matches a named class exactly as namedClassOf does", () => {
    const text = "registered four doneWhen probes now the port's shape is known";
    expect(namedClassOrOther({ other: "other-amendment-reason", text })).toBe(
      "donewhen-probes-registered-after-the-run-opened",
    );
  });

  it("merges two UNRELATED free-worded reasons into the same other key, where namedClassOf would mint two", () => {
    const first = "wrote the four TLDRs to a durable artifact and linked it, so the deliverable survives";
    const second = "fixed the plan's landing order after Codex flagged a missing phase boundary";
    expect(namedClassOf({ text: first })).not.toBe(namedClassOf({ text: second }));
    expect(namedClassOrOther({ other: "other-amendment-reason", text: first })).toBe("other-amendment-reason");
    expect(namedClassOrOther({ other: "other-amendment-reason", text: second })).toBe("other-amendment-reason");
  });

  it("never falls back to the general token key", () => {
    const text = "wrote the four TLDRs to a durable artifact and linked it, so the deliverable survives";
    expect(namedClassOrOther({ other: "other-amendment-reason", text })).not.toBe(classKeyOf({ text }));
  });
});

describe("scoreOf and clampDial", () => {
  it("is impact times safety over cost", () => {
    expect(scoreOf({ finding: finding({ cost: 2, impact: 3, safety: 4 }) })).toBe(6);
  });

  it("clamps a dial into one and five", () => {
    expect(clampDial({ value: 0 })).toBe(1);
    expect(clampDial({ value: 9 })).toBe(5);
    expect(clampDial({ value: -4 })).toBe(1);
  });
});

describe("recurringImpact", () => {
  it("leaves a single one-off sighting alone", () => {
    expect(recurringImpact({ base: 3, daysSeen: 1, occurrences: 1 })).toBe(3);
  });

  it("lifts once for a repeat within the window", () => {
    expect(recurringImpact({ base: 3, daysSeen: 1, occurrences: 3 })).toBe(4);
  });

  it("lifts twice for a flood within the window", () => {
    expect(recurringImpact({ base: 2, daysSeen: 1, occurrences: 10 })).toBe(4);
  });

  it("lifts for a finding that survived a night", () => {
    expect(recurringImpact({ base: 2, daysSeen: 2, occurrences: 1 })).toBe(3);
  });

  it("lifts twice for a chronic finding", () => {
    expect(recurringImpact({ base: 2, daysSeen: 5, occurrences: 1 })).toBe(4);
  });

  it("never exceeds the dial ceiling", () => {
    expect(recurringImpact({ base: 4, daysSeen: 5, occurrences: 10 })).toBe(5);
  });
});

describe("findingPattern and patternSentence: one-off or systemic, on the thresholds the ranking lifts on", () => {
  it("calls once on one day a one-off", () => {
    expect(findingPattern({ daysSeen: 1, occurrences: 1 })).toBe("one-off");
    expect(patternSentence({ daysSeen: 1, occurrences: 1 })).toBe("ONE-OFF — once this window, seen on 1 day");
  });

  it("calls three times in one window systemic", () => {
    expect(findingPattern({ daysSeen: 1, occurrences: 3 })).toBe("systemic");
  });

  it("calls a finding that survived a night systemic", () => {
    expect(findingPattern({ daysSeen: 2, occurrences: 1 })).toBe("systemic");
    expect(patternSentence({ daysSeen: 2, occurrences: 4 })).toBe(
      "SYSTEMIC — 4 times this window, seen on 2 different days in all",
    );
  });
});

describe("hasConsequence", () => {
  it("is false for an absent or blank consequence and true for a stated one", () => {
    expect(hasConsequence({ finding: { consequence: undefined } })).toBe(false);
    expect(hasConsequence({ finding: { consequence: " " } })).toBe(false);
    expect(hasConsequence({ finding: { consequence: "3 runs dropped" } })).toBe(true);
  });
});
