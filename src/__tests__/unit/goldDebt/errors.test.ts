import { describe, expect, it } from "vitest";

import { GoldDebtErrors } from "../../../goldDebt/errors.js";

describe("GoldDebtErrors", () => {
  it("builds INVALID_FIELD prefixing the reason with the field name", () => {
    expect(GoldDebtErrors.invalidField({ field: "wouldBe", why: "must not be empty" })).toEqual({
      code: "INVALID_FIELD",
      field: "wouldBe",
      message: "wouldBe must not be empty",
    });
  });

  it("builds UNRESOLVABLE_PULL_REQUEST quoting the rejected reference", () => {
    expect(GoldDebtErrors.unresolvablePullRequest({ pullRequest: "#872" })).toEqual({
      code: "UNRESOLVABLE_PULL_REQUEST",
      message:
        '"#872" is not a pull request a reader can open. A debt names the MERGED pull request that owes the gold, as its full URL — `https://github.com/<owner>/<repo>/pull/<number>`. Never a bare #number, never a repo#number, and never prose',
      pullRequest: "#872",
    });
  });

  it("builds INVALID_GRADE quoting the rejected grade", () => {
    expect(GoldDebtErrors.invalidGrade({ grade: "gold" })).toEqual({
      code: "INVALID_GRADE",
      grade: "gold",
      message:
        '"gold" is not a grade that leaves gold owed — it is `silver` or `bronze`. A pull request merged at `gold` owes nothing, so there is no debt to record and nothing a settlement could ever pay',
    });
  });

  it("builds CORRUPT_ROW rendering the line number and the validation's objection", () => {
    expect(GoldDebtErrors.corruptRow({ lineNumber: 17, why: "grade is missing" })).toEqual({
      code: "CORRUPT_ROW",
      lineNumber: 17,
      message: "line 17 of the gold-debt ledger is neither a complete debt nor a complete settlement: grade is missing",
      why: "grade is missing",
    });
  });

  it("builds UNKNOWN_DEBT naming the reference and both recovery verbs", () => {
    expect(GoldDebtErrors.unknownDebt({ reference: "https://github.com/acme/app/pull/9" })).toEqual({
      code: "UNKNOWN_DEBT",
      message:
        "no gold debt in the ledger names https://github.com/acme/app/pull/9 — run `slopweaver gold debts` to see what does, or `slopweaver gold owe` to record it first",
      reference: "https://github.com/acme/app/pull/9",
    });
  });

  it("builds ALREADY_SETTLED carrying the instant it was settled", () => {
    expect(
      GoldDebtErrors.alreadySettled({ debtId: "debt-acme-app-9", settledIso: "2026-10-01T09:30:00.000Z" }),
    ).toEqual({
      code: "ALREADY_SETTLED",
      debtId: "debt-acme-app-9",
      message:
        "debt-acme-app-9 was already settled at 2026-10-01T09:30:00.000Z — a debt is settled once. If that settlement was wrong, say so on the pull request itself rather than writing a second one over it",
      settledIso: "2026-10-01T09:30:00.000Z",
    });
  });

  it("builds DEBT_CONFLICT naming the first field the two rows disagree about", () => {
    expect(GoldDebtErrors.debtConflict({ debtId: "debt-acme-app-9", field: "grade" })).toEqual({
      code: "DEBT_CONFLICT",
      debtId: "debt-acme-app-9",
      field: "grade",
      message:
        "the ledger already carries a DIFFERENT debt for debt-acme-app-9 — the two disagree about grade. One pull request owes one gold, or a settlement cannot say which account it pays",
    });
  });

  it("builds LEDGER_BUSY carrying the lock's own reason", () => {
    expect(GoldDebtErrors.ledgerBusy({ why: "held by pid 4242" })).toEqual({
      code: "LEDGER_BUSY",
      message:
        "another session is writing the gold-debt ledger right now (held by pid 4242) — nothing was written; try again",
    });
  });

  it("builds STORE_UNREADABLE rendering an Error cause by its message and keeping the cause", () => {
    const cause = new Error("permission denied");
    expect(GoldDebtErrors.storeUnreadable({ cause, path: "/h/ledgers/gold-debt.jsonl" })).toEqual({
      cause,
      code: "STORE_UNREADABLE",
      message:
        "could not read the gold-debt ledger at /h/ledgers/gold-debt.jsonl: permission denied — refusing rather than reporting nothing owed",
      path: "/h/ledgers/gold-debt.jsonl",
    });
  });

  it("renders a string cause as given", () => {
    expect(GoldDebtErrors.storeUnreadable({ cause: "the file does not exist", path: "/h/l.jsonl" }).message).toBe(
      "could not read the gold-debt ledger at /h/l.jsonl: the file does not exist — refusing rather than reporting nothing owed",
    );
  });
});
