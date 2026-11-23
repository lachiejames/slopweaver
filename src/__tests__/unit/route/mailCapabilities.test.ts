/** The two mailbox rows: the shared mail vocabulary, the words each keeps alone, and their place in the table. */
import { describe, expect, it } from "vitest";

import { GENERIC_SOURCE_CAPABILITIES } from "../../../route/genericCapabilities.js";

const GMAIL_CAPABILITY = GENERIC_SOURCE_CAPABILITIES.find((row) => row.id === "gmail")!;
const OUTLOOK_CAPABILITY = GENERIC_SOURCE_CAPABILITIES.find((row) => row.id === "outlook")!;

describe("the mailbox rows", () => {
  it("scope each mailbox by its own connect status, never by a search the question would be pasted into", () => {
    expect(GMAIL_CAPABILITY.command).toEqual(["slopweaver", "gmail", "connect", "--status"]);
    expect(OUTLOOK_CAPABILITY.command).toEqual(["slopweaver", "outlook", "connect", "--status"]);
  });

  it("share the mail words, and keep each provider's own name to its own row", () => {
    const shared = GMAIL_CAPABILITY.terms.filter((term) => OUTLOOK_CAPABILITY.terms.includes(term));
    expect(shared).toEqual([
      "email",
      "emails",
      "mail",
      "inbox",
      "attachment",
      "attachments",
      "mailbox",
      "transcript",
      "transcripts",
      "recording",
      "recordings",
      "note",
      "notes",
      "meeting-transcript",
      "meeting-transcripts",
      "meeting-recording",
      "meeting-recordings",
      "meeting-note",
      "meeting-notes",
    ]);
    expect(OUTLOOK_CAPABILITY.terms.filter((term) => !shared.includes(term))).toEqual(["outlook", "hotmail"]);
    expect(GMAIL_CAPABILITY.terms.filter((term) => !shared.includes(term))).toEqual(["gmail", "invite", "invitation"]);
  });

  it("sit in the generic table with Outlook directly behind Gmail", () => {
    const gmailAt = GENERIC_SOURCE_CAPABILITIES.indexOf(GMAIL_CAPABILITY);
    expect(gmailAt).toBeGreaterThan(0);
    expect(GENERIC_SOURCE_CAPABILITIES[gmailAt + 1]).toBe(OUTLOOK_CAPABILITY);
  });

  it("name the attachment hop the Outlook read leaves to the attachments row", () => {
    expect(OUTLOOK_CAPABILITY.coverage.detail).toContain(
      "`slopweaver outlook attachment <message-id> --name <file>` saves the bytes",
    );
  });
});
