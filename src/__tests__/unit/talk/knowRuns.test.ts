/**
 * The runners behind "the voice knows what the supervisor knows" — `talk glossary`, `origin`, `knowledge`,
 * `history`, `recent`, `slack-after`, `slack-channel` and `slack-open` — driven through their real argv, so a verb the
 * manifest can dispatch is one the suite runs. The three Slack verbs read Slack, so each is held to what it decides
 * before any request leaves.
 *
 * The acts that need no shared state run whole: the glossary is a constant, and `origin` reads a row doc out
 * of a throwaway `--dir`. `knowledge`, `history` and `recent` reach the local store and the Claude transcripts,
 * which a unit test does not touch, so they are held to their refusals — every one of which is decided before I/O.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTalkGlossary } from "../../../cli/commands/talk/glossaryRun.js";
import { runTalkHistory } from "../../../cli/commands/talk/historyRun.js";
import { runTalkKnowledge } from "../../../cli/commands/talk/knowledgeRun.js";
import {
  TALK_GLOSSARY_USAGE,
  TALK_HISTORY_USAGE,
  TALK_KNOWLEDGE_USAGE,
  TALK_ORIGIN_USAGE,
  TALK_SLACK_CHANNEL_USAGE,
} from "../../../cli/commands/talk/knowUsage.js";
import { originAnswerOf, runTalkOrigin } from "../../../cli/commands/talk/originRun.js";
import { runTalkRecent } from "../../../cli/commands/talk/recentRun.js";
import { runTalkSlackAfter } from "../../../cli/commands/talk/slackAfterRun.js";
import { runTalkSlackChannelWithDeps } from "../../../cli/commands/talk/slackChannelRun.js";
import { runTalkSlackOpen } from "../../../cli/commands/talk/slackOpenRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";

/** The full argv a verb receives: `[node, bin, "talk", <verb>, ...rest]`. */
const argvFor = ({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "talk",
  verb,
  ...rest,
];

const ROW = `---
slug: atlas-jumpcloud-run-test
summary: an atlas of the JumpCloud tenancy
status: ready
kind: ask
---

# Atlas: JumpCloud

Owner ruling, 20 Sep 2026: _"we should build a jumpcloud atlas so we can see who owns each device"_
`;

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "talk-know-runs-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("the usage lines", () => {
  it("name each verb and its one required flag", () => {
    expect(TALK_GLOSSARY_USAGE.startsWith("usage: slopweaver talk glossary [--term <words>]")).toBe(true);
    expect(TALK_ORIGIN_USAGE.startsWith("usage: slopweaver talk origin --slug <board-slug>")).toBe(true);
    expect(TALK_KNOWLEDGE_USAGE.startsWith("usage: slopweaver talk knowledge --query <words>")).toBe(true);
    expect(TALK_HISTORY_USAGE.startsWith("usage: slopweaver talk history --phrase <words>")).toBe(true);
  });
});

describe("talk glossary", () => {
  it("answers --help and a term", () => {
    expect(runTalkGlossary(argvFor({ rest: ["--help"], verb: "glossary" }))).toBe(EXIT_OK);
    expect(runTalkGlossary(argvFor({ rest: ["--term", "JumpCloud atlas", "--json"], verb: "glossary" }))).toBe(EXIT_OK);
  });

  it("refuses a term past the length a spoken question has", () => {
    expect(runTalkGlossary(argvFor({ rest: ["--term", "x".repeat(501)], verb: "glossary" }))).toBe(EXIT_USAGE);
  });
});

describe("talk origin", () => {
  it("counts the mentions it did not read, narrowing the list to the rows it carries", () => {
    const origin = {
      anchors: [],
      askedIso: undefined,
      fromOwner: true,
      kind: "ask",
      mentions: ["read-row", "gone-row", "not a slug"],
      observedBy: undefined,
      quotes: [],
      slug: "row-a",
      status: "ready",
      statusSummary: undefined,
      summary: undefined,
      whereFrom: [],
    };
    const mentioned = [{ fromOwner: true, quotes: [], slug: "read-row", summary: undefined }];
    const answer = originAnswerOf({ anchorWords: [], mentioned, origin });
    expect(answer.mentionedOmitted).toBe(2);
    expect(answer.mentions).toEqual(["read-row"]);
    expect(answer.truncated).toBe(false);
    const whole = originAnswerOf({ anchorWords: [], mentioned, origin: { ...origin, mentions: ["read-row"] } });
    expect(whole.mentionedOmitted).toBe(0);
  });

  it("reads a row out of the directory it is pointed at", async () => {
    writeFileSync(join(dir, "atlas-jumpcloud-run-test.md"), ROW);
    const exit = await runTalkOrigin(
      argvFor({ rest: ["--slug", "atlas-jumpcloud-run-test", "--dir", dir, "--json"], verb: "origin" }),
    );
    expect(exit).toBe(EXIT_OK);
  });

  it("says a missing row is an error, and a missing slug is usage", async () => {
    expect(await runTalkOrigin(argvFor({ rest: ["--slug", "no-such-row-here", "--dir", dir], verb: "origin" }))).toBe(
      EXIT_ERROR,
    );
    expect(await runTalkOrigin(argvFor({ rest: [], verb: "origin" }))).toBe(EXIT_USAGE);
  });
});

describe("talk knowledge", () => {
  it("answers --help, and refuses before the store when the query is missing or too long", async () => {
    expect(await runTalkKnowledge(argvFor({ rest: ["--help"], verb: "knowledge" }))).toBe(EXIT_OK);
    expect(await runTalkKnowledge(argvFor({ rest: [], verb: "knowledge" }))).toBe(EXIT_USAGE);
    expect(await runTalkKnowledge(argvFor({ rest: ["--query", "x".repeat(501)], verb: "knowledge" }))).toBe(EXIT_USAGE);
  });
});

describe("talk history", () => {
  it("answers --help, and refuses a missing phrase or a window past a day before reading anything", () => {
    expect(runTalkHistory(argvFor({ rest: ["--help"], verb: "history" }))).toBe(EXIT_OK);
    expect(runTalkHistory(argvFor({ rest: [], verb: "history" }))).toBe(EXIT_USAGE);
    expect(runTalkHistory(argvFor({ rest: ["--phrase", "atlas", "--hours", "48"], verb: "history" }))).toBe(EXIT_USAGE);
  });
});

describe("talk recent", () => {
  it("answers --help", async () => {
    expect(await runTalkRecent(argvFor({ rest: ["--help"], verb: "recent" }))).toBe(EXIT_OK);
  });

  it("refuses a window past a week, and an instant that is not one, before reading anything", async () => {
    expect(await runTalkRecent(argvFor({ rest: ["--hours", "169"], verb: "recent" }))).toBe(EXIT_USAGE);
    expect(await runTalkRecent(argvFor({ rest: ["--now", "yesterday-ish"], verb: "recent" }))).toBe(EXIT_USAGE);
  });
});

describe("talk slack-after", () => {
  it("answers --help, and refuses a missing, overlong or unmeasured argument before any read", async () => {
    expect(await runTalkSlackAfter(argvFor({ rest: ["--help"], verb: "slack-after" }))).toBe(EXIT_OK);
    expect(await runTalkSlackAfter(argvFor({ rest: [], verb: "slack-after" }))).toBe(EXIT_USAGE);
    expect(
      await runTalkSlackAfter(
        argvFor({ rest: ["--url", `https://acme.slack.com/${"x".repeat(2000)}`], verb: "slack-after" }),
      ),
    ).toBe(EXIT_USAGE);
    expect(
      await runTalkSlackAfter(
        argvFor({
          rest: ["--url", "https://acme.slack.com/archives/C1/p1", "--max-bytes", "lots"],
          verb: "slack-after",
        }),
      ),
    ).toBe(EXIT_USAGE);
  });

  it("fails a link that is not a Slack message link without reaching Slack, with or without a token in the home", async () => {
    const exit = await runTalkSlackAfter(
      argvFor({
        rest: ["--url", "https://example.com/archives/C1/p1785114398557099", "--home", dir],
        verb: "slack-after",
      }),
    );
    expect(exit).toBe(EXIT_ERROR);
  });
});

describe("talk slack-channel", () => {
  /** Run the verb with `rest`, recording every line it printed, by stream. */
  async function channelRun({
    rest,
  }: {
    rest: readonly string[];
  }): Promise<{ exit: number; out: string[]; errs: string[] }> {
    const out: string[] = [];
    const errs: string[] = [];
    const exit = await runTalkSlackChannelWithDeps({
      argv: argvFor({ rest, verb: "slack-channel" }),
      log: {
        error: ({ msg }) => {
          errs.push(msg);
        },
        out: ({ line }) => {
          out.push(line);
        },
      },
    });
    return { errs, exit, out };
  }

  // The home holds no Slack token, so the token read is what refuses: its own line, and nothing printed before it.
  it("fails a good argument as a missing-token error when the home holds no Slack token", async () => {
    expect(await channelRun({ rest: ["--channel", "#squad-platform", "--home", dir] })).toEqual({
      errs: ["talk slack-channel: no Slack token configured; run `slopweaver connect slack`"],
      exit: EXIT_ERROR,
      out: [],
    });
  });

  it("exits OK on --help, and refuses a missing, overlong or unmeasured argument as usage, not a missing token", async () => {
    expect(await channelRun({ rest: ["--help"] })).toEqual({
      errs: [],
      exit: EXIT_OK,
      out: [TALK_SLACK_CHANNEL_USAGE],
    });
    for (const rest of [
      ["--home", dir],
      ["--channel", `#${"x".repeat(2000)}`, "--home", dir],
      ["--channel", "#squad-platform", "--max-bytes", "lots", "--home", dir],
    ]) {
      const run = await channelRun({ rest });
      expect([run.exit, run.out, run.errs.at(-1)]).toEqual([EXIT_USAGE, [], TALK_SLACK_CHANNEL_USAGE]);
      expect(run.errs.filter((line) => line.includes("no Slack token"))).toEqual([]);
    }
  });

  it("refuses a link that is not a Slack link as usage, not a missing token", async () => {
    expect(await channelRun({ rest: ["--channel", "https://example.com/archives/C0123456", "--home", dir] })).toEqual({
      errs: [
        'talk slack-channel: "https://example.com/archives/C0123456" names no Slack channel: it is not an https link ' +
          "on slack.com. Pass the channel's name as the screen shows it, or a Slack link to it",
        TALK_SLACK_CHANNEL_USAGE,
      ],
      exit: EXIT_USAGE,
      out: [],
    });
  });
});

describe("talk slack-open", () => {
  it("answers --help, and refuses a missing link before any read", async () => {
    expect(await runTalkSlackOpen(argvFor({ rest: ["--help"], verb: "slack-open" }))).toBe(EXIT_OK);
    expect(await runTalkSlackOpen(argvFor({ rest: [], verb: "slack-open" }))).toBe(EXIT_USAGE);
  });

  it("fails a link that is not a Slack message link without reaching Slack, with or without a token in the home", async () => {
    const exit = await runTalkSlackOpen(
      argvFor({
        rest: ["--url", "https://example.com/archives/C1/p1785114398557099", "--home", dir],
        verb: "slack-open",
      }),
    );
    expect(exit).toBe(EXIT_ERROR);
  });
});
