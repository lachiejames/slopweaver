/*
 * The channel hover window's read: the argv the route spawns, the reader for `slack channel-view --json`, the route
 * answer's state, and the one grammar a chip's Slack link is read by.
 */

import { describe, expect, it } from "vitest";

import { slackChannelStateOf } from "../../components/console/useSlackChannel";
import { readSlackChannel } from "../../components/live/readSlackChannel";
import { namedSlackPlace, slackArchiveOf } from "../../lib/citationPlaces";
import { slackChannelMediaStoreDir } from "../../lib/draftMediaServe";
import { slackChannelArgv } from "../../lib/slackChannelVerb";

const SHA = "b".repeat(64);

/** The workspace the fixture's links name. */
const WORKSPACE = "acme.slack.com";

/** One message as the verb prints it; `over` replaces any field. */
function message({ over = {} }: { over?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    attachments: [],
    author: { userId: "U0SYN000007" },
    blocks: [],
    edited: false,
    files: [
      { id: "F0PIC", mimetype: "image/png", name: "graph.png", sha256: SHA, shown: "picture", variant: "thumb-480" },
      {
        detail: "HTTP 403",
        id: "F0PDF",
        mimetype: "application/pdf",
        name: "spec.pdf",
        reason: "fetch-failed",
        shown: "card",
      },
    ],
    permalink: "https://acme.slack.com/archives/C0SYN000007/p1789100342176139",
    reactions: [{ count: 2, name: "eyes" }],
    replyCount: 2,
    text: "the latency graph",
    ts: "1789100342.176139",
    tsIso: "2026-09-11T04:19:02.000Z",
    ...over,
  };
}

/** The whole document; `over` replaces any top-level field. */
function document({ over = {} }: { over?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    channel: "C0SYN000007",
    earlierWithheld: true,
    kind: "slopweaver.slack.channel-view",
    link: "https://acme.slack.com/archives/C0SYN000007",
    messages: [message()],
    name: "proj-monitoring",
    observedAtIso: "2026-10-17T01:00:00.000Z",
    people: [{ bot: false, handle: "jonah.yates", name: "Jonah Yates", nativeId: "U0SYN000007" }],
    readAs: "user",
    schemaVersion: 1,
    ...over,
  };
}

describe("slackChannelArgv", () => {
  it("spawns the verb with the channel id and its workspace as literal slots", () => {
    expect(slackChannelArgv({ channel: "C0SYN000007", workspace: WORKSPACE })).toEqual({
      argv: ["slack", "channel-view", "C0SYN000007", "--workspace", WORKSPACE, "--json"],
      kind: "argv",
      title: "slopweaver slack channel-view C0SYN000007 --workspace acme.slack.com --json",
    });
  });

  it("refuses anything that is not a conversation id, a flag above all", () => {
    expect(slackChannelArgv({ channel: "--home", workspace: WORKSPACE }).kind).toBe("refused");
    expect(slackChannelArgv({ channel: "proj-monitoring", workspace: WORKSPACE }).kind).toBe("refused");
    expect(slackChannelArgv({ channel: "U0SYN000007", workspace: WORKSPACE }).kind).toBe("refused");
  });

  it("refuses a workspace that is not a lowercase Slack host", () => {
    expect(slackChannelArgv({ channel: "C0SYN000007", workspace: "--home" }).kind).toBe("refused");
    expect(slackChannelArgv({ channel: "C0SYN000007", workspace: "evil.example" }).kind).toBe("refused");
    expect(slackChannelArgv({ channel: "C0SYN000007", workspace: "Acme.slack.com" }).kind).toBe("refused");
  });
});

describe("readSlackChannel", () => {
  it("reads the channel, its people, and each file as a picture or a card", () => {
    const view = readSlackChannel(document())!;

    expect(view.name).toBe("proj-monitoring");
    expect(view.earlierWithheld).toBe(true);
    expect(view.people.get("U0SYN000007")!.name).toBe("Jonah Yates");
    expect(view.messages.at(0)!.replyCount).toBe(2);
    expect(view.messages.at(0)!.reactions).toEqual([{ count: 2, name: "eyes" }]);
    expect(view.messages.at(0)!.files).toEqual([
      { id: "F0PIC", name: "graph.png", sha256: SHA, shown: "picture" },
      {
        detail: "HTTP 403",
        id: "F0PDF",
        mimetype: "application/pdf",
        name: "spec.pdf",
        reason: "fetch-failed",
        shown: "card",
      },
    ]);
  });

  it("refuses a document with a file it cannot account for, rather than drop the file", () => {
    expect(readSlackChannel(document({ over: { messages: [message({ over: { files: [{ id: "F0X" }] } })] } }))).toBe(
      undefined,
    );
    expect(
      readSlackChannel(
        document({
          over: { messages: [message({ over: { files: [{ id: "F0X", sha256: "../x", shown: "picture" }] } })] },
        }),
      ),
    ).toBe(undefined);
    expect(
      readSlackChannel(
        document({
          over: { messages: [message({ over: { files: [{ id: "F0X", reason: "vibes", shown: "card" }] } })] },
        }),
      ),
    ).toBe(undefined);
  });

  it("refuses a message whose reactions will not read, rather than draw a row Slack does not", () => {
    expect(readSlackChannel(document({ over: { messages: [message({ over: { reactions: undefined } })] } }))).toBe(
      undefined,
    );
    expect(
      readSlackChannel(document({ over: { messages: [message({ over: { reactions: [{ name: "eyes" }] } })] } })),
    ).toBe(undefined);
    expect(
      readSlackChannel(
        document({ over: { messages: [message({ over: { reactions: [{ count: 0, name: "eyes" }] } })] } }),
      ),
    ).toBe(undefined);
  });

  it("carries whose token read the channel, and refuses a document that does not say", () => {
    expect(readSlackChannel(document())!.readAs).toBe("user");
    expect(readSlackChannel(document({ over: { readAs: "bot" } }))!.readAs).toBe("bot");
    expect(readSlackChannel(document({ over: { readAs: undefined } }))).toBe(undefined);
    expect(readSlackChannel(document({ over: { readAs: "admin" } }))).toBe(undefined);
  });

  it("refuses another document's kind, and a message whose envelope will not read", () => {
    expect(readSlackChannel(document({ over: { kind: "slopweaver.slack.draft-context" } }))).toBe(undefined);
    expect(readSlackChannel(document({ over: { name: 7 } }))).toBe(undefined);
    expect(readSlackChannel(document({ over: { messages: [message({ over: { tsIso: undefined } })] } }))).toBe(
      undefined,
    );
  });
});

describe("slackChannelStateOf", () => {
  it("draws a reading of the channel asked about", () => {
    const state = slackChannelStateOf({
      body: { observedAtIso: "x", ok: true, view: document() },
      channel: "C0SYN000007",
      workspace: WORKSPACE,
    });

    expect(state.phase).toBe("ready");
  });

  it("says why when the route did not measure, or answered for another channel", () => {
    expect(
      slackChannelStateOf({
        body: { notMeasured: "no Slack token", observedAtIso: "x", ok: false },
        channel: "C0ONE",
        workspace: WORKSPACE,
      }),
    ).toEqual({ phase: "not-measured", why: "no Slack token" });
    expect(
      slackChannelStateOf({
        body: { observedAtIso: "x", ok: true, view: document() },
        channel: "C0ONE",
        workspace: WORKSPACE,
      }),
    ).toEqual({
      phase: "not-measured",
      why: "slack channel-view answered for C0SYN000007, not C0ONE",
    });
  });

  it("refuses a reading made in another workspace than the chip's link named", () => {
    expect(
      slackChannelStateOf({
        body: { observedAtIso: "x", ok: true, view: document() },
        channel: "C0SYN000007",
        workspace: "other-org.slack.com",
      }),
    ).toEqual({
      phase: "not-measured",
      why: "slack channel-view read acme.slack.com, not other-org.slack.com",
    });
  });
});

describe("slackArchiveOf", () => {
  it("reads a channel link and a message link to the same conversation", () => {
    expect(slackArchiveOf({ href: "https://acme.slack.com/archives/C0SYN000007" })).toEqual({
      channel: "C0SYN000007",
      message: false,
      workspace: "acme.slack.com",
    });
    expect(slackArchiveOf({ href: "https://acme.slack.com/archives/C0SYN000007/p1789100342176139" })).toEqual({
      channel: "C0SYN000007",
      message: true,
      workspace: "acme.slack.com",
    });
  });

  it("carries the workspace the link names, lowercase, so one id in two workspaces is two channels", () => {
    expect(slackArchiveOf({ href: "https://Other-Org.slack.com/archives/C0SYN000007" })).toEqual({
      channel: "C0SYN000007",
      message: false,
      workspace: "other-org.slack.com",
    });
  });

  it("reads nothing off an address that is not a Slack archive link", () => {
    expect(slackArchiveOf({ href: "https://github.com/lachiejames/slopweaver/pull/1" })).toBe(undefined);
    expect(slackArchiveOf({ href: "https://evil.example/archives/C0SYN000007" })).toBe(undefined);
    expect(slackArchiveOf({ href: "https://a@b.slack.com/archives/C0SYN000007" })).toBe(undefined);
    expect(slackArchiveOf({ href: "https://acme.slack.com/archives/c0syn000007" })).toBe(undefined);
  });

  it("is the grammar a chip's place reads too", () => {
    const channels = new Map([["C0SYN000007", "#proj-monitoring"]]);

    expect(namedSlackPlace({ channels, href: "https://acme.slack.com/archives/C0SYN000007" })).toBe("#proj-monitoring");
    expect(namedSlackPlace({ channels, href: "https://acme.slack.com/archives/C0SYN000007/p1789100342176139" })).toBe(
      "a message in #proj-monitoring",
    );
  });
});

describe("slackChannelMediaStoreDir", () => {
  it("is the store `slack channel-view` keeps its previews in, under the console's home", () => {
    expect(slackChannelMediaStoreDir().endsWith("/live/slack/channel-media")).toBe(true);
  });
});
