/** Encoding and decoding one register journal line — the round-trip, and every way a line can be unreadable. */
import { describe, expect, it } from "vitest";
import type { RegisterEvent } from "../../../../../outbound/proposal/register/events.js";
import { parseRegisterJournal, registerJournalLine } from "../../../../../outbound/proposal/register/parse.js";

const CREATED: RegisterEvent = {
  address: { id: "page-1", provider: "notion", url: "https://example.test/page-1" },
  atIso: "2026-08-01T00:00:00.000Z",
  kind: "created",
  source: "publish",
  title: "A proposal",
};

describe("registerJournalLine + parseRegisterJournal", () => {
  it("round-trips every event kind byte-for-byte through JSON", () => {
    const events: readonly RegisterEvent[] = [
      CREATED,
      {
        address: { id: "doc-2", provider: "linear" },
        atIso: "2026-08-02T00:00:00.000Z",
        kind: "destination-linked",
        title: "Renamed",
      },
      { atIso: "2026-08-03T00:00:00.000Z", kind: "status-changed", status: "shared", why: "posted" },
      {
        atIso: "2026-08-04T00:00:00.000Z",
        decidedIso: "2026-08-04T00:00:00.000Z",
        decider: "the owner",
        decision: "ship it",
        kind: "decided",
        outcome: "approved",
        why: "aligned",
      },
      { atIso: "2026-08-05T00:00:00.000Z", by: "newer", kind: "superseded", why: "v2" },
      { atIso: "2026-08-06T00:00:00.000Z", kind: "slack-linked", permalink: "https://slack/x" },
      { atIso: "2026-08-07T00:00:00.000Z", kind: "follow-up-added", label: "the fix", ref: "a-doc" },
      { atIso: "2026-08-08T00:00:00.000Z", audience: "eng", kind: "audience-set" },
    ];
    const text = events.map((event) => registerJournalLine({ event })).join("");
    const parsed = parseRegisterJournal({ text });
    expect(parsed.unreadable).toEqual([]);
    expect(parsed.events).toEqual(events);
  });

  it("ends every line with a newline, so appends cannot fuse two events", () => {
    expect(registerJournalLine({ event: CREATED }).endsWith("\n")).toBe(true);
  });

  it("an empty journal parses to no events and no unreadable lines", () => {
    const parsed = parseRegisterJournal({ text: "" });
    expect(parsed.events).toEqual([]);
    expect(parsed.unreadable).toEqual([]);
  });

  it("skips blank lines without counting them as unreadable", () => {
    const text = `${registerJournalLine({ event: CREATED })}\n`;
    const parsed = parseRegisterJournal({ text });
    expect(parsed.events.length).toBe(1);
    expect(parsed.unreadable).toEqual([]);
  });

  it("reports invalid JSON as an unreadable line, at its 1-indexed line number", () => {
    const text = `${registerJournalLine({ event: CREATED })}not json at all\n`;
    const parsed = parseRegisterJournal({ text });
    expect(parsed.events.length).toBe(1);
    expect(parsed.unreadable).toEqual([2]);
  });

  it("reports an unknown kind as unreadable rather than decoding a guess", () => {
    const text = `${JSON.stringify({ atIso: "2026-08-01T00:00:00.000Z", kind: "renamed-somehow" })}\n`;
    expect(parseRegisterJournal({ text }).unreadable).toEqual([1]);
  });

  it("reports a status-changed line naming a non-settable status as unreadable, never silently coerced", () => {
    const text = `${JSON.stringify({ atIso: "2026-08-01T00:00:00.000Z", kind: "status-changed", status: "decided", why: "x" })}\n`;
    expect(parseRegisterJournal({ text }).unreadable).toEqual([1]);
  });

  it("reports a created line missing a required field as unreadable", () => {
    const text = `${JSON.stringify({ atIso: "2026-08-01T00:00:00.000Z", kind: "created", pageId: "p", source: "publish", title: "t" })}\n`;
    expect(parseRegisterJournal({ text }).unreadable).toEqual([1]);
  });
});

describe("the migration provider-tagged addresses have to survive", () => {
  // Byte-for-byte the shapes a register journal held before addresses were provider-tagged, committed as
  // strings so they are never rewritten through the new serializer before being read.
  const LEGACY_CREATED =
    '{"atIso":"2026-08-01T00:00:00.000Z","kind":"created","pageId":"page-1",' +
    '"pageUrl":"https://example.test/page-1","source":"publish","title":"A proposal"}';
  const LEGACY_LINKED =
    '{"atIso":"2026-08-02T00:00:00.000Z","kind":"page-linked","pageId":"page-2",' +
    '"pageUrl":"https://example.test/page-2","title":"Renamed"}';

  it("decodes a legacy created line as the Notion address it always was", () => {
    expect(parseRegisterJournal({ text: `${LEGACY_CREATED}\n` })).toEqual({ events: [CREATED], unreadable: [] });
  });

  it("decodes a legacy page-linked line as a destination-linked event", () => {
    expect(parseRegisterJournal({ text: `${LEGACY_LINKED}\n` }).events).toEqual([
      {
        address: { id: "page-2", provider: "notion", url: "https://example.test/page-2" },
        atIso: "2026-08-02T00:00:00.000Z",
        kind: "destination-linked",
        title: "Renamed",
      },
    ]);
  });

  it("never rescues a malformed address from valid-looking legacy fields beside it", () => {
    const mixed =
      '{"address":{"id":"","provider":"notion"},"atIso":"2026-08-01T00:00:00.000Z","kind":"created",' +
      '"pageId":"page-1","pageUrl":"https://example.test/page-1","source":"publish","title":"t"}';
    expect(parseRegisterJournal({ text: `${mixed}\n` })).toEqual({ events: [], unreadable: [1] });
  });

  it("refuses a well-formed address carried beside a legacy page field as ambiguous", () => {
    const both =
      '{"address":{"id":"page-1","provider":"notion"},"atIso":"2026-08-01T00:00:00.000Z","kind":"created",' +
      '"pageId":"page-1","source":"publish","title":"t"}';
    expect(parseRegisterJournal({ text: `${both}\n` })).toEqual({ events: [], unreadable: [1] });
  });

  it("refuses an address naming a provider this build does not know", () => {
    const unknown =
      '{"address":{"id":"x","provider":"confluence"},"atIso":"2026-08-01T00:00:00.000Z","kind":"created",' +
      '"source":"publish","title":"t"}';
    expect(parseRegisterJournal({ text: `${unknown}\n` })).toEqual({ events: [], unreadable: [1] });
  });

  it("writes a new line with the address alone and no legacy page field", () => {
    const written = JSON.parse(registerJournalLine({ event: CREATED })) as Record<string, unknown>;
    expect(Object.keys(written).toSorted()).toEqual(["address", "atIso", "kind", "source", "title"]);
  });
});

describe("the migration a richer status model has to survive", () => {
  it("decodes a decided line written BEFORE outcomes existed as an approval", () => {
    // Byte-for-byte the shape the first backfill wrote: no `outcome` field, because the verb had no way to
    // express a rejection at all. `approved` is what that line MEANT, not a hopeful default.
    const legacy =
      '{"atIso":"2026-08-22T12:03:07.329Z","decidedIso":"2026-07-07T05:41:33Z","decider":"the owner",' +
      '"decision":"ship the pre-merge check","kind":"decided","why":"send it in the announce thread"}';
    const parsed = parseRegisterJournal({ text: `${legacy}\n` });
    expect(parsed.unreadable).toEqual([]);
    expect(parsed.events).toEqual([
      {
        atIso: "2026-08-22T12:03:07.329Z",
        decidedIso: "2026-07-07T05:41:33Z",
        decider: "the owner",
        decision: "ship the pre-merge check",
        kind: "decided",
        outcome: "approved",
        why: "send it in the announce thread",
      },
    ]);
  });

  it("refuses a decided line whose outcome is present but not one of the two", () => {
    const bad =
      '{"atIso":"2026-08-22T12:03:07.329Z","decidedIso":"2026-07-07T05:41:33Z","decider":"o",' +
      '"decision":"d","kind":"decided","outcome":"maybe","why":"w"}';
    expect(parseRegisterJournal({ text: `${bad}\n` })).toEqual({ events: [], unreadable: [1] });
  });

  it("decodes the three statuses the enum gained, and still refuses the atomic ones", () => {
    const lines = [
      '{"atIso":"2026-08-22T00:00:00.000Z","kind":"status-changed","status":"partially-implemented","why":"half"}',
      '{"atIso":"2026-08-22T00:00:00.000Z","kind":"status-changed","status":"implemented","why":"done"}',
      '{"atIso":"2026-08-22T00:00:00.000Z","kind":"status-changed","status":"rejected","why":"no"}',
    ];
    const parsed = parseRegisterJournal({ text: `${lines.join("\n")}\n` });
    expect(parsed.events.map((event) => registerJournalLine({ event }).length > 0)).toEqual([true, true]);
    expect(parsed.unreadable).toEqual([3]);
  });

  it("round-trips an occurrence date on a status change, a supersession and a follow-up", () => {
    const events: readonly RegisterEvent[] = [
      {
        atIso: "2026-08-22T00:00:00.000Z",
        kind: "status-changed",
        occurredIso: "2026-07-08T00:00:00.000Z",
        status: "implemented",
        why: "done",
      },
      {
        atIso: "2026-08-22T00:00:00.000Z",
        by: "another",
        kind: "superseded",
        occurredIso: "2026-07-09T00:00:00.000Z",
        why: "replaced",
      },
      {
        atIso: "2026-08-22T00:00:00.000Z",
        kind: "follow-up-added",
        occurredIso: "2026-07-10T00:00:00.000Z",
        ref: "SECU-8",
      },
    ];
    const text = events.map((event) => registerJournalLine({ event })).join("");
    expect(parseRegisterJournal({ text }).events).toEqual(events);
  });

  it("round-trips a feedback pair, and refuses an unknown feedback kind", () => {
    const events: readonly RegisterEvent[] = [
      {
        atIso: "2026-08-22T00:00:00.000Z",
        feedbackKind: "pushback",
        id: "f1",
        kind: "feedback-recorded",
        what: "too broad",
        where: "https://slack.test/1",
        who: "a reviewer",
      },
      { atIso: "2026-08-23T00:00:00.000Z", how: "narrowed it", id: "f1", kind: "feedback-answered" },
    ];
    const text = events.map((event) => registerJournalLine({ event })).join("");
    expect(parseRegisterJournal({ text }).events).toEqual(events);

    const badKind =
      '{"atIso":"2026-08-22T00:00:00.000Z","feedbackKind":"grumbling","id":"f1","kind":"feedback-recorded",' +
      '"what":"w","who":"x"}';
    expect(parseRegisterJournal({ text: `${badKind}\n` })).toEqual({ events: [], unreadable: [1] });
  });
});
