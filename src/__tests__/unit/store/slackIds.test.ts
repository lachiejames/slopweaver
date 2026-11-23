import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { parseSlackAddress, slackTimestampsOf } from "../../../store/slackIds.js";

/** A thread root and one of its replies, spelled the way `corpus/slack/project.ts` builds a `sourceId`. */
const CHANNEL = "C0SYN000002";
const ROOT_TS = "1773784810.008629";
const REPLY_TS = "1773811363.025049";
const REPLY_ID = `${CHANNEL}:${ROOT_TS}:reply:${REPLY_TS}`;

describe("parseSlackAddress", () => {
  it("takes a store uuid as the row it names", () => {
    const address = unwrap(parseSlackAddress({ value: "552f2e60-efc6-4b63-bc83-d30039f7abe2" }));
    expect(address).toEqual({ id: "552f2e60-efc6-4b63-bc83-d30039f7abe2", kind: "uuid" });
  });

  it("takes a top-level message's own source_id as its channel and timestamp", () => {
    expect(unwrap(parseSlackAddress({ value: `${CHANNEL}:${ROOT_TS}` }))).toEqual({
      channelId: CHANNEL,
      kind: "slack",
      messageTs: ROOT_TS,
    });
  });

  it("anchors a reply on the REPLY's own timestamp, never on the thread root in its second field", () => {
    expect(unwrap(parseSlackAddress({ value: REPLY_ID }))).toEqual({
      channelId: CHANNEL,
      kind: "slack",
      messageTs: REPLY_TS,
    });
  });

  it("reads a Slack permalink back into the coordinates it was built from", () => {
    const link = `https://acme.slack.com/archives/${CHANNEL}/p1773811363025049`;
    expect(unwrap(parseSlackAddress({ value: link }))).toEqual({
      channelId: CHANNEL,
      kind: "slack",
      messageTs: REPLY_TS,
    });
  });

  it("takes a permalink with a thread_ts query string, which is what Slack's copy-link gives you", () => {
    const link = `https://acme.slack.com/archives/${CHANNEL}/p1773811363025049?thread_ts=1773784810.008629&cid=${CHANNEL}`;
    expect(unwrap(parseSlackAddress({ value: link })).kind).toBe("slack");
  });

  it("trims what a caller pasted rather than refusing it for a trailing newline", () => {
    expect(unwrap(parseSlackAddress({ value: `  ${CHANNEL}:${ROOT_TS}\n` })).kind).toBe("slack");
  });

  it("takes a D and a G conversation, because DMs and private groups are in this store too", () => {
    expect(unwrap(parseSlackAddress({ value: `D0SYN4E1234567:${ROOT_TS}` })).kind).toBe("slack");
    expect(unwrap(parseSlackAddress({ value: `G0SYN4E1234567:${ROOT_TS}` })).kind).toBe("slack");
  });

  it("refuses an empty --id, naming all three spellings it would have taken", () => {
    const refused = parseSlackAddress({ value: "   " });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().message).toContain("--id is required");
  });

  it("refuses a link whose p-number is not a message timestamp, saying what it addresses instead", () => {
    const refused = parseSlackAddress({ value: `https://acme.slack.com/archives/${CHANNEL}/p17738113` });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().message).toContain("addresses a file, a canvas or a channel");
  });

  it("refuses a pin, whose second field is a word rather than a timestamp", () => {
    const refused = parseSlackAddress({ value: `${CHANNEL}:pin:${ROOT_TS}` });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().message).toContain("is not a record uuid");
  });

  it("refuses a file id, whose fourth field is not a timestamp", () => {
    const refused = parseSlackAddress({ value: `${CHANNEL}:${ROOT_TS}:file:F0B6FPQVB6Y` });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().message).toContain("is not a record uuid");
  });

  it("refuses a timestamp a digit short, because a near-miss addresses a different message", () => {
    const refused = parseSlackAddress({ value: `${CHANNEL}:1773784810.00862` });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().message).toContain("is not a record uuid");
  });

  it("refuses a bare word, which is what the verb used to accept and then find nothing for", () => {
    const refused = parseSlackAddress({ value: "aaa" });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().message).toContain("C0SYN4E1234567");
  });
});

describe("slackTimestampsOf", () => {
  it("gives a top-level message its own timestamp as both the message and the thread", () => {
    expect(slackTimestampsOf({ sourceId: `${CHANNEL}:${ROOT_TS}` })).toEqual({
      messageTs: ROOT_TS,
      threadTs: ROOT_TS,
    });
  });

  it("splits a reply's two timestamps the way its id carries them", () => {
    expect(slackTimestampsOf({ sourceId: REPLY_ID })).toEqual({
      messageTs: REPLY_TS,
      threadTs: ROOT_TS,
    });
  });

  it("gives nothing for a pin, rather than keying a thread on the word pin", () => {
    expect(slackTimestampsOf({ sourceId: `${CHANNEL}:pin:${ROOT_TS}` })).toBe(null);
  });

  it("gives nothing for a canvas, whose id carries no timestamp at all", () => {
    expect(slackTimestampsOf({ sourceId: "canvas:F0B6FPQVB6Y" })).toBe(null);
  });

  it("gives nothing for a redacted timestamp, which is the column this function exists to replace", () => {
    expect(slackTimestampsOf({ sourceId: `${CHANNEL}:[number].008629` })).toBe(null);
  });

  it("gives nothing for a record from another source", () => {
    expect(slackTimestampsOf({ sourceId: "acme/monorepo#17000" })).toBe(null);
  });
});
