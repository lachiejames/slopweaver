/*
 * `gmail triage` reading one message: the headers it asks Gmail for, a relay split into sender and group, the
 * unsubscribe kind, whether a sender is automated, and the key a message groups under.
 */
import { describe, expect, it } from "vitest";

import { LISTING_HEADERS } from "../../../../../live/gmail/headers.js";
import {
  isAutomatedSender,
  keyTriageMessage,
  splitRelayName,
  unsubscribeKindOf,
} from "../../../../../live/gmail/triageKey.js";
import { message, READ_AT } from "./harness.js";

describe("LISTING_HEADERS", () => {
  it("asks Gmail for every header triage reads, so a metadata fetch is never silently missing one", () => {
    const read = ["From", "Subject", "List-Id", "List-Unsubscribe", "List-Unsubscribe-Post", "List-Post"];
    expect(read.filter((name) => !LISTING_HEADERS.includes(name))).toEqual([]);
  });
});

describe("splitRelayName", () => {
  it("splits a Google Group relay into the original sender and the group, dropping the quotes", () => {
    expect(splitRelayName({ display: "'Othercompany Alerts' via IT Security" })).toEqual({
      group: "IT Security",
      original: "Othercompany Alerts",
    });
  });

  it("answers undefined for a plain display name, and for a separator with nothing on one side", () => {
    expect(splitRelayName({ display: "Jane Doe" })).toBe(undefined);
    expect(splitRelayName({ display: " via IT Security" })).toBe(undefined);
    expect(splitRelayName({ display: "'' via IT Security" })).toBe(undefined);
  });
});

describe("unsubscribeKindOf", () => {
  it("reads one-click only when an https target carries the RFC 8058 post header", () => {
    const listUnsubscribe = "<mailto:u@example.test>, <https://example.test/u>";
    expect(unsubscribeKindOf({ listUnsubscribe, listUnsubscribePost: "List-Unsubscribe=One-Click" })).toBe("one-click");
    expect(unsubscribeKindOf({ listUnsubscribe, listUnsubscribePost: undefined })).toBe("link");
  });

  it("reads a target written WITHOUT angle brackets — Linear's shape — as one-click", () => {
    const listUnsubscribe = "https://linear.example.test/api/unsubscribe?token=t&type=unread-notification-reminder";
    expect(unsubscribeKindOf({ listUnsubscribe, listUnsubscribePost: "List-Unsubscribe=One-Click" })).toBe("one-click");
  });

  it("reads a mailto-only header as a send, and an absent or unusable one as none", () => {
    expect(unsubscribeKindOf({ listUnsubscribe: "<mailto:u@example.test>", listUnsubscribePost: undefined })).toBe(
      "mailto",
    );
    expect(unsubscribeKindOf({ listUnsubscribe: undefined, listUnsubscribePost: undefined })).toBe("none");
    expect(unsubscribeKindOf({ listUnsubscribe: "<http://example.test/u>", listUnsubscribePost: undefined })).toBe(
      "none",
    );
  });
});

describe("isAutomatedSender", () => {
  it("marks a listed message automated whatever its address", () => {
    expect(isAutomatedSender({ address: "jane@example.test", listed: true })).toBe(true);
  });

  it("marks a no-reply address automated through its separators, and a person's address not", () => {
    expect(isAutomatedSender({ address: "no-reply@example.test", listed: false })).toBe(true);
    expect(isAutomatedSender({ address: "do_not.reply@example.test", listed: false })).toBe(true);
    expect(isAutomatedSender({ address: "jane@example.test", listed: false })).toBe(false);
  });
});

describe("keyTriageMessage", () => {
  it("keys a direct message by its lower-cased address and names the sender by display name", () => {
    const keyed = keyTriageMessage({
      message: message({ atIso: READ_AT, from: "Jane Doe <Jane@Example.test>", id: "m-1", unread: true }),
    })!;
    expect(keyed.key).toBe("from:jane@example.test");
    expect(keyed.sender).toBe("Jane Doe");
    expect(keyed.relayedBy).toBe(undefined);
    expect(keyed.entry).toEqual({
      id: "m-1",
      receivedAtIso: READ_AT,
      subject: "a subject",
      threadId: "t-m-1",
      unread: true,
    });
  });

  it("keys a relay by the group address AND the original sender, so two senders through one group stay apart", () => {
    const keyed = keyTriageMessage({
      message: message({
        atIso: READ_AT,
        extra: [{ name: "List-Id", value: "IT Security <it-security.example.test>" }],
        from: "'Othercompany Alerts' via IT Security <it-security@example.test>",
        id: "m-1",
      }),
    })!;
    expect(keyed.key).toBe("relay:it-security@example.test:othercompany alerts");
    expect(keyed.sender).toBe("Othercompany Alerts");
    expect(keyed.relayedBy).toBe("IT Security");
    expect(keyed.listId).toBe("it-security.example.test");
    expect(keyed.automated).toBe(true);
  });

  it("answers undefined for a message with no From", () => {
    expect(keyTriageMessage({ message: message({ atIso: READ_AT, from: undefined, id: "m-1" }) })).toBe(undefined);
  });
});
