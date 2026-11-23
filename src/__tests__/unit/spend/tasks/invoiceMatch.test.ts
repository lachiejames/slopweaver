import { describe, expect, it } from "vitest";

import { merchantIdentityOf } from "../../../../spend/merchants/core.js";
import {
  invoiceQuery,
  matchInvoices,
  namesAmount,
  type ReceiptCandidate,
  receiptOrigin,
} from "../../../../spend/tasks/invoiceMatch.js";
import type { TaskExpense } from "../../../../spend/tasks/reminder.js";
import { FIXTURE_MERCHANTS } from "../merchantFixture.js";

/** An invented expense, grouped against the fixture register. */
function expense({ minor, merchant = "Anthropic" }: { minor: number; merchant?: string }): TaskExpense {
  return {
    amount: { currency: "AUD", minor },
    day: "2027-03-04",
    identity: merchantIdentityOf({ merchant, merchants: FIXTURE_MERCHANTS }),
    merchant,
  };
}

/** An invented receipt carrying one PDF, sent by the vendor straight to this mailbox unless overridden. */
function receipt({
  id,
  body,
  sentAtIso = "2027-03-04T02:00:00.000Z",
  over = {},
}: {
  id: string;
  body: string;
  sentAtIso?: string;
  over?: Partial<ReceiptCandidate>;
}): ReceiptCandidate {
  return {
    body,
    forwarded: false,
    from: "Vendor Billing <billing@mail.anthropic.com>",
    id,
    labelIds: ["INBOX"],
    originalDay: sentAtIso.slice(0, 10),
    pdfs: [{ filename: "Receipt-0001.pdf", partId: "2" }],
    sentAtIso,
    subject: "Your receipt",
    to: ["owner@example.test"],
    ...over,
  };
}

/** The owner's forward of a receipt from a plan mailbox, days after the charge, dated inside by its forwarded header. */
function forwardOf({ id, originalDay, amount }: { id: string; originalDay: string; amount: string }): ReceiptCandidate {
  return receipt({
    body: `---------- Forwarded message ---------\nDate: whatever\n\nTotal A$${amount}`,
    id,
    over: { forwarded: true, from: "Owner <owner@plan.example.test>", originalDay, subject: "Fwd: Your receipt" },
    sentAtIso: "2027-03-12T09:00:00.000Z",
  });
}

describe("receiptOrigin", () => {
  it.each([
    ["Date: Sat, Mar 6, 2027 at 3:14 PM", "2027-03-06"],
    ["Date: Sat, 6 Mar 2027 at 15:14", "2027-03-06"],
    ["Date: 6 March 2027 at 3:14:00 pm AEST", "2027-03-06"],
    ["Date: Sept 30, 2027", "2027-09-30"],
  ])("reads a forward's %j as %s", (line, day) => {
    const body = `Hi\n\n---------- Forwarded message ---------\nFrom: Vendor <billing@anthropic.com>\n${line}\n\nTotal`;
    expect(receiptOrigin({ body, sentAtIso: "2027-03-12T09:00:00.000Z" })).toEqual({
      forwarded: true,
      originalDay: day,
    });
  });

  it("dates a receipt forwarded twice by the innermost header, never by the owner's intermediate forward", () => {
    const body = [
      "---------- Forwarded message ---------",
      "From: Owner <owner@other.example.test>",
      "Date: Fri, Mar 12, 2027 at 9:00 AM",
      "",
      "---------- Forwarded message ---------",
      "From: Vendor <billing@anthropic.com>",
      "Date: Mon, Mar 1, 2027 at 3:14 PM",
      "",
      "Total A$120.00",
    ].join("\n");
    expect(receiptOrigin({ body, sentAtIso: "2027-03-12T09:05:00.000Z" })).toEqual({
      forwarded: true,
      originalDay: "2027-03-01",
    });
  });

  it("dates a receipt the vendor sent here by its send day", () => {
    expect(receiptOrigin({ body: "Total A$120.00", sentAtIso: "2027-03-04T02:00:00.000Z" })).toEqual({
      forwarded: false,
      originalDay: "2027-03-04",
    });
  });

  it("leaves a forward whose Date line names no day undated", () => {
    const body = "Begin forwarded message:\n\nDate: yesterday\n\nTotal";
    expect(receiptOrigin({ body, sentAtIso: "2027-03-12T09:00:00.000Z" })).toEqual({
      forwarded: true,
      originalDay: undefined,
    });
  });
});

describe("invoiceQuery", () => {
  it("searches mail from or naming the merchant's registered receipt domain, never mail already sent to Airwallex", () => {
    expect(invoiceQuery({ expense: expense({ minor: 12000 }), merchants: FIXTURE_MERCHANTS })).toBe(
      '(from:(anthropic.com) OR "anthropic.com") has:attachment -to:receipts@expenses.airwallex.com ' +
        "after:2027/03/02 before:2027/03/19",
    );
  });

  it("searches every receipt domain a merchant registers", () => {
    const merchants = [{ prefixes: ["acme"], receiptDomains: ["acme.example", "billing.acme.test"], slug: "acme" }];
    const acme = { ...expense({ minor: 500 }), identity: { kind: "merchant", slug: "acme" } as const };
    expect(invoiceQuery({ expense: acme, merchants })).toBe(
      '(from:(acme.example OR billing.acme.test) OR "acme.example" OR "billing.acme.test") has:attachment ' +
        "-to:receipts@expenses.airwallex.com after:2027/03/02 before:2027/03/19",
    );
  });

  it("searches nothing for a merchant the install has not registered", () => {
    const unregistered = expense({ merchant: "Othercompany", minor: 12000 });
    expect(invoiceQuery({ expense: unregistered, merchants: FIXTURE_MERCHANTS })).toBeUndefined();
  });

  it("searches nothing for a registered merchant with no receipt domain", () => {
    const merchants = [{ prefixes: ["anthropic"], receiptDomains: [], slug: "anthropic" }];
    expect(invoiceQuery({ expense: expense({ minor: 12000 }), merchants })).toBeUndefined();
  });
});

describe("namesAmount", () => {
  it.each([
    ["Total A$120.00 paid", 12000, true],
    ["Amount paid $1,234.50", 123450, true],
    ["Amount paid $1234.50", 123450, true],
    ["Total A$1120.00 paid", 12000, false],
    ["Total A$120.001", 12000, false],
    ["Total A$12.00", 12000, false],
  ])("in %j, %i minor units named: %s", (text, minor, named) => {
    expect(namesAmount({ amount: { currency: "AUD", minor }, text })).toBe(named);
  });
});

describe("matchInvoices", () => {
  it("claims the receipt naming the amount", () => {
    const naming = receipt({ body: "Total A$120.00", id: "r2" });
    const verdicts = matchInvoices({
      searches: [
        {
          candidates: [receipt({ body: "Total A$15.00", id: "r1" }), naming],
          expense: expense({ minor: 12000 }),
          query: "q",
        },
      ],
    });
    expect(verdicts).toEqual([{ kind: "matched", receipt: naming }]);
  });

  it("reports receipts that do not name the amount as unconfirmed, never as a match", () => {
    const verdicts = matchInvoices({
      searches: [
        { candidates: [receipt({ body: "Total A$15.00", id: "r1" })], expense: expense({ minor: 12000 }), query: "q" },
      ],
    });
    expect(verdicts).toEqual([{ candidateIds: ["r1"], kind: "unconfirmed" }]);
  });

  it("says none when the window holds no receipt, and no-registered-merchant when nothing was searched", () => {
    const verdicts = matchInvoices({
      searches: [
        { candidates: [], expense: expense({ minor: 12000 }), query: "q" },
        { candidates: [], expense: expense({ merchant: "Othercompany", minor: 12000 }), query: undefined },
      ],
    });
    expect(verdicts).toEqual([{ kind: "none" }, { kind: "no-registered-merchant" }]);
  });

  it("gives two charges of one amount two receipts, and a third nothing", () => {
    const first = receipt({ body: "Total A$120.00", id: "r1", sentAtIso: "2027-03-04T01:00:00.000Z" });
    const second = receipt({ body: "Total A$120.00", id: "r2", sentAtIso: "2027-03-05T01:00:00.000Z" });
    const candidates = [second, first];
    const verdicts = matchInvoices({
      searches: [1, 2, 3].map(() => ({ candidates, expense: expense({ minor: 12000 }), query: "q" })),
    });
    expect(verdicts).toEqual([
      { kind: "matched", receipt: first },
      { kind: "matched", receipt: second },
      { candidateIds: ["r2", "r1"], kind: "unconfirmed" },
    ]);
  });

  it("claims the owner's forward of the receipt, judged on the receipt's own day rather than the day it was forwarded", () => {
    const forward = forwardOf({ amount: "120.00", id: "f1", originalDay: "2027-03-04" });
    const verdicts = matchInvoices({
      searches: [{ candidates: [forward], expense: expense({ minor: 12000 }), query: "q" }],
    });
    expect(verdicts).toEqual([{ kind: "matched", receipt: forward }]);
  });

  it("never pairs a charge with a later same-amount receipt the owner forwarded in the same batch", () => {
    const later = forwardOf({ amount: "120.00", id: "f2", originalDay: "2027-03-11" });
    const verdicts = matchInvoices({
      searches: [{ candidates: [later], expense: expense({ minor: 12000 }), query: "q" }],
    });
    expect(verdicts).toEqual([{ candidateIds: ["f2"], kind: "unconfirmed" }]);
  });

  it("never matches the forward it drafted, the owner's sent copy, mail to Airwallex, or Airwallex's own mail", () => {
    const candidates = [
      receipt({ body: "Total A$120.00", id: "draft", over: { labelIds: ["DRAFT"] } }),
      receipt({ body: "Total A$120.00", id: "sent", over: { labelIds: ["SENT"] } }),
      receipt({ body: "Total A$120.00", id: "to-aw", over: { to: ["receipts@expenses.airwallex.com"] } }),
      receipt({ body: "Total A$120.00", id: "from-aw", over: { from: "Airwallex <support@info.airwallex.com>" } }),
    ];
    const verdicts = matchInvoices({ searches: [{ candidates, expense: expense({ minor: 12000 }), query: "q" }] });
    expect(verdicts).toEqual([{ kind: "none" }]);
  });

  it("counts a receipt the vendor sent here and the owner's forward of it as one receipt", () => {
    const direct = receipt({ body: "Total A$120.00", id: "r1" });
    const copy = forwardOf({ amount: "120.00", id: "f1", originalDay: "2027-03-04" });
    const verdicts = matchInvoices({
      searches: [1, 2].map(() => ({ candidates: [copy, direct], expense: expense({ minor: 12000 }), query: "q" })),
    });
    expect(verdicts).toEqual([
      { kind: "matched", receipt: direct },
      { candidateIds: ["r1"], kind: "unconfirmed" },
    ]);
  });

  it("takes an undated forward only when it is the one receipt naming the amount", () => {
    const undated = forwardOf({ amount: "120.00", id: "f1", originalDay: "2027-03-04" });
    const sole = { ...undated, originalDay: undefined };
    const other = { ...sole, id: "f2", subject: "Fwd: Another receipt" };
    const alone = matchInvoices({
      searches: [{ candidates: [sole], expense: expense({ minor: 12000 }), query: "q" }],
    });
    const beside = matchInvoices({
      searches: [{ candidates: [sole, other], expense: expense({ minor: 12000 }), query: "q" }],
    });
    expect([...alone, ...beside]).toEqual([
      { kind: "matched", receipt: sole },
      { candidateIds: ["f1", "f2"], kind: "unconfirmed" },
    ]);
  });

  it("never claims a receipt that carries no PDF", () => {
    const bare: ReceiptCandidate = { ...receipt({ body: "Total A$120.00", id: "r1" }), pdfs: [] };
    const verdicts = matchInvoices({
      searches: [{ candidates: [bare], expense: expense({ minor: 12000 }), query: "q" }],
    });
    expect(verdicts).toEqual([{ candidateIds: ["r1"], kind: "unconfirmed" }]);
  });
});
