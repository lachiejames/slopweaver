import { describe, expect, it } from "vitest";
import { DRAFT_STEER_HEARD_MAX_CHARS } from "../../../outbound/slack/draftRegister.js";
import { type RelayReferents, relayCardDisposition, steerExcerpt } from "../../../talk/relayChannelSteer.js";

const ALERTS = { id: "C0SYN000006", name: "dev-alerts" };
const NOTHING: RelayReferents = { channels: [], draftIds: [] };
const CHANNEL_ONLY: RelayReferents = { channels: [ALERTS], draftIds: [] };

describe("relayCardDisposition", () => {
  it("lands a relay that names no referent, on any card, as before", () => {
    expect(relayCardDisposition({ about: "ask:x", cardText: { kind: "not-read" }, referents: NOTHING })).toEqual({
      kind: "land",
    });
  });

  it("lands a channel steer on the draft card it is about", () => {
    const landed = relayCardDisposition({
      about: "post:sd-359bafb2",
      cardText: { kind: "not-read" },
      referents: CHANNEL_ONLY,
    });
    expect(landed).toEqual({ kind: "land" });
  });

  it("withholds words naming only another draft from the draft card on screen", () => {
    const referents = { channels: [], draftIds: ["sd-70e1a6b4"] };
    expect(relayCardDisposition({ about: "post:sd-359bafb2", cardText: { kind: "not-read" }, referents })).toEqual({
      kind: "withheld",
      why: "the owner's words name sd-70e1a6b4, not sd-359bafb2, the draft on screen",
    });
  });

  it("lands words naming the draft on screen beside another", () => {
    const referents = { channels: [], draftIds: ["sd-70e1a6b4", "sd-359bafb2"] };
    expect(relayCardDisposition({ about: "post:sd-359bafb2", cardText: { kind: "not-read" }, referents })).toEqual({
      kind: "land",
    });
  });

  it("withholds from an ask whose doc would not read, rather than guess", () => {
    expect(
      relayCardDisposition({
        about: "ask:x",
        cardText: { kind: "unreadable", why: "EACCES" },
        referents: CHANNEL_ONLY,
      }),
    ).toEqual({
      kind: "withheld",
      why: "the owner's words name #dev-alerts, and ask:x would not read to check (EACCES)",
    });
  });

  it("withholds a relay naming nothing from an ask whose row would not read, so no card the close cannot read is landed", () => {
    const why = "ask.md: its front-matter has 1 problem(s): doneWhen[0] is not a `kind: value` entry";
    expect(
      relayCardDisposition({ about: "ask:one-plan", cardText: { kind: "unreadable", why }, referents: NOTHING }),
    ).toEqual({ kind: "withheld", why: `ask:one-plan would not read, so the relay lands on no card (${why})` });
  });

  it("still lands a relay naming nothing on an ask whose row reads", () => {
    const cardText = { kind: "read" as const, text: "---\nslug: one-plan\n---\n" };
    expect(relayCardDisposition({ about: "ask:one-plan", cardText, referents: NOTHING })).toEqual({ kind: "land" });
  });

  it("lands on an ask whose doc names the draft id the owner's words name", () => {
    const referents = { channels: [], draftIds: ["sd-359bafb2"] };
    const cardText = { kind: "read" as const, text: "Release sd-359bafb2 once the owner says" };
    expect(relayCardDisposition({ about: "ask:x", cardText, referents })).toEqual({ kind: "land" });
  });

  it("withholds from an ask whose doc carries the named id only inside a longer token", () => {
    const referents = { channels: [], draftIds: ["sd-deadbeef"] };
    const cardText = { kind: "read" as const, text: "Investigate token sd-deadbeef0" };
    expect(relayCardDisposition({ about: "ask:unrelated", cardText, referents })).toEqual({
      kind: "withheld",
      why: "the owner's words name sd-deadbeef, and ask:unrelated mentions none of them",
    });
  });

  it("lands on an ask whose doc names the channel by its id", () => {
    const cardText = { kind: "read" as const, text: "Post the P1 in <#C0SYN000006> today" };
    expect(relayCardDisposition({ about: "ask:x", cardText, referents: CHANNEL_ONLY })).toEqual({ kind: "land" });
  });

  it("withholds from an ask whose doc carries the channel's id only inside a pasted permalink", () => {
    const cardText = { kind: "read" as const, text: "Read https://x.slack.com/archives/C0SYN000006/p1 with the owner" };
    expect(relayCardDisposition({ about: "ask:x", cardText, referents: CHANNEL_ONLY })).toEqual({
      kind: "withheld",
      why: "the owner's words name #dev-alerts, and ask:x mentions none of them",
    });
  });

  it("withholds from a card whose key carries the named id only inside a longer token", () => {
    const referents = { channels: [], draftIds: ["sd-deadbeef"] };
    expect(relayCardDisposition({ about: "hand:sd-deadbeef0", cardText: { kind: "not-read" }, referents })).toEqual({
      kind: "withheld",
      why: "the owner's words name sd-deadbeef, and hand:sd-deadbeef0 carries none of them",
    });
  });

  it("withholds a channel-only relay from a card kind whose key does not carry the channel", () => {
    expect(relayCardDisposition({ about: "pr:2310", cardText: { kind: "not-read" }, referents: CHANNEL_ONLY })).toEqual(
      {
        kind: "withheld",
        why: "the owner's words name #dev-alerts, and pr:2310 carries none of them",
      },
    );
  });

  it("lands a channel-only relay on a card kind whose key carries the channel id", () => {
    const landed = relayCardDisposition({
      about: "hand:C0SYN000006",
      cardText: { kind: "not-read" },
      referents: CHANNEL_ONLY,
    });
    expect(landed).toEqual({ kind: "land" });
  });

  it("withholds a relay naming a draft id from a card kind whose key does not carry it", () => {
    const referents = { channels: [], draftIds: ["sd-359bafb2"] };
    expect(relayCardDisposition({ about: "pr:2310", cardText: { kind: "not-read" }, referents })).toEqual({
      kind: "withheld",
      why: "the owner's words name sd-359bafb2, and pr:2310 carries none of them",
    });
  });
});

describe("steerExcerpt", () => {
  it("keeps the sentence naming the channel out of a long utterance", () => {
    const heard = `${"Some context first. ".repeat(30)}Let's send this to Dev alerts instead. Thanks.`;
    expect(steerExcerpt({ channels: [ALERTS], heard })).toBe("Let's send this to Dev alerts instead.");
  });

  it("cuts to the register's bound, marked, when even that sentence is too long", () => {
    const heard = `Dev alerts ${"x".repeat(400)}`;
    const kept = steerExcerpt({ channels: [ALERTS], heard });
    expect(kept.length).toBe(DRAFT_STEER_HEARD_MAX_CHARS);
    expect(kept.endsWith("…")).toBe(true);
  });
});
