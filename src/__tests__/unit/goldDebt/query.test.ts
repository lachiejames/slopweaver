import { describe, expect, it } from "vitest";

import {
  conflictingDebtField,
  filterGoldDebts,
  findGoldDebt,
  foldGoldDebts,
  isOpenDebt,
} from "../../../goldDebt/query.js";
import type { GoldDebt, GoldDebtRow, GoldDebtSettlementRow } from "../../../goldDebt/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const OWNER_REPO = "https://github.com/octo-self/slopweaver";

/** A debt row built as a literal, so one test can vary exactly one field of it. */
function debtRow({
  number,
  mergedIso = "2026-09-18T17:31:52Z",
  grade = "silver",
  wouldBe = "post the ask as the owner into a real channel",
  blockedOn = "the owner's own approval",
  recordedIso = "2026-09-19T04:00:00Z",
  bySession = "workspace:gold-debt-ledger",
}: {
  number: number;
  mergedIso?: string;
  grade?: "silver" | "bronze";
  wouldBe?: string;
  blockedOn?: string;
  recordedIso?: string;
  bySession?: string;
}): GoldDebtRow {
  return {
    blockedOn,
    bySession,
    grade,
    mergedIso,
    pullRequest: `${OWNER_REPO}/pull/${number}`,
    recordedIso,
    wouldBe,
  };
}

/** A settlement row for one pull request number. */
function settlementRow({
  number,
  verdict = "gathered",
  settledIso = "2026-09-20T09:00:00Z",
}: {
  number: number;
  verdict?: "gathered" | "moot";
  settledIso?: string;
}): GoldDebtSettlementRow {
  return {
    bySession: "workspace:gold-debt-ledger",
    evidence: "the real post, really sent",
    pullRequest: `${OWNER_REPO}/pull/${number}`,
    settledIso,
    verdict,
  };
}

/** The `<owner>/<repo>#<number>` key of each folded debt, in fold order. */
function keysOf({ debts }: { debts: readonly GoldDebt[] }): readonly string[] {
  return debts.map((entry) => entry.debt.pullRequest.replace(`${OWNER_REPO}/pull/`, "#"));
}

describe("conflictingDebtField", () => {
  it("finds no disagreement between two identical recordings", () => {
    const first = debtRow({ number: 872 });
    expect(conflictingDebtField({ first, second: debtRow({ number: 872 }) })).toBeUndefined();
  });

  it("ignores recordedIso, so a retry from a crashed session is not a conflict", () => {
    const first = debtRow({ number: 872 });
    const second = debtRow({ number: 872, recordedIso: "2026-09-19T06:00:00Z" });
    expect(conflictingDebtField({ first, second })).toBeUndefined();
  });

  it("reads mergedIso as an instant, so two zone spellings of one moment agree", () => {
    const first = debtRow({ mergedIso: "2026-09-18T17:31:52Z", number: 872 });
    const second = debtRow({ mergedIso: "2026-09-19T03:31:52+10:00", number: 872 });
    expect(conflictingDebtField({ first, second })).toBeUndefined();
  });

  it("names the grade when two recordings of one merge disagree about it", () => {
    const first = debtRow({ number: 872 });
    expect(conflictingDebtField({ first, second: debtRow({ grade: "bronze", number: 872 }) })).toBe("grade");
  });

  it("names wouldBe when the two recordings describe different gold proofs", () => {
    const first = debtRow({ number: 872 });
    const second = debtRow({ number: 872, wouldBe: "something else entirely" });
    expect(conflictingDebtField({ first, second })).toBe("wouldBe");
  });

  it("treats an ABSENT title and a present one as a disagreement", () => {
    const first = debtRow({ number: 872 });
    const second = { ...debtRow({ number: 872 }), title: "a title" };
    expect(conflictingDebtField({ first, second })).toBe("title");
  });

  it("reports a real difference in merge instant", () => {
    const first = debtRow({ number: 872 });
    const second = debtRow({ mergedIso: "2026-09-18T18:31:52Z", number: 872 });
    expect(conflictingDebtField({ first, second })).toBe("mergedIso");
  });
});

describe("foldGoldDebts", () => {
  it("returns nothing for an empty register", () => {
    expect(unwrap(foldGoldDebts({ records: [] }))).toEqual([]);
  });

  it("orders OLDEST merge first, because the longest-owed debt is the likeliest to be gatherable", () => {
    const records = [
      debtRow({ mergedIso: "2026-09-18T17:31:52Z", number: 872 }),
      debtRow({ mergedIso: "2026-09-12T02:10:00Z", number: 857 }),
      debtRow({ mergedIso: "2026-09-19T01:00:00Z", number: 880 }),
    ];
    expect(keysOf({ debts: unwrap(foldGoldDebts({ records })) })).toEqual(["#857", "#872", "#880"]);
  });

  it("breaks a tie inside one second on the derived debt id, so the order is total", () => {
    const records = [
      debtRow({ mergedIso: "2026-09-18T17:31:52Z", number: 880 }),
      debtRow({ mergedIso: "2026-09-18T17:31:52Z", number: 857 }),
    ];
    expect(keysOf({ debts: unwrap(foldGoldDebts({ records })) })).toEqual(["#857", "#880"]);
  });

  it("attaches a settlement to the debt it pays", () => {
    const records = [debtRow({ number: 872 }), settlementRow({ number: 872 })];
    const folded = unwrap(foldGoldDebts({ records }));
    expect(folded.length).toBe(1);
    expect(folded[0]!.settlement!.verdict).toBe("gathered");
  });

  it("leaves an unsettled debt carrying no settlement", () => {
    const folded = unwrap(foldGoldDebts({ records: [debtRow({ number: 872 })] }));
    expect(folded[0]!.settlement).toBeUndefined();
  });

  it("folds two identical recordings of one merge into a single debt", () => {
    const records = [debtRow({ number: 872 }), debtRow({ number: 872, recordedIso: "2026-09-19T06:00:00Z" })];
    expect(unwrap(foldGoldDebts({ records })).length).toBe(1);
  });

  it("drops a settlement naming a debt the register does not hold, rather than failing the whole read", () => {
    const records = [debtRow({ number: 872 }), settlementRow({ number: 999 })];
    const folded = unwrap(foldGoldDebts({ records }));
    expect(keysOf({ debts: folded })).toEqual(["#872"]);
    expect(folded[0]!.settlement).toBeUndefined();
  });

  it("fails the read when two rows for one merge disagree, naming the debt and the field", () => {
    const records = [debtRow({ number: 872 }), debtRow({ grade: "bronze", number: 872 })];
    const failure = unwrapErr(foldGoldDebts({ records }));
    expect(failure.code).toBe("DEBT_CONFLICT");
    expect(failure.message).toContain("octo-self/slopweaver#872");
    expect(failure.message).toContain("grade");
  });

  it("lets the LAST settlement govern when a hand-edited file holds two", () => {
    const records = [
      debtRow({ number: 872 }),
      settlementRow({ number: 872 }),
      settlementRow({ number: 872, verdict: "moot" }),
    ];
    expect(unwrap(foldGoldDebts({ records }))[0]!.settlement!.verdict).toBe("moot");
  });
});

describe("isOpenDebt", () => {
  it("calls a debt with no settlement open", () => {
    const entry = unwrap(foldGoldDebts({ records: [debtRow({ number: 872 })] }))[0]!;
    expect(isOpenDebt({ entry })).toBe(true);
  });

  it("calls a settled debt closed, whichever verdict settled it", () => {
    const records = [debtRow({ number: 872 }), settlementRow({ number: 872, verdict: "moot" })];
    expect(isOpenDebt({ entry: unwrap(foldGoldDebts({ records }))[0]! })).toBe(false);
  });
});

describe("filterGoldDebts", () => {
  const records = [
    debtRow({ mergedIso: "2026-09-12T02:10:00Z", number: 857 }),
    debtRow({ mergedIso: "2026-09-18T17:31:52Z", number: 872 }),
    settlementRow({ number: 857 }),
  ];
  const debts = unwrap(foldGoldDebts({ records }));

  it("keeps only what is still owed by default", () => {
    expect(keysOf({ debts: filterGoldDebts({ debts, repo: undefined, state: "open" }) })).toEqual(["#872"]);
  });

  it("keeps only what has been settled", () => {
    expect(keysOf({ debts: filterGoldDebts({ debts, repo: undefined, state: "settled" }) })).toEqual(["#857"]);
  });

  it("keeps everything, in the fold's own order", () => {
    expect(keysOf({ debts: filterGoldDebts({ debts, repo: undefined, state: "all" }) })).toEqual(["#857", "#872"]);
  });

  it("narrows to one repository", () => {
    const kept = filterGoldDebts({ debts, repo: "octo-self/slopweaver", state: "all" });
    expect(keysOf({ debts: kept })).toEqual(["#857", "#872"]);
  });

  it("narrows on the owner typed in its display case, which GitHub resolves to the same repository", () => {
    const kept = filterGoldDebts({ debts, repo: "Octo-Self/SlopWeaver", state: "all" });
    expect(keysOf({ debts: kept })).toEqual(["#857", "#872"]);
  });

  it("keeps nothing for a repository the register holds no debt on", () => {
    expect(filterGoldDebts({ debts, repo: "acme/other", state: "all" })).toEqual([]);
  });

  it("does not match a repository whose name merely PREFIXES the one asked for", () => {
    expect(filterGoldDebts({ debts, repo: "octo-self/slop", state: "all" })).toEqual([]);
  });
});

describe("findGoldDebt", () => {
  const debts = unwrap(foldGoldDebts({ records: [debtRow({ number: 872 }), debtRow({ number: 857 })] }));

  it("finds a debt by its full pull request URL", () => {
    const found = findGoldDebt({ debts, reference: `${OWNER_REPO}/pull/872` })!;
    expect(found.debt.pullRequest).toBe(`${OWNER_REPO}/pull/872`);
  });

  it("finds a debt by its derived key", () => {
    const found = findGoldDebt({ debts, reference: "octo-self/slopweaver#857" })!;
    expect(found.debt.pullRequest).toBe(`${OWNER_REPO}/pull/857`);
  });

  it("finds nothing for a pull request the register does not hold", () => {
    expect(findGoldDebt({ debts, reference: "octo-self/slopweaver#999" })).toBeUndefined();
  });

  it("finds nothing for a bare number, which names no repository", () => {
    expect(findGoldDebt({ debts, reference: "872" })).toBeUndefined();
  });
});
