import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseTaskReminder } from "../../../../spend/tasks/reminder.js";
import { FIXTURE_MERCHANTS } from "../merchantFixture.js";

/** A reminder body in the shape `gmail read` flattens one to; every value is invented. */
const TWO_LISTED_ONE_MORE = [
  "You have 3 tasks to complete",
  "",
  "3 card expenses to submit",
  " ",
  "Transaction date 4 Mar",
  "Anthropic",
  " ",
  "120.00 AUD",
  "Transaction date 5 Mar",
  "Open AI",
  "New",
  " ",
  "9.99 USD",
  "+ 1 more card expense",
  " View incomplete expenses",
  "Airwallex.com|Help Centre|Terms",
].join("\n");

describe("parseTaskReminder", () => {
  it("reads each listed expense, its year from the mail, and the unlisted tail", () => {
    const reminder = unwrap(
      parseTaskReminder({
        body: TWO_LISTED_ONE_MORE,
        merchants: FIXTURE_MERCHANTS,
        sentAtIso: "2027-03-06T07:30:00.000Z",
      }),
    );
    expect(reminder).toEqual({
      cardExpenses: 3,
      expenses: [
        {
          amount: { currency: "AUD", minor: 12000 },
          day: "2027-03-04",
          identity: { kind: "merchant", slug: "anthropic" },
          merchant: "Anthropic",
        },
        {
          amount: { currency: "USD", minor: 999 },
          day: "2027-03-05",
          identity: { kind: "merchant", slug: "openai" },
          merchant: "Open AI",
        },
      ],
      more: 1,
      openTasks: 3,
    });
  });

  it("keeps each expense under its own merchant string when the install registers none", () => {
    const reminder = unwrap(
      parseTaskReminder({ body: TWO_LISTED_ONE_MORE, merchants: [], sentAtIso: "2027-03-06T07:30:00.000Z" }),
    );
    expect(reminder.expenses.map((expense) => expense.identity)).toEqual([
      { kind: "raw", merchant: "Anthropic" },
      { kind: "raw", merchant: "Open AI" },
    ]);
  });

  it("reads a December charge in a January reminder as the year before", () => {
    const body = [
      "You have 1 task to complete",
      "1 card expense to submit",
      "Transaction date 30 Dec",
      "Anthropic",
      "50.00 AUD",
      "View incomplete expenses",
    ].join("\n");
    const reminder = unwrap(
      parseTaskReminder({ body, merchants: FIXTURE_MERCHANTS, sentAtIso: "2027-01-03T07:30:00.000Z" }),
    );
    expect(reminder.expenses.map((expense) => expense.day)).toEqual(["2026-12-30"]);
  });

  it("keeps a charge dated the day after the mail in the mail's year", () => {
    const body = [
      "You have 1 task to complete",
      "1 card expense to submit",
      "Transaction date 7 Mar",
      "Anthropic",
      "50.00 AUD",
      "View incomplete expenses",
    ].join("\n");
    const reminder = unwrap(
      parseTaskReminder({ body, merchants: FIXTURE_MERCHANTS, sentAtIso: "2027-03-06T20:00:00.000Z" }),
    );
    expect(reminder.expenses.map((expense) => expense.day)).toEqual(["2027-03-07"]);
  });

  it("refuses a body that is not a reminder", () => {
    const error = unwrapErr(
      parseTaskReminder({
        body: "Your statement is ready",
        merchants: FIXTURE_MERCHANTS,
        sentAtIso: "2027-03-06T07:30:00.000Z",
      }),
    );
    expect(error.code).toBe("NOT_A_REMINDER");
  });

  it("refuses an expense whose amount is not the reminder's shape", () => {
    const body = [
      "You have 1 task to complete",
      "1 card expense to submit",
      "Transaction date 4 Mar",
      "Anthropic",
      "A$120",
      "View incomplete expenses",
    ].join("\n");
    const error = unwrapErr(
      parseTaskReminder({ body, merchants: FIXTURE_MERCHANTS, sentAtIso: "2027-03-06T07:30:00.000Z" }),
    );
    expect(error.code).toBe("EXPENSE_MALFORMED");
    expect(error.message).toContain("expense 1");
  });

  it("refuses a month it cannot name", () => {
    const body = [
      "You have 1 task to complete",
      "1 card expense to submit",
      "Transaction date 4 Mrz",
      "Anthropic",
      "120.00 AUD",
      "View incomplete expenses",
    ].join("\n");
    expect(
      unwrapErr(parseTaskReminder({ body, merchants: FIXTURE_MERCHANTS, sentAtIso: "2027-03-06T07:30:00.000Z" })).code,
    ).toBe("EXPENSE_MALFORMED");
  });

  it("refuses a list that does not add up to the stated count", () => {
    const body = [
      "You have 2 tasks to complete",
      "2 card expenses to submit",
      "Transaction date 4 Mar",
      "Anthropic",
      "120.00 AUD",
      "View incomplete expenses",
    ].join("\n");
    const error = unwrapErr(
      parseTaskReminder({ body, merchants: FIXTURE_MERCHANTS, sentAtIso: "2027-03-06T07:30:00.000Z" }),
    );
    expect(error.code).toBe("COUNT_MISMATCH");
    expect(error.message).toBe("the reminder states 2 card expense(s) but lists 1 — its shape changed");
  });
});
