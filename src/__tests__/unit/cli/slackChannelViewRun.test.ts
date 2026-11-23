import { describe, expect, it } from "vitest";
import {
  historyHasEarlier,
  runSlackChannelView,
  type SlackChannelViewDeps,
} from "../../../cli/commands/slack/channelViewRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import type { SlackPerson } from "../../../corpus/members/slackPeople.js";
import { err, ok } from "../../../lib/result.js";
import { ChannelViewErrors } from "../../../live/slack/channelViewErrors.js";
import { SlackFileLookupErrors } from "../../../live/slack/fileLookupErrors.js";

const SHA = "b".repeat(64);

const ANA: SlackPerson = {
  avatarUrl: undefined,
  bot: false,
  deactivated: false,
  firstNameUnique: true,
  handle: "ana",
  name: "Ana Newman",
  nameUnique: true,
  nativeId: "U0ANA",
  org: undefined,
  title: undefined,
};

/** One history page, newest first: a message with a picture, then an older one. */
const ROWS: readonly unknown[] = [
  {
    files: [{ id: "F0PIC", mimetype: "image/png", name: "graph.png", thumb_480: "https://files.slack.com/480" }],
    text: "the graph",
    ts: "1790000900.000900",
    user: "U0ANA",
  },
  { text: "morning", ts: "1790000000.000100", user: "U0ANA" },
];

/** What a run printed, on each stream, and which edges it reached. */
interface Captured {
  readonly out: string[];
  readonly diagnostics: string[];
  readonly reads: string[];
  readonly peopleAsked: string[][];
}

/** Plain fake edges: no token, network or store, each recording what the shell asked of it. */
function fakeDeps({
  captured,
  userToken,
  botToken,
  name,
}: {
  captured: Captured;
  userToken: string | undefined;
  botToken: string | undefined;
  name: string | undefined;
}): SlackChannelViewDeps {
  return {
    botToken: () => botToken,
    fetchPicture: () => async () => ok({ sha256: SHA }),
    lookupFile:
      () =>
      async ({ fileId }) =>
        err(SlackFileLookupErrors.lookupFailed({ cause: "unexpected", fileId })),
    nowIso: () => "2026-10-17T01:00:00.000Z",
    people: ({ ids }) => {
      captured.peopleAsked.push([...ids]);
      return [ANA];
    },
    readChannel: async ({ channel, home, limit, token }) => {
      captured.reads.push(`${channel} ${home} ${limit} ${token}`);
      return ok({ hasMore: false, name, rows: ROWS });
    },
    userToken: () => userToken,
    workspaceUrl: async ({ token }) => {
      captured.reads.push(`auth.test ${token}`);
      return ok("https://acme.slack.com/");
    },
    writeDiagnostic: (line) => {
      captured.diagnostics.push(line);
    },
    writeOut: (line) => {
      captured.out.push(line);
    },
  };
}

/** A fresh capture. */
function capture(): Captured {
  return { diagnostics: [], out: [], peopleAsked: [], reads: [] };
}

describe("historyHasEarlier", () => {
  it("reads older messages off either Slack signal, and none when neither is set", () => {
    expect(
      [
        { hasMore: true },
        { nextCursor: "bmV4dA==" },
        { hasMore: false, nextCursor: "bmV4dA==" },
        { hasMore: false },
        {},
      ].map((page) => historyHasEarlier({ page })),
    ).toEqual([true, true, true, false, false]);
  });
});

describe("runSlackChannelView", () => {
  it("refuses a malformed channel id with its usage, before reading anything", async () => {
    const captured = capture();
    const code = await runSlackChannelView({
      deps: fakeDeps({ botToken: "xoxb-b", captured, name: "proj", userToken: "xoxp-u" }),
      rest: ["proj-monitoring"],
    });

    expect(code).toBe(EXIT_USAGE);
    expect(captured.diagnostics.at(0)!).toContain("a channel id looks like C0SYN123ABCD");
    expect(captured.diagnostics.at(-1)!).toContain("usage: slopweaver slack channel-view <channel-id>");
    expect(captured.reads).toEqual([]);
  });

  it("says how to connect Slack when no token is configured", async () => {
    const captured = capture();
    const code = await runSlackChannelView({
      deps: fakeDeps({ botToken: undefined, captured, name: "proj", userToken: undefined }),
      rest: ["C0CHAN", "--home", "/h"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(captured.diagnostics).toEqual(["no Slack token configured; run `slopweaver connect slack`"]);
    expect(captured.reads).toEqual([]);
  });

  it("reads on the owner's user token, one page, and prints one JSON document with the people it shows", async () => {
    const captured = capture();
    const code = await runSlackChannelView({
      deps: fakeDeps({ botToken: "xoxb-b", captured, name: "proj-monitoring", userToken: "xoxp-u" }),
      rest: ["C0CHAN", "--json", "--home", "/h"],
    });

    expect(code).toBe(EXIT_OK);
    expect(captured.reads).toEqual(["auth.test xoxp-u", "C0CHAN /h 30 xoxp-u"]);
    expect(captured.diagnostics).toEqual([]);
    expect(captured.out.length).toBe(1);
    const printed = JSON.parse(captured.out.at(0)!) as {
      link: string;
      name: string;
      messages: { ts: string }[];
      people: { nativeId: string }[];
      readAs: string;
    };
    expect(printed.name).toBe("proj-monitoring");
    expect(printed.readAs).toBe("user");
    // The workspace's trailing slash is trimmed before a link is built from it.
    expect(printed.link).toBe("https://acme.slack.com/archives/C0CHAN");
    expect(printed.messages.map((message) => message.ts)).toEqual(["1790000000.000100", "1790000900.000900"]);
    expect(printed.people.map((person) => person.nativeId)).toEqual(["U0ANA"]);
    expect(captured.peopleAsked).toEqual([["U0ANA"]]);
  });

  it("falls to the bot token with Slack's warning, and prints one line per message", async () => {
    const captured = capture();
    const code = await runSlackChannelView({
      deps: fakeDeps({ botToken: "xoxb-b", captured, name: "proj-monitoring", userToken: undefined }),
      rest: ["C0CHAN", "--home", "/h"],
    });

    expect(code).toBe(EXIT_OK);
    expect(captured.reads).toEqual(["auth.test xoxb-b", "C0CHAN /h 30 xoxb-b"]);
    expect(captured.diagnostics.at(0)!).toContain("using a bot token");
    expect(captured.out).toEqual([
      "#proj-monitoring (C0CHAN) read live at 2026-10-17T01:00:00.000Z",
      "2026-09-21T14:13:20.000Z  Ana Newman: morning", // `slopweaver slack when 1790000000.000100`
      "2026-09-21T14:28:20.000Z  Ana Newman: the graph", // `slopweaver slack when 1790000900.000900`
      `    [picture F0PIC graph.png → ${SHA}]`,
    ]);
  });

  it("says in the JSON document that a bot-token read is the bot's view, not the owner's", async () => {
    const captured = capture();
    const code = await runSlackChannelView({
      deps: fakeDeps({ botToken: "xoxb-b", captured, name: "proj-monitoring", userToken: undefined }),
      rest: ["C0CHAN", "--json", "--home", "/h"],
    });

    expect(code).toBe(EXIT_OK);
    expect((JSON.parse(captured.out.at(0)!) as { readAs: string }).readAs).toBe("bot");
  });

  it("refuses a channel Slack gave no name, saying so", async () => {
    const captured = capture();
    const code = await runSlackChannelView({
      deps: fakeDeps({ botToken: undefined, captured, name: undefined, userToken: "xoxp-u" }),
      rest: ["C0CHAN", "--home", "/h"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(captured.diagnostics).toEqual([ChannelViewErrors.channelUnnamed({ channel: "C0CHAN" }).message]);
    expect(captured.out).toEqual([]);
  });

  it("refuses a malformed --workspace with its usage, before reading anything", async () => {
    const captured = capture();
    const code = await runSlackChannelView({
      deps: fakeDeps({ botToken: undefined, captured, name: "proj", userToken: "xoxp-u" }),
      rest: ["C0CHAN", "--workspace", "../acme.slack.com", "--home", "/h"],
    });

    expect(code).toBe(EXIT_USAGE);
    expect(captured.diagnostics.at(0)!).toContain("--workspace is a Slack host such as acme.slack.com");
    expect(captured.reads).toEqual([]);
  });

  it("refuses on auth.test alone when the token reads another workspace than the link named, reading no history", async () => {
    const captured = capture();
    const asked: string[] = [];
    const deps: SlackChannelViewDeps = {
      ...fakeDeps({ botToken: undefined, captured, name: "proj", userToken: "xoxp-u" }),
      fetchPicture: ({ token }) => {
        asked.push(token);
        return async () => ok({ sha256: SHA });
      },
    };
    const code = await runSlackChannelView({
      deps,
      rest: ["C0CHAN", "--workspace", "other.slack.com", "--json", "--home", "/h"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(captured.diagnostics).toEqual([
      ChannelViewErrors.workspaceMismatch({ asked: "other.slack.com", channel: "C0CHAN", readIn: "acme.slack.com" })
        .message,
    ]);
    expect(captured.out).toEqual([]);
    expect(asked).toEqual([]);
    expect(captured.reads).toEqual(["auth.test xoxp-u"]);
  });

  it("fetches pictures on the token it read with, when the token reads the workspace the link named", async () => {
    const captured = capture();
    const asked: string[] = [];
    const deps: SlackChannelViewDeps = {
      ...fakeDeps({ botToken: undefined, captured, name: "proj", userToken: "xoxp-u" }),
      fetchPicture: ({ token }) => {
        asked.push(token);
        return async () => ok({ sha256: SHA });
      },
    };
    const code = await runSlackChannelView({
      deps,
      rest: ["C0CHAN", "--workspace", "acme.slack.com", "--json", "--home", "/h"],
    });

    expect(code).toBe(EXIT_OK);
    expect(asked).toEqual(["xoxp-u"]);
  });

  it("prints the read's own failure when Slack cannot be read", async () => {
    const captured = capture();
    const deps: SlackChannelViewDeps = {
      ...fakeDeps({ botToken: undefined, captured, name: "proj", userToken: "xoxp-u" }),
      readChannel: async ({ channel }) =>
        err(ChannelViewErrors.channelUnreadable({ cause: "channel_not_found", channel })),
    };
    const code = await runSlackChannelView({ deps, rest: ["C0CHAN", "--home", "/h"] });

    expect(code).toBe(EXIT_ERROR);
    expect(captured.diagnostics).toEqual(["could not read C0CHAN live from Slack: channel_not_found"]);
  });

  it("prints auth.test's failure and reads no history when the token cannot say its workspace", async () => {
    const captured = capture();
    const deps: SlackChannelViewDeps = {
      ...fakeDeps({ botToken: undefined, captured, name: "proj", userToken: "xoxp-u" }),
      workspaceUrl: async ({ channel }) => err(ChannelViewErrors.channelUnreadable({ cause: "invalid_auth", channel })),
    };
    const code = await runSlackChannelView({ deps, rest: ["C0CHAN", "--home", "/h"] });

    expect(code).toBe(EXIT_ERROR);
    expect(captured.diagnostics).toEqual(["could not read C0CHAN live from Slack: invalid_auth"]);
    expect(captured.reads).toEqual([]);
  });

  it("refuses an auth.test answer that is not a Slack workspace URL, reading no history", async () => {
    const captured = capture();
    const deps: SlackChannelViewDeps = {
      ...fakeDeps({ botToken: undefined, captured, name: "proj", userToken: "xoxp-u" }),
      workspaceUrl: async () => ok("https://evil.example/"),
    };
    const code = await runSlackChannelView({ deps, rest: ["C0CHAN", "--home", "/h"] });

    expect(code).toBe(EXIT_ERROR);
    expect(captured.diagnostics).toEqual([
      "could not read C0CHAN live from Slack: auth.test answered https://evil.example/, which is not a Slack workspace URL",
    ]);
    expect(captured.reads).toEqual([]);
  });
});
