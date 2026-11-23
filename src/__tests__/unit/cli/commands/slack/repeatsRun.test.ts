/**
 * `slack repeats` end to end over plain fakes: help, a bad flag, the bot's conversations read and judged, and an
 * identity whose seams cannot be built reported unread rather than clear.
 */
import { describe, expect, it } from "vitest";

import { type ActorReadSeams, readActor } from "../../../../../cli/commands/slack/repeatsRead.js";
import {
  RepeatSeamErrors,
  runSlackRepeats,
  type SlackRepeatsDeps,
} from "../../../../../cli/commands/slack/repeatsRun.js";
import { SLACK_REPEATS_USAGE } from "../../../../../cli/commands/slack/repeatsUsage.js";
import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { err, ok } from "../../../../../lib/result.js";

/** A fixed instant, a little after the incident. */
const NOW_MS = 1790620000000;

const TEXT = "The staging pool exhausted at 03:00 because every worker held two connections open";

/** The bot's DM, holding the same message twice, two hours apart. */
const BOT_API: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
  history: async ({ channel }) => ({
    messages:
      channel === "D0BOT"
        ? [
            { bot_id: "B0BOT", text: TEXT, ts: "1790612000.000200" },
            { bot_id: "B0BOT", text: TEXT, ts: "1790604800.000100" },
            { text: TEXT, ts: "1790604900.000100", user: "U0SYNSOMEONE" },
          ]
        : [],
  }),
  listChannels: async ({ lane }) => ({
    channels: lane === "group-dms" ? [] : [{ id: "D0BOT", is_im: true }, { id: "C0SYNUNJOINED" }],
  }),
  replies: async () => ({ messages: [] }),
};

const BOT_SEAMS: ActorReadSeams = {
  api: BOT_API,
  self: { botId: "B0BOT", userId: "U0BOT" },
  workspaceUrl: "https://acme.slack.com/",
};

/** Deps over the bot seams, with the as-owner half unbuildable; the lines written are collected. */
function depsOf(): { deps: SlackRepeatsDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: SlackRepeatsDeps = {
    clockMs: () => NOW_MS,
    defaultHome: () => "/h",
    seamsFor: async ({ actor }) => (actor === "bot" ? ok(BOT_SEAMS) : err(RepeatSeamErrors.tokenMissing({ actor }))),
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, out };
}

describe("runSlackRepeats", () => {
  it("prints its usage for --help and reads nothing", async () => {
    const { deps, out } = depsOf();
    expect(await runSlackRepeats({ deps, rest: ["--help"] })).toBe(0);
    expect(out).toEqual([SLACK_REPEATS_USAGE]);
  });

  it("refuses a bad flag with the usage, as a caller mistake", async () => {
    const { deps, diagnostics } = depsOf();
    expect(await runSlackRepeats({ deps, rest: ["--as", "them"] })).toBe(2);
    expect(diagnostics).toEqual(['slack repeats: --as must be me, bot or both, got "them"', SLACK_REPEATS_USAGE]);
  });

  it("groups the bot's repeat, keeping the earlier copy and printing the delete for the later one", async () => {
    const { deps, out } = depsOf();
    expect(await runSlackRepeats({ deps, rest: ["--as", "bot"] })).toBe(0);
    expect(out[0]).toBe("slack repeats: 1 group(s) over 7 day(s) — 2 own message(s) in 1 place(s)");
    expect(out).toContain("      slopweaver slack delete --as bot --channel D0BOT --ts 1790612000.000200");
  });

  it("exits 1 when an identity could not be read, naming why", async () => {
    const { deps, out } = depsOf();
    expect(await runSlackRepeats({ deps, rest: ["--json"] })).toBe(1);
    const audit = JSON.parse(out[0]!) as { groups: unknown[]; unread: string[] };
    expect(audit.groups.length).toBe(1);
    expect(audit.unread).toEqual(["me: no user token in the store — `slopweaver secrets status`"]);
  });
});

describe("readActor", () => {
  it("reads only conversations the bot can read, and only its own messages in the window", async () => {
    const read = await readActor({ actor: "bot", days: 7, nowMs: NOW_MS, seams: BOT_SEAMS });
    expect(read.placesRead).toBe(1);
    expect(read.unread).toEqual([]);
    expect(read.messages.map((message) => message.ts)).toEqual(["1790612000.000200", "1790604800.000100"]);
  });

  it("names the as-owner read unread when it has no search seam, rather than reading nothing silently", async () => {
    const read = await readActor({ actor: "me", days: 7, nowMs: NOW_MS, seams: BOT_SEAMS });
    expect(read.messages).toEqual([]);
    expect(read.unread).toEqual(["me: no search seam or no user id — nothing they sent was read"]);
  });
});
