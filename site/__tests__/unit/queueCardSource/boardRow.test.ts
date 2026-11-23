/*
 * Where a board row's queue card came from, from `handover list --json` to the block the expanded card leads with and
 * the refusal its form carries. The owner's own words, verbatim, lead the card; a card from the fleet says it carries
 * none of theirs; a card whose anchor names their words but holds none refuses. Driven through the real readers, so
 * every row is one the page would actually hold.
 */

import { describe, expect, it } from "vitest";

import { readRowHisWords } from "../../../components/live/readHisWords";
import { sourceForm } from "../../../lib/queueCardSource";
import { reasonTextOf } from "../../../lib/quotedReason";
import { sourceBlockCopy } from "../../../lib/sourceBlock";
import { askRowOf, MISSING, QUOTE, SUBJECT, sourceOf, TALK } from "./harness";

describe("a board row's source", () => {
  it("is the owner's words when the row carries them, relayed at the instant the turn records — and the card draws", () => {
    const row = askRowOf({ fields: { anchor: TALK, ownerWords: QUOTE } });
    expect(row.source).toEqual({ kind: "words", quote: QUOTE, steers: [], subject: SUBJECT });
    expect(row.record.form).toEqual({ kind: "drawn" });
    expect(sourceBlockCopy({ source: row.source })).toEqual({
      label: "your words",
      line: "You said this to the console voice; the voice transcript relayed it at 2026-09-28 06:03Z.",
      quoted: [],
      sessionSteps: {
        lead: "You said this to the console voice; the voice transcript relayed it at 2026-09-28 06:03Z.",
        steps: [],
      },
      tone: "owner",
      words: { cut: "none", text: QUOTE.words },
    });
  });

  it("refuses the card when the anchor names the owner's words and the row holds none", () => {
    const row = askRowOf({ fields: { anchor: TALK } });
    expect(row.source).toEqual({
      anchor: TALK,
      kind: "unquoted",
      steers: [],
      subject: SUBJECT,
      why: "no quote is stored on its board row yet",
    });
    expect(row.record.form).toEqual({ kind: "refused", why: MISSING });
  });

  it("says the record would not read plainly, its own reason beneath the line, and still draws the card", () => {
    const raw = "ENOENT: open '/tmp/turn.json'";
    const row = askRowOf({ fields: { anchor: TALK, ownerWordsUnread: raw } });
    expect(row.source).toEqual({
      anchor: TALK,
      kind: "unreadable",
      steers: [],
      subject: SUBJECT,
      why: [{ lead: "its record would not read", why: raw }],
    });
    expect(row.record.form).toEqual({ kind: "drawn" });
    const copy = sourceBlockCopy({ source: row.source });
    expect([copy.label, copy.line, copy.hover, copy.quoted]).toEqual([
      "where this came from",
      "It points at something taken for your words to the console voice, but no words of yours were read there.",
      TALK,
      [{ lead: "its record would not read", why: raw }],
    ]);
  });

  it("refuses a row whose published quote does not read, naming the wire", () => {
    const source = sourceOf({ fields: { anchor: TALK, ownerWords: { ...QUOTE, where: "somewhere" } } });
    expect(source).toEqual({
      anchor: TALK,
      kind: "unquoted",
      steers: [],
      subject: SUBJECT,
      why: [
        {
          lead: "the quote stored on its board row does not read",
          why: "the board published a quote for this row that does not read",
        },
      ],
    });
  });

  it("refuses that card with the console's framing on the lead and the read's own reason left whole", () => {
    const source = sourceOf({ fields: { anchor: TALK, ownerWords: { ...QUOTE, where: "somewhere" } } });
    const lead =
      "This card came from your words to the console voice, but they are not on it until `slopweaver handover " +
      "quote --apply` writes them, because the quote stored on its board row does not read";
    const why = "the board published a quote for this row that does not read";
    const form = sourceForm({ source });
    expect(form).toEqual({ kind: "refused", why: [{ lead, why }] });
    // What the voice and the refusal report say: the lead ends on what did not read, so the reason follows it whole.
    expect(reasonTextOf({ reason: (form as Extract<typeof form, { kind: "refused" }>).why })).toBe(`${lead}: ${why}`);
  });

  it("refuses a row publishing both a quote and an unread record", () => {
    const said = readRowHisWords({ row: { hisWords: QUOTE, hisWordsUnread: "no record" } });
    expect(said).toEqual({
      kind: "defect",
      why: "the board published both a quote and an unread record for this row",
    });
  });

  it("reads the owner-neutral field over its pronoun twin when a row publishes both", () => {
    const said = readRowHisWords({ row: { hisWordsUnread: "older board", ownerWords: QUOTE } });
    expect(said).toEqual({ kind: "held", quote: QUOTE });
  });

  it("refuses a row publishing an unread record that is not a string", () => {
    expect(readRowHisWords({ row: { hisWordsUnread: 7 } })).toEqual({
      kind: "defect",
      why: "the board published an unread record for this row that does not read",
    });
  });

  it("says a fleet finding carries none of the owner's words, its observer's id behind the hover", () => {
    const source = sourceOf({ fields: { observedBy: "a787443c", origin: "finding" } });
    expect(source).toEqual({
      hover: "session a787443c",
      kind: "none",
      origin: "a fleet finding a session observed",
      steers: [],
      subject: SUBJECT,
    });
    expect(sourceForm({ source })).toEqual({ kind: "drawn" });
    expect(sourceBlockCopy({ source })).toEqual({
      hover: "session a787443c",
      label: "not your words",
      line: "No words of yours behind this; it came from a fleet finding a session observed.",
      quoted: [],
      sessionSteps: {
        lead: "No words of yours behind this; it came from a fleet finding a session observed.",
        steps: [],
      },
      tone: "not-owner",
      words: undefined,
    });
  });

  it("points at a Slack anchor rather than claiming the owner's words", () => {
    const anchor = "https://acme.slack.com/archives/C01/p1727500000000000";
    expect(sourceOf({ fields: { anchor } })).toEqual({ anchor, kind: "elsewhere", steers: [], subject: SUBJECT });
  });

  it("says where it came from is unrecorded when the row carries no anchor and no registering session", () => {
    expect(sourceOf({ fields: {} })).toEqual({
      kind: "unrecorded",
      origin: "its board row records no anchor for where it came from",
      steers: [],
      subject: SUBJECT,
    });
  });

  it("names the run that registered a row with no anchor in words, its session id behind the hover", () => {
    const source = sourceOf({
      fields: {
        registeredBy: "a0000056-0000-4000-8000-000000000062",
        registeredRun: "carry-out-the-three-rulings-on-the-dependency",
      },
    });
    expect(source).toEqual({
      kind: "registered",
      run: "carry-out-the-three-rulings-on-the-dependency",
      session: "a0000056-0000-4000-8000-000000000062",
      steers: [],
      subject: SUBJECT,
    });
    expect(sourceBlockCopy({ source })).toEqual({
      hover: "session a0000056-0000-4000-8000-000000000062, run carry-out-the-three-rulings-on-the-dependency",
      label: "where this came from",
      line:
        "A Claude session put this on your queue while it ran carry out the three rulings on the dependency; it " +
        "recorded no link to words of yours behind it. If it came from you, a session finds your turn with " +
        "`slopweaver profile words` and ties it here with `slopweaver handover quote <slug> --anchor <anchor> --apply`.",
      quoted: [],
      // The same line, its session step folded apart from what the owner reads: the producer marked it, nothing parsed it.
      sessionSteps: {
        lead:
          "A Claude session put this on your queue while it ran carry out the three rulings on the dependency; it " +
          "recorded no link to words of yours behind it.",
        steps: [
          "If it came from you, a session finds your turn with `slopweaver profile words` and ties it here with " +
            "`slopweaver handover quote <slug> --anchor <anchor> --apply`.",
        ],
      },
      tone: "unknown",
      words: undefined,
    });
  });

  it("names no session at all when the registering session held no run", () => {
    const source = sourceOf({ fields: { registeredBy: "session-1" } });
    expect([sourceBlockCopy({ source }).line, sourceBlockCopy({ source }).hover]).toEqual([
      "A Claude session put this on your queue; it recorded no link to words of yours behind it. If it came " +
        "from you, a session finds your turn with `slopweaver profile words` and ties it here with " +
        "`slopweaver handover quote <slug> --anchor <anchor> --apply`.",
      "session session-1",
    ]);
  });

  it("puts a run that is itself a machine id behind the hover too", () => {
    const run = "a0000019-95ad-4577-8f54-6e87dac78d92";
    const source = sourceOf({ fields: { registeredBy: "session-1", registeredRun: run } });
    expect(sourceBlockCopy({ source }).line.startsWith("A Claude session put this on your queue;")).toBe(true);
    expect(sourceBlockCopy({ source }).hover).toBe(`session session-1, run ${run}`);
  });

  it("prefers an anchor to the registering session", () => {
    const anchor = "https://acme.slack.com/archives/C01/p1727500000000000";
    expect(sourceOf({ fields: { anchor, registeredBy: "session-1" } })).toEqual({
      anchor,
      kind: "elsewhere",
      steers: [],
      subject: SUBJECT,
    });
  });
});
