/**
 * Unit: the stored mail an inbox-triage card draws — its argv, its readers, the route answer's state, and the cache.
 */
import { describe, expect, it } from "vitest";
import { cardMailStateOf, keepStoredIndex, remember } from "../../components/console/useCardMail";
import { readCardMailBody, readCardMailIndex, readCardMailIndexAnswer } from "../../components/live/readCardMail";
import { cardMailArgv, cardMailReadOf, isInboxTriageSlug } from "../../lib/cardMailVerb";
import { receivedAt, shownOr } from "../../lib/mailThreadLayout";

describe("shownOr", () => {
  it("draws a header's value when the message carried one", () => {
    expect(shownOr({ value: "Notices", whenAbsent: "no sender" })).toBe("Notices");
  });

  it("draws what the absence means when it did not", () => {
    expect(shownOr({ value: undefined, whenAbsent: "no sender" })).toBe("no sender");
  });
});

describe("receivedAt", () => {
  it("reads an instant the way Gmail's header does, in the zone it is given", () => {
    expect(receivedAt({ iso: "2026-10-03T09:30:00.000Z", timeZone: "Australia/Sydney" })).toBe("Oct 3, 2026, 7:30 PM");
  });

  it("says a value that is no instant is unreadable, rather than throwing and taking the card down", () => {
    expect(receivedAt({ iso: "not-a-date", timeZone: "UTC" })).toBe("date unreadable");
  });
});

const SLUG = "inbox-triage-20261001-from-notices-example-com";
const ID = "0123456789abcdef";

/** One stored message's headers, as `gmail card-mail <slug> --json` prints it. */
function header(): Record<string, unknown> {
  return {
    cc: [],
    from: "Example Notices <notices@example.com>",
    id: ID,
    kind: "message",
    receivedAtIso: "2026-10-01T09:30:00.000Z",
    subject: "Your plan renews soon",
    to: ["someone@example.com"],
  };
}

/** The index document, with any field replaced. */
function indexDocument({ over = {} }: { over?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    key: "k",
    mails: [header(), { id: "fedcba9876543210", kind: "gone" }],
    omittedCount: 0,
    pinnedCount: 2,
    schemaVersion: 1,
    slug: SLUG,
    storedAtIso: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

/** One message document carrying `body`. */
function messageDocument({ body, id = ID }: { body: Record<string, unknown>; id?: string }): Record<string, unknown> {
  return { body, header: { ...header(), id }, schemaVersion: 1, slug: SLUG };
}

describe("isInboxTriageSlug", () => {
  it("accepts an inbox-triage slug", () => {
    expect(isInboxTriageSlug({ slug: SLUG })).toBe(true);
  });

  it("refuses the bare prefix, another card's slug, upper case and a path", () => {
    expect(isInboxTriageSlug({ slug: "inbox-triage-" })).toBe(false);
    expect(isInboxTriageSlug({ slug: "ask-the-team" })).toBe(false);
    expect(isInboxTriageSlug({ slug: "inbox-triage-ABC" })).toBe(false);
    expect(isInboxTriageSlug({ slug: "inbox-triage-../secrets" })).toBe(false);
  });

  it("refuses a slug past the verb's file-name bound", () => {
    expect(isInboxTriageSlug({ slug: `inbox-triage-${"a".repeat(107)}` })).toBe(true);
    expect(isInboxTriageSlug({ slug: `inbox-triage-${"a".repeat(108)}` })).toBe(false);
  });
});

describe("cardMailArgv", () => {
  it("reads the headers with no message, and never fetches", () => {
    expect(cardMailArgv({ message: null, slug: SLUG })).toEqual({
      argv: ["gmail", "card-mail", SLUG, "--json"],
      kind: "argv",
      title: `slopweaver gmail card-mail ${SLUG} --json`,
    });
  });

  it("reads one body with a message id", () => {
    expect(cardMailArgv({ message: ID, slug: SLUG })).toEqual({
      argv: ["gmail", "card-mail", SLUG, "--message", ID, "--json"],
      kind: "argv",
      title: `slopweaver gmail card-mail ${SLUG} --message ${ID} --json`,
    });
  });

  it("refuses a slug that is not an inbox-triage card's", () => {
    expect(cardMailArgv({ message: null, slug: "--fetch" })).toEqual({
      kind: "refused",
      why: "the slug is not an inbox-triage card's",
    });
  });

  it("refuses a message id that is not sixteen hex digits", () => {
    expect(cardMailArgv({ message: "--fetch", slug: SLUG })).toEqual({
      kind: "refused",
      why: "the message id is not a Gmail id (sixteen hex digits)",
    });
  });
});

describe("readCardMailIndex", () => {
  it("reads every header, a gone one included, and an absent header as undefined", () => {
    const read = readCardMailIndex({
      payload: indexDocument({
        over: {
          mails: [
            { ...header(), subject: null },
            { id: "f", kind: "gone" },
          ],
        },
      }),
    });
    expect(read).toEqual({
      mails: [
        {
          cc: [],
          from: "Example Notices <notices@example.com>",
          id: ID,
          kind: "message",
          receivedAtIso: "2026-10-01T09:30:00.000Z",
          subject: undefined,
          to: ["someone@example.com"],
        },
        { id: "f", kind: "gone" },
      ],
      omittedCount: 0,
      pinnedCount: 2,
      slug: SLUG,
      storedAtIso: "2026-10-01T10:00:00.000Z",
    });
  });

  it("refuses another schema version", () => {
    expect(readCardMailIndex({ payload: indexDocument({ over: { schemaVersion: 2 } }) })).toBe(undefined);
  });

  it("refuses the whole document when one header will not read, never drawing a card with a mail missing", () => {
    const broken = { ...header(), to: "someone@example.com" };
    expect(readCardMailIndex({ payload: indexDocument({ over: { mails: [header(), broken] } }) })).toBe(undefined);
  });

  it("refuses a header of an unknown kind", () => {
    const odd = { ...header(), kind: "draft" };
    expect(readCardMailIndex({ payload: indexDocument({ over: { mails: [odd] } }) })).toBe(undefined);
  });
});

describe("readCardMailIndexAnswer", () => {
  it("reads a card that pinned nothing as unpinned, so the card draws no mail rather than a failed read", () => {
    expect(readCardMailIndexAnswer({ payload: { pinned: false, schemaVersion: 1, slug: SLUG }, slug: SLUG })).toEqual({
      kind: "unpinned",
      slug: SLUG,
    });
  });

  it("reads a stored index as stored", () => {
    const answer = readCardMailIndexAnswer({ payload: indexDocument(), slug: SLUG });
    expect(answer).toEqual({ index: readCardMailIndex({ payload: indexDocument() }), kind: "stored" });
    expect(readCardMailIndex({ payload: indexDocument() })!.pinnedCount).toBe(2);
  });

  it("refuses either answer about another card, so one card's answer never hides another's mail", () => {
    const other = "inbox-triage-20261001-from-someone-else";
    expect(readCardMailIndexAnswer({ payload: { pinned: false, schemaVersion: 1, slug: SLUG }, slug: other })).toBe(
      undefined,
    );
    expect(readCardMailIndexAnswer({ payload: indexDocument(), slug: other })).toBe(undefined);
  });

  it("refuses an unpinned answer of another schema, or with no slug", () => {
    expect(readCardMailIndexAnswer({ payload: { pinned: false, schemaVersion: 2, slug: SLUG }, slug: SLUG })).toBe(
      undefined,
    );
    expect(readCardMailIndexAnswer({ payload: { pinned: false, schemaVersion: 1 }, slug: SLUG })).toBe(undefined);
  });

  it("is a ready state through the route's answer, never not measured", () => {
    const read = (payload: unknown): ReturnType<typeof readCardMailIndexAnswer> =>
      readCardMailIndexAnswer({ payload, slug: SLUG });
    const body = { observedAtIso: "t", ok: true, read: { pinned: false, schemaVersion: 1, slug: SLUG } };
    expect(cardMailStateOf({ body, read })).toEqual({ phase: "ready", value: { kind: "unpinned", slug: SLUG } });
  });
});

describe("keepStoredIndex", () => {
  it("keeps stored mail for the page's life, but never an unpinned answer, which a later pin would make stale", () => {
    const index = readCardMailIndex({ payload: indexDocument() })!;
    expect([
      keepStoredIndex({ answer: { index, kind: "stored" } }),
      keepStoredIndex({ answer: { kind: "unpinned", slug: SLUG } }),
    ]).toEqual([true, false]);
  });
});

describe("cardMailReadOf", () => {
  const title = `slopweaver gmail card-mail ${SLUG} --json`;

  it("reads exit 0's document", () => {
    expect(cardMailReadOf({ ran: { ok: true, out: '{"a":1}' }, title })).toEqual({ ok: true, read: { a: 1 } });
  });

  it("reads exit 3's document when it printed one: a card that pinned nothing", () => {
    const out = JSON.stringify({ pinned: false, schemaVersion: 1, slug: SLUG });
    expect(cardMailReadOf({ ran: { exitCode: 3, notMeasured: "exit 3", ok: false, out }, title })).toEqual({
      ok: true,
      read: { pinned: false, schemaVersion: 1, slug: SLUG },
    });
  });

  it("keeps exit 3 with nothing printed, exit 1, and a timeout not measured, with the verb's own reason", () => {
    const reasons = [
      { exitCode: 3, notMeasured: "no stored mail", ok: false as const, out: "" },
      { exitCode: 1, notMeasured: "malformed pin", ok: false as const, out: '{"a":1}' },
      { exitCode: undefined, notMeasured: "timed out", ok: false as const, out: "" },
    ].map((ran) => cardMailReadOf({ ran, title }));
    expect(reasons).toEqual([
      { notMeasured: "no stored mail", ok: false },
      { notMeasured: "malformed pin", ok: false },
      { notMeasured: "timed out", ok: false },
    ]);
  });

  it("names a document that is not JSON", () => {
    expect(cardMailReadOf({ ran: { ok: true, out: "nope" }, title })).toEqual({
      notMeasured: `${title} printed something that is not JSON`,
      ok: false,
    });
  });
});

describe("readCardMailBody", () => {
  it("reads an html body", () => {
    const body = { document: "<!doctype html><p>hi</p>", kind: "html", remoteImagesBlocked: 2, truncated: false };
    expect(readCardMailBody({ id: ID, payload: messageDocument({ body }) })).toEqual(body);
  });

  it("reads a text body and a body with nothing to draw", () => {
    const text = { kind: "text", text: "plain words", truncated: true };
    expect(readCardMailBody({ id: ID, payload: messageDocument({ body: text }) })).toEqual(text);
    const none = { kind: "none", truncated: false };
    expect(readCardMailBody({ id: ID, payload: messageDocument({ body: none }) })).toEqual(none);
  });

  it("refuses a document about another message", () => {
    const body = { kind: "text", text: "plain words", truncated: false };
    expect(readCardMailBody({ id: ID, payload: messageDocument({ body, id: "fedcba9876543210" }) })).toBe(undefined);
  });

  it("refuses an html body missing its blocked-image count", () => {
    const body = { document: "<p>hi</p>", kind: "html", truncated: false };
    expect(readCardMailBody({ id: ID, payload: messageDocument({ body }) })).toBe(undefined);
  });
});

describe("cardMailStateOf", () => {
  const read = (payload: unknown): string | undefined => (typeof payload === "string" ? payload : undefined);

  it("reads a route answer the reader accepts", () => {
    expect(cardMailStateOf({ body: { observedAtIso: "t", ok: true, read: "value" }, read })).toEqual({
      phase: "ready",
      value: "value",
    });
  });

  it("carries the route's own reason when it was not measured", () => {
    expect(cardMailStateOf({ body: { notMeasured: "no stored mail", observedAtIso: "t", ok: false }, read })).toEqual({
      phase: "not-measured",
      why: "no stored mail",
    });
  });

  it("names a reading the reader refused", () => {
    expect(cardMailStateOf({ body: { observedAtIso: "t", ok: true, read: 7 }, read })).toEqual({
      phase: "not-measured",
      why: "gmail card-mail answered in a shape this card does not read",
    });
  });

  it("names an answer that is not the route's", () => {
    expect(cardMailStateOf({ body: [], read })).toEqual({
      phase: "not-measured",
      why: "/api/card-mail answered something that is not a CardMailResult",
    });
  });
});

describe("remember", () => {
  it("drops the oldest entry past the bound, and a re-read entry counts as newest", () => {
    const cache = new Map<string, number>();
    remember({ cache, key: "a", max: 2, value: 1 });
    remember({ cache, key: "b", max: 2, value: 2 });
    remember({ cache, key: "a", max: 2, value: 3 });
    remember({ cache, key: "c", max: 2, value: 4 });
    expect([...cache.entries()]).toEqual([
      ["a", 3],
      ["c", 4],
    ]);
  });
});
