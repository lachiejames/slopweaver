import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendGoldDebtRecord,
  goldDebtLedgerPath,
  readGoldDebtLedger,
  readGoldDebtRecords,
} from "../../../goldDebt/store.js";
import type { GoldDebtRow, GoldDebtSettlementRow } from "../../../goldDebt/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const OWNER_REPO = "https://github.com/lachiejames/slopweaver";
const NOW = "2026-09-19T04:00:00Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "gold-debt-store-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A debt row, varying only what a test cares about. */
function debtRow({
  number,
  grade = "silver",
  wouldBe = "post the ask as the owner into a real channel",
  recordedIso = NOW,
}: {
  number: number;
  grade?: "silver" | "bronze";
  wouldBe?: string;
  recordedIso?: string;
}): GoldDebtRow {
  return {
    blockedOn: "the owner's own approval",
    bySession: "workspace:gold-debt-ledger",
    grade,
    mergedIso: "2026-09-18T17:31:52Z",
    pullRequest: `${OWNER_REPO}/pull/${number}`,
    recordedIso,
    wouldBe,
  };
}

/** A settlement row for one pull request number. */
function settlementRow({
  number,
  evidence = "the real post, really sent",
}: {
  number: number;
  evidence?: string;
}): GoldDebtSettlementRow {
  return {
    bySession: "workspace:gold-debt-ledger",
    evidence,
    pullRequest: `${OWNER_REPO}/pull/${number}`,
    regrade: "the description now reads solved-gold",
    settledIso: "2026-09-20T09:00:00Z",
    verdict: "gathered",
  };
}

/** Every line the register file holds. */
function ledgerLines(): readonly string[] {
  return readFileSync(goldDebtLedgerPath({ home }), "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

describe("goldDebtLedgerPath", () => {
  it("is `ledgers/gold-debt.jsonl` under the home it is given", () => {
    expect(goldDebtLedgerPath({ home })).toBe(join(home, "ledgers", "gold-debt.jsonl"));
  });
});

describe("readGoldDebtLedger", () => {
  it("is empty on an install that has never merged below gold", () => {
    expect(unwrap(readGoldDebtLedger({ home }))).toEqual([]);
  });

  it("reads back exactly what was appended", () => {
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ number: 872 }) }));
    expect(unwrap(readGoldDebtLedger({ home }))).toEqual([debtRow({ number: 872 })]);
  });
});

describe("readGoldDebtRecords", () => {
  it("REFUSES an explicitly named file that is not there, rather than reporting nothing is owed", () => {
    const path = join(home, "nowhere.jsonl");
    const failure = unwrapErr(readGoldDebtRecords({ missing: "error", path }));
    expect(failure.code).toBe("STORE_UNREADABLE");
    expect(failure.message).toContain("does not exist");
  });

  it("refuses a register it cannot traverse to, instead of answering empty the way existsSync would", () => {
    const walled = join(home, "walled");
    mkdirSync(walled, { mode: 0o700, recursive: true });
    const path = join(walled, "gold-debt.jsonl");
    writeFileSync(path, "", { mode: 0o600 });
    chmodSync(walled, 0o000);
    const failure = unwrapErr(readGoldDebtRecords({ missing: "empty", path }));
    chmodSync(walled, 0o700);
    expect(failure.code).toBe("STORE_UNREADABLE");
    expect(failure.message).toContain("permissions");
  });

  it("skips a blank line, so a hand-appended trailing newline is not a corrupt row", () => {
    const path = join(home, "blank.jsonl");
    writeFileSync(path, `${JSON.stringify(debtRow({ number: 872 }))}\n\n`, { mode: 0o600 });
    expect(unwrap(readGoldDebtRecords({ missing: "error", path })).length).toBe(1);
  });

  it("names the line a corrupt row sits on", () => {
    const path = join(home, "corrupt.jsonl");
    writeFileSync(path, `${JSON.stringify(debtRow({ number: 872 }))}\nnot json\n`, { mode: 0o600 });
    const failure = unwrapErr(readGoldDebtRecords({ missing: "error", path }));
    expect(failure.code).toBe("CORRUPT_ROW");
    expect(failure.message).toContain("line 2");
  });
});

describe("appendGoldDebtRecord", () => {
  it("creates the register owner-only and reports where it wrote", () => {
    const receipt = unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ number: 872 }) }));
    expect(receipt.appended).toBe(true);
    expect(receipt.debtId).toBe("lachiejames/slopweaver#872");
    expect(receipt.path).toBe(goldDebtLedgerPath({ home }));
    expect(statSync(receipt.path).mode & 0o777).toBe(0o600);
  });

  it("narrows a register somebody left world-readable", () => {
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ number: 872 }) }));
    chmodSync(goldDebtLedgerPath({ home }), 0o644);
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ number: 857 }) }));
    expect(statSync(goldDebtLedgerPath({ home })).mode & 0o777).toBe(0o600);
  });

  it("writes one line per record, so the file stays streamable", () => {
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ number: 872 }) }));
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ number: 857 }) }));
    expect(ledgerLines().length).toBe(2);
  });

  it("folds a retry of the same debt, even when its recordedIso moved on", () => {
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ number: 872 }) }));
    const second = unwrap(
      appendGoldDebtRecord({
        home,
        nowIso: NOW,
        row: debtRow({ number: 872, recordedIso: "2026-09-19T06:00:00Z" }),
      }),
    );
    expect(second.appended).toBe(false);
    expect(ledgerLines().length).toBe(1);
  });

  it("refuses a second account of one merge that disagrees, naming the field", () => {
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ number: 872 }) }));
    const failure = unwrapErr(
      appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ grade: "bronze", number: 872 }) }),
    );
    expect(failure.code).toBe("DEBT_CONFLICT");
    expect(failure.message).toContain("grade");
  });

  it("re-validates a row a caller built as a literal, so no unenforceable field reaches the file", () => {
    const failure = unwrapErr(appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ number: 872, wouldBe: "" }) }));
    expect(failure.code).toBe("INVALID_FIELD");
    expect(unwrap(readGoldDebtLedger({ home }))).toEqual([]);
  });

  it("refuses a settlement for a debt the register does not hold", () => {
    const failure = unwrapErr(appendGoldDebtRecord({ home, nowIso: NOW, row: settlementRow({ number: 999 }) }));
    expect(failure.code).toBe("UNKNOWN_DEBT");
    expect(failure.message).toContain("lachiejames/slopweaver#999");
  });

  it("settles an open debt", () => {
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ number: 872 }) }));
    const receipt = unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: settlementRow({ number: 872 }) }));
    expect(receipt.appended).toBe(true);
    expect(ledgerLines().length).toBe(2);
  });

  it("refuses a DIFFERENT second settlement, naming when the debt was already settled", () => {
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ number: 872 }) }));
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: settlementRow({ number: 872 }) }));
    const failure = unwrapErr(
      appendGoldDebtRecord({
        home,
        nowIso: NOW,
        row: settlementRow({ evidence: "a second, different account", number: 872 }),
      }),
    );
    expect(failure.code).toBe("ALREADY_SETTLED");
    expect(failure.message).toContain("2026-09-20T09:00:00Z");
  });

  it("folds a byte-identical settlement replay, so a crashed settle retries safely", () => {
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: debtRow({ number: 872 }) }));
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: settlementRow({ number: 872 }) }));
    const replay = unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row: settlementRow({ number: 872 }) }));
    expect(replay.appended).toBe(false);
    expect(ledgerLines().length).toBe(2);
  });

  it("serialises from the VALIDATED row, so a toJSON on the caller's object cannot write the file", () => {
    const row = { ...debtRow({ number: 872 }), toJSON: () => ({ forged: true }) };
    unwrap(appendGoldDebtRecord({ home, nowIso: NOW, row }));
    const [line] = ledgerLines();
    expect(line!).toContain("lachiejames/slopweaver/pull/872");
    expect(line!).not.toContain("forged");
  });
});
