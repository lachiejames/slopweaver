import { describe, expect, it } from "vitest";

import {
  broadcastReactorsOf,
  isLaterThan,
  messageKeyOf,
  namesAnybody,
  rawSourceId,
  slackRowOf,
  tagsOwner,
  tagsUser,
  threadKeyOf,
  unreadableWord,
} from "../../../cli/commands/sessionStart/slackRow.js";

// Slack's own id shape, not a readable placeholder: `../../../review/prLink`'s mention matcher is
// deliberately structural (`<@[UW][A-Z0-9]+>`), so a fixture using `owner-id` would prove nothing about
// a mention run and would pass whatever the reader did.
const OWNER = "U0SYNOWNER1234";
const HUMAN = "U0SYNHUMAN123";

const message = ({
  author,
  ts,
  threadTs = "1787705115.489199",
  channel = "channel-one",
  text = "hello",
  tsIso = "2026-08-30T00:00:00.000Z",
  rawText,
}: {
  author: string;
  ts: string;
  threadTs?: string;
  channel?: string;
  text?: string;
  tsIso?: string;
  /** Slack's own `raw.text`, which is the ONLY half that ever carries a mention run. */
  rawText?: string;
}): Record<string, unknown> => ({
  attrs: { channel: "#a-channel" },
  author,
  container: `slack/${channel}`,
  kind: "comment",
  source: "slack",
  sourceId: `${channel}:${threadTs}:reply:${ts}`,
  text,
  tsIso,
  url: `https://example.slack.com/archives/${channel}/p${ts.replace(".", "")}`,
  ...(rawText === undefined ? {} : { raw: { text: rawText } }),
});

/**
 * How the corpus really stores a message tagging the owner: the run in `raw.text`, a display name in `text`.
 *
 * MEASURED over four bronze files — 170 records carry the token in `raw.text` and ZERO carry
 * it in the projected `text`. Every mention case below is built this way so it fails if the reader ever
 * goes back to reading the projection.
 */
const tagging = (args: Parameters<typeof message>[0] & { readonly says: string }): Record<string, unknown> =>
  message({
    ...args,
    rawText: `<@${OWNER}> ${args.says}`,
    text: `@Owner Name ${args.says}`,
  });

describe("threadKeyOf", () => {
  it("takes the channel and the parent timestamp from a reply id", () => {
    expect(threadKeyOf({ sourceId: "channel-one:1787705115.489199:reply:1787708973.446169" })).toBe(
      "channel-one:1787705115.489199",
    );
  });

  it("takes the same two segments from a root message id", () => {
    expect(threadKeyOf({ sourceId: "channel-one:1788062928.564759" })).toBe("channel-one:1788062928.564759");
  });

  it("refuses an id with no timestamp segment", () => {
    expect(threadKeyOf({ sourceId: "channel-one" })).toBeUndefined();
  });

  it("refuses an id with an empty channel segment", () => {
    expect(threadKeyOf({ sourceId: ":1788062928.564759" })).toBeUndefined();
  });

  it.each(["malformed:not-a-slack-thread-ts", "huddle:F0AB12CD34E:chunk:3", "C1:1788062928"])(
    "refuses %s, whose second segment is not a Slack ts",
    (sourceId) => {
      expect(threadKeyOf({ sourceId })).toBeUndefined();
    },
  );
});

describe("slackRowOf", () => {
  it("reads the fields the leg needs", () => {
    const row = slackRowOf({ line: JSON.stringify(message({ author: HUMAN, ts: "1787708973.446169" })) })!;
    expect(row.author).toBe(HUMAN);
    expect(row.channelName).toBe("#a-channel");
    expect(row.tsIso).toBe("2026-08-30T00:00:00.000Z");
  });

  it("skips a line that is not JSON rather than aborting the scan", () => {
    expect(slackRowOf({ line: "{not json" })).toBeUndefined();
  });

  it("skips a record with no author", () => {
    expect(
      slackRowOf({ line: JSON.stringify({ sourceId: "C1:2", tsIso: "2026-08-30T00:00:00.000Z" }) }),
    ).toBeUndefined();
  });

  it("reads a record with no text as an empty quote rather than dropping it", () => {
    const line = JSON.stringify({
      author: HUMAN,
      kind: "comment",
      sourceId: "C1:2",
      tsIso: "2026-08-30T00:00:00.000Z",
      url: "u",
    });
    expect(slackRowOf({ line })!.text).toBe("");
  });

  it("reads each ANSWERING reactor once, skin tone and all, never an eyes or a laugh", () => {
    const OTHER = "U0SYNOTHER1234";
    const reactions = [
      { count: 2, name: "white_check_mark", users: [HUMAN, OWNER] },
      { count: 1, name: "+1::skin-tone-3", users: [HUMAN] },
      { count: 2, name: "eyes", users: [OTHER] },
      { count: 1, name: "joy", users: [OTHER] },
    ];
    const reacted = JSON.stringify({ ...message({ author: OWNER, ts: "1787708973.446169" }), raw: { reactions } });
    const plain = JSON.stringify(message({ author: OWNER, ts: "1787708973.446169" }));
    expect(slackRowOf({ line: reacted })!.answeringReactorIds).toEqual([HUMAN, OWNER]);
    expect(slackRowOf({ line: plain })!.answeringReactorIds).toEqual([]);
  });

  it("drops a reply's channel copy, keeping the reply itself, and counts neither copy as a lost word", () => {
    const broadcast = { subtype: "thread_broadcast", text: "which env?" };
    const channelCopy = JSON.stringify({
      ...message({ author: OWNER, ts: "1787708973.446169" }),
      kind: "message",
      raw: broadcast,
      sourceId: "channel-one:1787708973.446169",
    });
    const reply = JSON.stringify({ ...message({ author: OWNER, ts: "1787708973.446169" }), raw: broadcast });
    expect(slackRowOf({ line: channelCopy })).toBeUndefined();
    expect(slackRowOf({ line: reply })!.sourceId).toBe("channel-one:1787705115.489199:reply:1787708973.446169");
    expect(unreadableWord({ keys: undefined, line: channelCopy })).toBe(false);
  });
});

describe("broadcastReactorsOf", () => {
  const ticked = { reactions: [{ count: 1, name: "white_check_mark", users: [HUMAN] }], subtype: "thread_broadcast" };
  const channelCopy = (raw: Record<string, unknown>): string =>
    JSON.stringify({
      ...message({ author: OWNER, ts: "1787708973.446169" }),
      kind: "message",
      raw,
      sourceId: "channel-one:1787708973.446169",
    });

  it("reads a ticked channel copy's reactors under the key its thread reply shares", () => {
    const reply = "channel-one:1787705115.489199:reply:1787708973.446169";
    expect(broadcastReactorsOf({ line: channelCopy(ticked) })).toEqual({
      messageKey: messageKeyOf({ sourceId: reply }),
      reactorIds: [HUMAN],
    });
  });

  it("answers nothing for the thread reply itself, an unticked copy, or an ordinary message", () => {
    const reply = JSON.stringify({ ...message({ author: OWNER, ts: "1787708973.446169" }), raw: ticked });
    const unticked = channelCopy({ subtype: "thread_broadcast" });
    const plain = JSON.stringify(message({ author: OWNER, ts: "1787708973.446169" }));
    expect([reply, unticked, plain].map((line) => broadcastReactorsOf({ line }))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("rawSourceId", () => {
  it("reads the field without parsing the line", () => {
    expect(rawSourceId({ line: '{"kind":"comment","sourceId":"C1:2:reply:3","text":"x"}' })).toBe("C1:2:reply:3");
  });

  it("returns undefined for a line carrying no sourceId", () => {
    expect(rawSourceId({ line: '{"kind":"comment"}' })).toBeUndefined();
  });

  it("returns undefined when the value is never closed", () => {
    expect(rawSourceId({ line: '{"sourceId":"C1:2' })).toBeUndefined();
  });
});

describe("isLaterThan", () => {
  it("breaks a same-second tie on Slack's own timestamp, which bronze's tsIso cannot express", () => {
    const same = { tsIso: "2026-08-30T00:00:00.000Z" };
    const first = slackRowOf({ line: JSON.stringify(message({ author: OWNER, ts: "1787708973.446160", ...same })) })!;
    const second = slackRowOf({ line: JSON.stringify(message({ author: HUMAN, ts: "1787708973.446169", ...same })) })!;
    expect(isLaterThan({ candidate: second, held: first })).toBe(true);
    expect(isLaterThan({ candidate: first, held: second })).toBe(false);
  });

  it("prefers the later tsIso whatever the Slack timestamps say", () => {
    const older = slackRowOf({
      line: JSON.stringify(message({ author: OWNER, ts: "1787708973.999999", tsIso: "2026-08-29T00:00:00.000Z" })),
    })!;
    const newer = slackRowOf({
      line: JSON.stringify(message({ author: HUMAN, ts: "1787708973.000001", tsIso: "2026-08-30T00:00:00.000Z" })),
    })!;
    expect(isLaterThan({ candidate: newer, held: older })).toBe(true);
  });

  it("keeps the message already held when neither id carries a numeric tail", () => {
    const line = ({ id }: { id: string }): string =>
      JSON.stringify({ author: HUMAN, kind: "comment", sourceId: id, tsIso: "2026-08-30T00:00:00.000Z", url: "u" });
    const held = slackRowOf({ line: line({ id: "C1:x" }) })!;
    const candidate = slackRowOf({ line: line({ id: "C1:y" }) })!;
    expect(isLaterThan({ candidate, held })).toBe(false);
  });
});

describe("tagsOwner", () => {
  it("reads a mention run in raw.text, which is the only half that ever carries one", () => {
    const line = JSON.stringify(tagging({ author: HUMAN, says: "bump this", ts: "1787708973.446169" }));
    expect(tagsOwner({ ownerId: OWNER, row: slackRowOf({ line })! })).toBe(true);
  });

  it("does not read the resolved display name the projection left behind as a tag", () => {
    const line = JSON.stringify(message({ author: HUMAN, text: "@Owner Name bump this", ts: "1787708973.446169" }));
    expect(tagsOwner({ ownerId: OWNER, row: slackRowOf({ line })! })).toBe(false);
  });

  it("does not read a bare handle typed into prose as a tag, because Slack pings nobody for one", () => {
    const line = JSON.stringify(message({ author: HUMAN, rawText: `@${OWNER} bump this`, ts: "1787708973.446169" }));
    expect(tagsOwner({ ownerId: OWNER, row: slackRowOf({ line })! })).toBe(false);
  });

  it("does not read somebody else's tag as the owner's", () => {
    const line = JSON.stringify(
      message({ author: HUMAN, rawText: "<@someone-else> bump this", ts: "1787708973.446169" }),
    );
    expect(tagsOwner({ ownerId: OWNER, row: slackRowOf({ line })! })).toBe(false);
  });
});

describe("tagsUser", () => {
  const ownerWord = ({ rawText, text }: { rawText?: string; text?: string }): string =>
    JSON.stringify(
      message({
        author: OWNER,
        ts: "1787708973.446160",
        ...(rawText === undefined ? {} : { rawText }),
        ...(text === undefined ? {} : { text }),
      }),
    );

  it("reads a mention run of exactly the named person", () => {
    const line = ownerWord({ rawText: `<@${HUMAN}> can we have that sign off?` });
    expect(tagsUser({ row: slackRowOf({ line })!, userId: HUMAN })).toBe(true);
  });

  it("does not read a tag of a different person as theirs", () => {
    const line = ownerWord({ rawText: `<@U0SYNOTHER123> can we have that sign off?` });
    expect(tagsUser({ row: slackRowOf({ line })!, userId: HUMAN })).toBe(false);
  });

  it("does not read a display name in the projected text as a tag", () => {
    const line = ownerWord({ text: "@A Colleague can we have that sign off?" });
    expect(tagsUser({ row: slackRowOf({ line })!, userId: HUMAN })).toBe(false);
  });
});

describe("namesAnybody", () => {
  const named = ({ rawText }: { rawText: string }): boolean =>
    namesAnybody({
      row: slackRowOf({ line: JSON.stringify(message({ author: HUMAN, rawText, ts: "1787708973.446169" })) })!,
    });

  it("reads a person's mention run, a user group and the room as naming somebody", () => {
    expect(
      ["<@U0SYNOTHER123> can you tick?", "<!subteam^S0GROUP12> can you tick?", "<!here> can somebody tick?"].map(
        (rawText) => named({ rawText }),
      ),
    ).toEqual([true, true, true]);
  });

  it("reads a question naming nobody, and a bare handle typed into prose, as naming nobody", () => {
    expect(
      ["As in, what are you trying to achieve there?", "@someone what is this?"].map((rawText) => named({ rawText })),
    ).toEqual([false, false]);
  });
});
