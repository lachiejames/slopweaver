/*
 * The Queue's ISO half: an ISO card is one tagged `workstream=iso-certification` whose tags read whole, a check-in is
 * never named, and the card open in Slopweaver is found by its key or an alias.
 */
import { describe, expect, it } from "vitest";

import { ISO_ITEM_SUBJECT_MAX_CHARS } from "../../lib/isoNudgeNotice";
import { type IsoQueueRow, isoQueueSnapshot } from "../../lib/isoQueueItems";

/** A Queue row as the watch reads it. */
const row = ({
  key,
  subject,
  iso = true,
  ...over
}: Partial<IsoQueueRow> & { key: string; subject: string; iso?: boolean }): IsoQueueRow => ({
  card: { subject },
  key,
  tags: iso ? [{ key: "workstream", value: "iso-certification" }] : [{ key: "workstream", value: "devex" }],
  tagsRead: "whole",
  tier: "fleet-blocked",
  ...over,
});

const VANTA_DOCS = row({ key: "handover:six-vanta-evidence-documents", subject: "Six Vanta evidence documents" });
const ACCESS_REVIEW = row({
  key: "handover:open-the-access-review-pr",
  subject: "Open the access review PR",
  tier: "team-blocked",
});
const DEVEX = row({ iso: false, key: "pr:2310", subject: "Call trays pop out left" });

describe("isoQueueSnapshot", () => {
  it("names only the tagged cards, in the order given, by key and subject", () => {
    expect(isoQueueSnapshot({ openKey: undefined, rows: [ACCESS_REVIEW, DEVEX, VANTA_DOCS] }).waiting).toEqual([
      { key: ACCESS_REVIEW.key, subject: "Open the access review PR" },
      { key: VANTA_DOCS.key, subject: "Six Vanta evidence documents" },
    ]);
  });

  it("never names a check-in, a card whose tags read partly, or one whose subject mentions ISO without the tag", () => {
    const rows = [
      row({ key: "act:1", subject: "How did the ISO review go", tier: "check-in" }),
      row({ key: "ask:2", subject: "Partial", tagsRead: "partial" }),
      row({ iso: false, key: "ask:3", subject: "ISO 27001 mentioned in passing" }),
    ];
    expect(isoQueueSnapshot({ openKey: undefined, rows }).waiting).toEqual([]);
  });

  it("bounds the subject a nudge will speak", () => {
    const long = row({ key: "ask:long", subject: "x".repeat(ISO_ITEM_SUBJECT_MAX_CHARS + 20) });
    expect(isoQueueSnapshot({ openKey: undefined, rows: [long] }).waiting[0].subject.length).toBe(
      ISO_ITEM_SUBJECT_MAX_CHARS,
    );
  });

  it("reads the open card as ISO, off or unknown, by key and then by alias", () => {
    const aliased = row({ aliases: ["ask:the-iso-ask"], key: "hand:step-1", subject: "Decide the ISO ask" });
    const partial = row({ key: "ask:partial", subject: "Partial", tagsRead: "partial" });
    const rows = [VANTA_DOCS, DEVEX, aliased, partial];
    expect([
      isoQueueSnapshot({ openKey: VANTA_DOCS.key, rows }).openCard,
      isoQueueSnapshot({ openKey: DEVEX.key, rows }).openCard,
      isoQueueSnapshot({ openKey: "ask:the-iso-ask", rows }).openCard,
      isoQueueSnapshot({ openKey: "ask:partial", rows }).openCard,
      isoQueueSnapshot({ openKey: "ask:gone", rows }).openCard,
      isoQueueSnapshot({ openKey: undefined, rows }).openCard,
    ]).toEqual(["iso", "off", "iso", "unknown", "unknown", "unknown"]);
  });

  it("reads an exact key before any alias that names it", () => {
    const shadow = row({ aliases: [DEVEX.key], key: "hand:shadow", subject: "Shadow" });
    expect(isoQueueSnapshot({ openKey: DEVEX.key, rows: [shadow, DEVEX] }).openCard).toBe("off");
  });
});
