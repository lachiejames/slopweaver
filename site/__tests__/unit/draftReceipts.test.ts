/*
 * A parked draft's receipts as the Queue reads them, and the line its card leads with. `site/components/live/
 * draftReceipts.ts` restates `src/outbound/slack/receiptsLine.ts`'s `receiptsLine` because a file under `site/` never
 * imports `src/`; this file, in the lane that reaches both roots, is what binds the copy. That leaf imports nothing,
 * so `site/`'s typecheck, which has no `neverthrow`, can follow it.
 */

import { describe, expect, it } from "vitest";

import { receiptsLine as verbReceiptsLine } from "../../../src/outbound/slack/receiptsLine";
import { type DraftReceipts, draftReceiptsOf, receiptsLine } from "../../components/live/draftReceipts";

/** One of each shape the register parks, plus the two a row names none in. */
const CASES: readonly { receipts: DraftReceipts | undefined; bump: boolean }[] = [
  {
    bump: false,
    receipts: {
      kind: "attached",
      links: ["https://github.com/acme/acme-admin/pull/18398"],
      media: 3,
      tried: undefined,
    },
  },
  {
    bump: false,
    receipts: { kind: "attached", links: ["https://a.example", "https://b.example"], media: 1, tried: undefined },
  },
  { bump: false, receipts: { kind: "attached", links: [], media: 1, tried: "the trace view needs a login" } },
  { bump: false, receipts: { kind: "self-evident", why: "the DM is the question itself" } },
  { bump: false, receipts: { kind: "tried", tried: "Datadog refused the share link" } },
  { bump: false, receipts: undefined },
  { bump: true, receipts: undefined },
];

describe("receiptsLine", () => {
  it("says what the verb says, for every shape", () => {
    expect(CASES.length).toBeGreaterThan(0);
    expect(CASES.map((one) => receiptsLine(one))).toEqual(CASES.map((one) => verbReceiptsLine(one)));
  });

  it("counts links and attachments, never calling a file a screenshot", () => {
    expect(CASES.map((one) => receiptsLine(one))).toEqual([
      "Receipts: 1 link, 3 attachments",
      "Receipts: 2 links, 1 attachment",
      "Receipts: 1 attachment. Still missing, tried: the trace view needs a login",
      "No receipt needed: the DM is the question itself",
      "No receipt. Tried: Datadog refused the share link",
      "No receipts named",
      "No receipt owed: a bump",
    ]);
  });
});

describe("draftReceiptsOf", () => {
  it("reads each of the three shapes, and an absent field as none", () => {
    expect([
      draftReceiptsOf({ draft: { receipts: { kind: "attached", links: ["https://a.example"], media: 0 } } }),
      draftReceiptsOf({ draft: { receipts: { kind: "self-evident", why: "the DM is the question" } } }),
      draftReceiptsOf({ draft: { receipts: { kind: "tried", tried: "Datadog refused the share link" } } }),
      draftReceiptsOf({ draft: {} }),
    ]).toEqual([
      { kind: "attached", links: ["https://a.example"], media: 0, tried: undefined },
      { kind: "self-evident", why: "the DM is the question" },
      { kind: "tried", tried: "Datadog refused the share link" },
      undefined,
    ]);
  });

  const MALFORMED: Readonly<Record<string, unknown>> = {
    "attached with nothing attached": { kind: "attached", links: [], media: 0 },
    "attached with a count that is not a number": { kind: "attached", links: [], media: "3" },
    "attached with a link that is not text": { kind: "attached", links: [7], media: 0 },
    "attached with a blank tried": { kind: "attached", links: ["https://a.example"], media: 0, tried: " " },
    "a self-evident with no why": { kind: "self-evident" },
    "a tried with a blank tried": { kind: "tried", tried: "" },
    "a shape carrying a key it does not have": { kind: "tried", tried: "x", why: "y" },
    "a kind this build does not know": { kind: "screenshot" },
    "receipts that are not an object": "attached",
  };

  it("refuses every malformed one, never reading it as a row that named none", () => {
    expect(Object.keys(MALFORMED).length).toBeGreaterThan(0);
    expect(
      Object.fromEntries(
        Object.entries(MALFORMED).map(([name, receipts]) => [name, draftReceiptsOf({ draft: { receipts } })]),
      ),
    ).toEqual(Object.fromEntries(Object.keys(MALFORMED).map((name) => [name, "malformed"])));
  });
});
