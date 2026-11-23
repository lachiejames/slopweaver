import { describe, expect, it } from "vitest";

import { isSettlementRecord, parseGoldDebtLine, validateGoldDebtRecord } from "../../../goldDebt/decode.js";
import { buildGoldDebt, buildGoldDebtSettlement, isGoldDebtGrade, isGoldDebtVerdict } from "../../../goldDebt/row.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const PR = "https://github.com/lachiejames/slopweaver/pull/872";

/** One valid debt, varying only what a test cares about. */
function debt({
  pullRequest = PR,
  grade = "silver",
  mergedIso = "2026-09-18T17:31:52Z",
  wouldBe = "post the owner's review ask as the owner into a real team thread",
  blockedOn = "the owner's own approval — an outward act aimed at people",
  recordedIso = "2026-09-19T04:00:00Z",
  title = undefined as string | undefined,
  run = undefined as string | undefined,
}) {
  return buildGoldDebt({
    blockedOn,
    bySession: "workspace:gold-debt-ledger",
    grade,
    mergedIso,
    pullRequest,
    recordedIso,
    run,
    title,
    wouldBe,
  });
}

const REGRADE = "the description now reads solved-gold, graded with `github pr update --edit`";

/**
 * One valid settlement. `regrade` and `proofCommit` are REQUIRED of the caller rather than defaulted:
 * passing `undefined` to a destructuring default selects the DEFAULT, so a defaulted optional cannot
 * express the absence half of these tests are about.
 */
function settlement({
  regrade,
  proofCommit,
  verdict = "gathered",
  evidence = "https://acme.slack.com/archives/C1/p1 — the ask as the owner, really sent",
  settledIso = "2026-09-20T09:00:00Z",
}: {
  regrade: string | undefined;
  proofCommit: string | undefined;
  verdict?: string;
  evidence?: string;
  settledIso?: string;
}) {
  return buildGoldDebtSettlement({
    bySession: "workspace:gold-debt-ledger",
    evidence,
    proofCommit,
    pullRequest: PR,
    regrade,
    settledIso,
    verdict,
  });
}

describe("isGoldDebtGrade", () => {
  it("accepts silver", () => {
    expect(isGoldDebtGrade("silver")).toBe(true);
  });

  it("accepts bronze", () => {
    expect(isGoldDebtGrade("bronze")).toBe(true);
  });

  it("refuses gold, because a gold merge owes nothing", () => {
    expect(isGoldDebtGrade("gold")).toBe(false);
  });

  it("refuses a grade nothing else in the repository can read", () => {
    expect(isGoldDebtGrade("platinum")).toBe(false);
  });
});

describe("isGoldDebtVerdict", () => {
  it("accepts gathered", () => {
    expect(isGoldDebtVerdict("gathered")).toBe(true);
  });

  it("accepts moot", () => {
    expect(isGoldDebtVerdict("moot")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isGoldDebtVerdict("settled")).toBe(false);
  });
});

describe("buildGoldDebt", () => {
  it("builds a debt whose fields are the trimmed values it was given", () => {
    const row = unwrap(debt({ wouldBe: "  answer a real Slack thread  " }));
    expect(row.pullRequest).toBe(PR);
    expect(row.grade).toBe("silver");
    expect(row.wouldBe).toBe("answer a real Slack thread");
    expect(row.mergedIso).toBe("2026-09-18T17:31:52Z");
  });

  it("leaves an absent title off the row entirely, rather than writing it as undefined", () => {
    const row = unwrap(debt({}));
    expect(Object.hasOwn(row, "title")).toBe(false);
  });

  it("carries a title when one is given", () => {
    const row = unwrap(debt({ title: "The as-me lane can express the owner's own review ask" }));
    expect(row.title).toBe("The as-me lane can express the owner's own review ask");
  });

  it("carries the board row it landed under", () => {
    const row = unwrap(debt({ run: "gold-debt-ledger" }));
    expect(row.run).toBe("gold-debt-ledger");
  });

  it("refuses a gold grade by name, so no unpayable row can ever enter the register", () => {
    expect(unwrapErr(debt({ grade: "gold" })).code).toBe("INVALID_GRADE");
  });

  it("refuses a pull request a reader cannot open", () => {
    expect(unwrapErr(debt({ pullRequest: "#872" })).code).toBe("UNRESOLVABLE_PULL_REQUEST");
  });

  it("refuses an empty wouldBe, because a debt nobody can act on is not a debt", () => {
    const failure = unwrapErr(debt({ wouldBe: "   " }));
    expect(failure.code).toBe("INVALID_FIELD");
    expect(failure.message).toContain("wouldBe");
  });

  it("refuses an empty blockedOn", () => {
    const failure = unwrapErr(debt({ blockedOn: "" }));
    expect(failure.code).toBe("INVALID_FIELD");
    expect(failure.message).toContain("blockedOn");
  });

  it("refuses a merged instant `Date` would take but no scan can order", () => {
    const failure = unwrapErr(debt({ mergedIso: "2026.09.18 17:31:52 GMT" }));
    expect(failure.code).toBe("INVALID_FIELD");
    expect(failure.message).toContain("mergedIso");
  });

  it("refuses a wouldBe longer than the serialisation bound", () => {
    const failure = unwrapErr(debt({ wouldBe: "x".repeat(4001) }));
    expect(failure.message).toContain("4001 characters, over the 4000 allowed");
  });

  it("refuses a run slug the board could never have written", () => {
    const failure = unwrapErr(debt({ run: "not a slug" }));
    expect(failure.message).toContain("run");
  });
});

describe("buildGoldDebtSettlement", () => {
  it("builds a gathered settlement carrying its evidence and its re-grade", () => {
    const row = unwrap(settlement({ proofCommit: undefined, regrade: REGRADE }));
    expect(row.verdict).toBe("gathered");
    expect(row.regrade).toBe(REGRADE);
  });

  it("refuses a gathered settlement with no re-grade, because the owner's word is that it is OPEN", () => {
    const failure = unwrapErr(settlement({ proofCommit: undefined, regrade: undefined }));
    expect(failure.code).toBe("INVALID_FIELD");
    expect(failure.message).toContain("re-graded post-hoc OPENLY");
  });

  it("refuses a gathered settlement whose re-grade is only whitespace", () => {
    expect(unwrapErr(settlement({ proofCommit: undefined, regrade: "   " })).code).toBe("INVALID_FIELD");
  });

  it("accepts a moot settlement with no re-grade, because it pays no proof", () => {
    const row = unwrap(
      settlement({
        evidence: "the surface was removed in #900",
        proofCommit: undefined,
        regrade: undefined,
        verdict: "moot",
      }),
    );
    expect(row.verdict).toBe("moot");
    expect(Object.hasOwn(row, "regrade")).toBe(false);
  });

  it("refuses a moot settlement that claims a re-grade, so nobody satisfies the rule with `n/a`", () => {
    const failure = unwrapErr(settlement({ proofCommit: undefined, regrade: "n/a", verdict: "moot" }));
    expect(failure.message).toContain("pays nothing");
  });

  it("lowercases a proof commit, so one commit has one spelling", () => {
    const row = unwrap(settlement({ proofCommit: "BCBEEA941", regrade: REGRADE }));
    expect(row.proofCommit).toBe("bcbeea941");
  });

  it("refuses a proof commit that is not a git object name", () => {
    const failure = unwrapErr(settlement({ proofCommit: "the-head", regrade: REGRADE }));
    expect(failure.message).toContain("proofCommit");
  });

  it("refuses an unknown verdict by name", () => {
    const failure = unwrapErr(settlement({ proofCommit: undefined, regrade: REGRADE, verdict: "paid" }));
    expect(failure.message).toContain("`gathered`");
  });

  it("refuses an empty evidence", () => {
    expect(unwrapErr(settlement({ evidence: "", proofCommit: undefined, regrade: REGRADE })).code).toBe(
      "INVALID_FIELD",
    );
  });
});

describe("isSettlementRecord", () => {
  it("calls a settlement a settlement", () => {
    expect(isSettlementRecord(unwrap(settlement({ proofCommit: undefined, regrade: REGRADE })))).toBe(true);
  });

  it("calls a debt a debt", () => {
    expect(isSettlementRecord(unwrap(debt({})))).toBe(false);
  });
});

describe("validateGoldDebtRecord", () => {
  it("refuses a hybrid line carrying both a settledIso and a debt-only field", () => {
    const hybrid = { ...unwrap(settlement({ proofCommit: undefined, regrade: REGRADE })), grade: "silver" };
    const failure = unwrapErr(validateGoldDebtRecord({ value: hybrid }));
    expect(failure.message).toContain("may not sit beside settledIso");
  });

  it("refuses a value that is not an object at all", () => {
    expect(unwrapErr(validateGoldDebtRecord({ value: "a debt" })).code).toBe("INVALID_FIELD");
  });

  it("re-runs every builder rule, so a literal that type-checks still cannot enter the register", () => {
    const literal = { ...unwrap(debt({})), wouldBe: "" };
    expect(unwrapErr(validateGoldDebtRecord({ value: literal })).code).toBe("INVALID_FIELD");
  });

  it("ignores an inherited field, so prototype pollution cannot forge a re-grade", () => {
    const polluted = Object.create({ regrade: "forged" }) as Record<string, unknown>;
    Object.assign(polluted, unwrap(settlement({ proofCommit: undefined, regrade: undefined, verdict: "moot" })));
    const row = unwrap(validateGoldDebtRecord({ value: polluted }));
    expect(Object.hasOwn(row, "regrade")).toBe(false);
  });
});

describe("parseGoldDebtLine", () => {
  it("round-trips a debt through its own serialisation", () => {
    const row = unwrap(debt({ title: "a title" }));
    const parsed = unwrap(parseGoldDebtLine({ line: JSON.stringify(row), lineNumber: 1 }));
    expect(parsed).toEqual(row);
  });

  it("names the line a corrupt row sits on", () => {
    const failure = unwrapErr(parseGoldDebtLine({ line: "{ not json", lineNumber: 7 }));
    expect(failure.code).toBe("CORRUPT_ROW");
    expect(failure.message).toContain("line 7");
  });

  it("refuses a line whose field is written twice, since only the second would survive the decode", () => {
    const line = '{"pullRequest":"a","wouldBe":"first","wouldBe":"second"}';
    const failure = unwrapErr(parseGoldDebtLine({ line, lineNumber: 2 }));
    expect(failure.message).toContain("written twice");
  });
});
