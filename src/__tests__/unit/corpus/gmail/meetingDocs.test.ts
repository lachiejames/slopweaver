/**
 * The meeting-document pass: which links are followed, how often, and what a failure costs.
 *
 * The seam is a plain object fake rather than a mock — the module's whole contract is which calls it makes
 * and how many, so the fake counts them and the assertions are on the count.
 */
import { describe, expect, it } from "vitest";

import { fetchMeetingDocs, MAX_MEETING_DOCS } from "../../../../corpus/gmail/meetingDocs.js";
import { err, ok } from "../../../../lib/result.js";
import type { DocContent, GoogleDocsApi } from "../../../../live/gmail/docs.js";
import { GmailErrors } from "../../../../live/gmail/errors.js";
import type { ParsedGmailMessage } from "../../../../live/gmail/parse.js";

const BASE: ParsedGmailMessage = {
  attachments: [],
  body: "Summary",
  bodyFormat: "text",
  cc: [],
  from: "Gemini <gemini-notes@google.com>",
  htmlLinks: [],
  id: "m1",
  labelIds: [],
  sentAtIso: "2026-08-25T02:08:54.000Z",
  snippet: undefined,
  subject: "Notes: 'Widget Working Group' 25 Aug 2026",
  threadId: "t1",
  to: [],
};

const notesEmail = ({ id, docId }: { id: string; docId: string }): ParsedGmailMessage => ({
  ...BASE,
  htmlLinks: [`https://docs.google.com/document/d/${docId}/edit?tab=t.0`],
  id,
});

const doc = ({ documentId }: { documentId: string }): DocContent => ({
  documentId,
  tabs: [{ text: "Attendees: Ana Diaz", title: "Summary" }],
  title: "Widget Working Group",
});

/** A counting fake seam: `calls` is the whole assertion surface. */
function fakeDocs({ failing = [] }: { failing?: readonly string[] } = {}): {
  api: GoogleDocsApi;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    api: {
      getDocument: async ({ documentId }) => {
        calls.push(documentId);
        return failing.includes(documentId)
          ? err(GmailErrors.apiFailed({ message: `document ${documentId} is not shared with you` }))
          : ok(doc({ documentId }));
      },
    },
    calls,
  };
}

describe("fetchMeetingDocs", () => {
  it("follows the link of a recognised notes email and keys the result by the CARRIER message id", async () => {
    const fake = fakeDocs();
    const result = await fetchMeetingDocs({ docsApi: fake.api, messages: [notesEmail({ docId: "d1", id: "m1" })] });

    expect(fake.calls).toEqual(["d1"]);
    expect(result.documents.get("m1")?.documentId).toBe("d1");
    expect(result.warnings).toEqual([]);
  });

  it("does NOT follow a link in ordinary mail, even one pointing at a Google Doc", async () => {
    const fake = fakeDocs();
    const ordinary: ParsedGmailMessage = {
      ...BASE,
      from: "Someone <someone@example.test>",
      htmlLinks: ["https://docs.google.com/document/d/d9/edit"],
    };
    const result = await fetchMeetingDocs({ docsApi: fake.api, messages: [ordinary] });

    expect(fake.calls).toEqual([]);
    expect(result.documents.size).toBe(0);
  });

  it("fetches a repeated document ONCE and serves both carriers from the same read", async () => {
    const fake = fakeDocs();
    const result = await fetchMeetingDocs({
      docsApi: fake.api,
      messages: [notesEmail({ docId: "d1", id: "m1" }), notesEmail({ docId: "d1", id: "m2" })],
    });

    expect(fake.calls).toEqual(["d1"]);
    expect(result.documents.get("m1")?.documentId).toBe("d1");
    expect(result.documents.get("m2")?.documentId).toBe("d1");
  });

  it("turns an unreadable document into ONE warning and keeps going with the rest", async () => {
    const fake = fakeDocs({ failing: ["d1"] });
    const result = await fetchMeetingDocs({
      docsApi: fake.api,
      messages: [notesEmail({ docId: "d1", id: "m1" }), notesEmail({ docId: "d2", id: "m2" })],
    });

    expect(fake.calls).toEqual(["d1", "d2"]);
    expect(result.documents.has("m1")).toBe(false);
    expect(result.documents.get("m2")?.documentId).toBe("d2");
    expect(result.warnings).toEqual(["meeting document d1: not read (document d1 is not shared with you)"]);
  });

  it("stops at its document ceiling, says how many meetings it cost, and keeps what it read", async () => {
    const fake = fakeDocs();
    const messages = Array.from({ length: MAX_MEETING_DOCS + 3 }, (_unused, index) =>
      notesEmail({ docId: `d${String(index)}`, id: `m${String(index)}` }),
    );
    const result = await fetchMeetingDocs({ docsApi: fake.api, messages });

    expect(fake.calls.length).toBe(MAX_MEETING_DOCS);
    expect(result.documents.size).toBe(MAX_MEETING_DOCS);
    expect(result.warnings[0]).toContain("3 meeting(s) were not stored at all");
  });

  it("with no Docs grant, reads nothing and says how to widen it — once, not once per meeting", async () => {
    const result = await fetchMeetingDocs({
      docsApi: undefined,
      messages: [notesEmail({ docId: "d1", id: "m1" }), notesEmail({ docId: "d2", id: "m2" })],
    });

    expect(result.documents.size).toBe(0);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("2 meeting-notes email(s) link a transcript this grant cannot read");
    expect(result.warnings[0]).toContain("slopweaver gmail connect");
  });

  it("with no Docs grant and no meetings, says nothing at all", async () => {
    const result = await fetchMeetingDocs({ docsApi: undefined, messages: [BASE] });
    expect(result.warnings).toEqual([]);
  });
});

describe("fetchMeetingDocs names why each carrier has no document", () => {
  it("files a refused document against EVERY carrier linking it, from one call", async () => {
    const fake = fakeDocs({ failing: ["d1"] });
    const result = await fetchMeetingDocs({
      docsApi: fake.api,
      messages: [notesEmail({ docId: "d1", id: "m1" }), notesEmail({ docId: "d1", id: "m2" })],
    });

    expect(fake.calls).toEqual(["d1"]);
    expect([...result.failures.values()]).toEqual([
      { documentId: "d1", kind: "provider-error", message: "document d1 is not shared with you", messageId: "m1" },
      { documentId: "d1", kind: "provider-error", message: "document d1 is not shared with you", messageId: "m2" },
    ]);
    expect(result.warnings).toEqual(["meeting document d1: not read (document d1 is not shared with you)"]);
  });

  it("names a carrier with no link and one whose link carries no document id, calling nothing", async () => {
    const fake = fakeDocs();
    const malformed: ParsedGmailMessage = {
      ...BASE,
      htmlLinks: ["https://docs.google.com/document/d/"],
      id: "m2",
    };
    const result = await fetchMeetingDocs({ docsApi: fake.api, messages: [BASE, malformed] });

    expect(fake.calls).toEqual([]);
    expect([...result.failures.values()]).toEqual([
      { kind: "no-link", messageId: "m1" },
      { kind: "malformed-link", messageId: "m2", url: "https://docs.google.com/document/d/" },
    ]);
  });

  it("files every linked carrier as no-docs-grant when the grant cannot read documents", async () => {
    const result = await fetchMeetingDocs({
      docsApi: undefined,
      messages: [notesEmail({ docId: "d1", id: "m1" }), { ...BASE, id: "m2" }],
    });

    expect([...result.failures.values()]).toEqual([
      { kind: "no-link", messageId: "m2" },
      { kind: "no-docs-grant", messageId: "m1" },
    ]);
  });

  it("files each meeting past the ceiling as capped, naming its document", async () => {
    const fake = fakeDocs();
    const messages = Array.from({ length: MAX_MEETING_DOCS + 1 }, (_unused, index) =>
      notesEmail({ docId: `d${String(index)}`, id: `m${String(index)}` }),
    );
    const result = await fetchMeetingDocs({ docsApi: fake.api, messages });

    expect([...result.failures.values()]).toEqual([
      { documentId: `d${String(MAX_MEETING_DOCS)}`, kind: "capped", messageId: `m${String(MAX_MEETING_DOCS)}` },
    ]);
  });
});
