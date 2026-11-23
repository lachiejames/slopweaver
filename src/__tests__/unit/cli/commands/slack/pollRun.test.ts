import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import type { PollDeps } from "../../../../../cli/commands/slack/pollRun.js";
import { runPollWithDeps, slackPollCommand } from "../../../../../cli/commands/slack/pollRun.js";
import type { VerifyOwnDm } from "../../../../../cli/commands/slack/verifiedOwnDm.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { ok } from "../../../../../lib/result.js";
import type { ExactVoiceRule } from "../../../../../outbound/voice/exactRules.js";
import { readExactVoiceRules } from "../../../../../profileStore.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { NOTHING_PROVEN, PROMPT_DM, PROMPT_DM_IS_OWNERS, recordingOwnDm } from "./ownDmFakes.js";

/** What a fake dependency wrote down, so a test asserts on effects rather than on silence. */
interface Recorder {
  readonly calls: string[];
  readonly lines: string[];
}

/**
 * A dependency set where every member throws on use — a plain fake, not a mock.
 *
 * This is the assertion. `slack poll` is a door-routed external write, so the property worth pinning is that
 * a refused invocation touches NOTHING: no token read, no Slack call, no corpus read. If the refusal path
 * ever reaches a dependency, the thrown error fails the test loudly instead of the call being absorbed.
 */
function landmineDeps(): PollDeps {
  return new Proxy(
    {},
    {
      get: (_target, property) => () => {
        throw new Error(`refusal path touched dependency \`${String(property)}\``);
      },
    },
  ) as PollDeps;
}

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "slack", "poll", ...tail];
}

describe("runPollWithDeps — a refusal performs nothing at all", () => {
  it("refuses a bare invocation without touching a single dependency", async () => {
    expect(await runPollWithDeps({ argv: argv({ tail: [] }), deps: landmineDeps() })).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag without touching a single dependency", async () => {
    const code = await runPollWithDeps({
      argv: argv({ tail: ["--definitely-not-a-real-flag"] }),
      deps: landmineDeps(),
    });
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses a missing --channel without touching a single dependency", async () => {
    const code = await runPollWithDeps({ argv: argv({ tail: ["--as", "bot", "--form", "-"] }), deps: landmineDeps() });
    expect(code).toBe(EXIT_USAGE);
  });
});

describe("the manifest-selected handler", () => {
  it("carries no metadata of its own — the manifest owns that contract", () => {
    expect(Object.hasOwn(slackPollCommand, "meta")).toBe(false);
  });
});

/**
 * A working dependency bag for the POST path, so the door's own decision is reachable.
 *
 * Everything here is a plain fake. `landmineDeps` above answers the refusal-touches-nothing property; this
 * one answers the opposite question — that a poll which reaches the door is judged there.
 */
function postDeps({
  rec,
  voiceRules,
  doorLedger = memoryDoorLedger().port,
  highStakesChannels = [],
  ownDm = PROMPT_DM_IS_OWNERS,
}: {
  rec: Recorder;
  voiceRules: ReturnType<PollDeps["voiceRules"]>;
  doorLedger?: DoorLedgerPort;
  highStakesChannels?: readonly { readonly id: string; readonly name: string }[];
  ownDm?: VerifyOwnDm;
}): PollDeps {
  return {
    botToken: () => "xoxb-fake",
    doorLedger,
    cardChrome: () => ({
      authorEmoji: ":robot_face:",
      authorLabel: "slopweaver",
      bannerColor: "#2f6f4f",
      detailLabel: "*Detail*",
      metadataEventType: "slopweaver_poll",
    }),
    conversationSurface: async () => "public-channel",
    emit: (line) => rec.lines.push(line),
    env: () => ({}),
    fleetHistory: async () => {
      rec.calls.push("fleetHistory");
      return { kind: "read", priors: [] };
    },
    highStakes: () => ok({ channels: highStakesChannels, fleetGap: undefined, fleetUserIds: [], listGap: undefined }),
    nowIso: () => "2026-09-07T12:00:00.000Z",
    pollEventType: () => "slopweaver_poll",
    postPoll: async ({ channel }) => {
      rec.calls.push(`postPoll:${channel}`);
      return { channel, ts: "1788416854.480579" };
    },
    readReactions: async () => undefined,
    readStdin: async () => "",
    recordVoicePainPoints: ({ findings, lane }) => {
      for (const finding of findings) {
        rec.calls.push(`painPoint:${lane}:${finding.path}`);
      }
    },
    resolvePeople: async () => ok(new Map<string, string>()),
    seedReaction: async () => true,
    selfUserId: async () => "U0BOT",
    threadAnchor: async () => ({ kind: "present" }),
    channelClaim: () => ({ kind: "free" as const }),
    releaseChannelClaim: () => undefined,
    userGroupIds: async () => new Map(),
    verifiedOwnDm: ownDm,
    voiceRules: () => voiceRules,
  };
}

function pollForm({ question }: { question: string }): string {
  return JSON.stringify({
    kind: "poll",
    options: ["ship it", "hold"],
    question,
    why: "the window closes on Friday",
  });
}

describe("runPollWithDeps — the voice gate reaches the poll lane", () => {
  // The rule VALUE is a test fixture, never the operator's own — those stay in `profile.json`, per the
  // handover's own constraint that a literal rule string may not become a constant in this repository.
  const BANNED: readonly ExactVoiceRule[] = [{ kind: "literal", value: "leverage" }];
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-poll-voice-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("REFUSES a poll whose question breaks a rule, and posts nothing", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runPollWithDeps({
      argv: argv({
        tail: [
          "--as",
          "bot",
          "--channel",
          "C1",
          "--form",
          pollForm({ question: "do we leverage this?" }),
          "--home",
          home,
        ],
      }),
      deps: postDeps({ rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(rec.calls).toEqual(["painPoint:as-bot:question"]);
  });

  it("posts the same poll once the question is in voice", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runPollWithDeps({
      argv: argv({
        tail: ["--as", "bot", "--channel", "C1", "--form", pollForm({ question: "do we ship this?" }), "--home", home],
      }),
      deps: postDeps({ rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toContain("postPoll:C1");
  });

  it("hands the poll post and every seeded reaction the verb's --home, never the ambient one", async () => {
    const written: string[] = [];
    const base = postDeps({ rec: { calls: [], lines: [] }, voiceRules: ok(BANNED) });
    await runPollWithDeps({
      argv: argv({
        tail: ["--as", "bot", "--channel", "C1", "--form", pollForm({ question: "do we ship this?" }), "--home", home],
      }),
      deps: {
        ...base,
        postPoll: async (args) => {
          written.push(`post:${args.home}`);
          return base.postPoll(args);
        },
        seedReaction: async ({ home: at }) => {
          written.push(`seed:${at}`);
          return true;
        },
      },
    });

    expect(written).toEqual([`post:${home}`, `seed:${home}`, `seed:${home}`, `seed:${home}`]);
  });

  // Its contrast is the in-voice poll above, which posts: the one difference is that this question opens on the fix.
  it("HOLDS a poll whose question opens on a pull request, and posts nothing", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runPollWithDeps({
      argv: argv({
        tail: [
          "--as",
          "bot",
          "--channel",
          "C1",
          "--form",
          pollForm({ question: "Approve the fix PR for the gateway outage?" }),
          "--home",
          home,
        ],
      }),
      deps: postDeps({ rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    // No pain point either, so the voice gate is not what held it.
    expect(rec.calls).toEqual([]);
  });

  // The configured prompt channel is exempt only when the bot-token read proved it the owner's: a colleague's DM configured
  // there is held exactly as a channel is.
  it.each([
    {
      calls: [`postPoll:${PROMPT_DM}`],
      code: EXIT_OK,
      name: "posts it in the owner's own bot DM",
      ownDm: PROMPT_DM_IS_OWNERS,
    },
    {
      calls: [],
      code: EXIT_EXPECTED_EMPTY,
      name: "HOLDS it in a colleague's DM configured as the owner's",
      ownDm: NOTHING_PROVEN,
    },
  ])("$name", async ({ calls, code, ownDm }) => {
    const rec: Recorder = { calls: [], lines: [] };
    const seam = recordingOwnDm({ answer: ownDm });
    const exit = await runPollWithDeps({
      argv: argv({
        tail: [
          "--as",
          "bot",
          "--channel",
          PROMPT_DM,
          "--form",
          pollForm({ question: "Approve the fix PR for the gateway outage?" }),
          "--home",
          home,
        ],
      }),
      deps: postDeps({ ownDm: seam.verify, rec, voiceRules: ok(BANNED) }),
    });

    expect(exit).toBe(code);
    expect(seam.asked).toEqual([PROMPT_DM]);
    expect(rec.calls).toEqual(calls);
  });

  // A preview refuses what the send would: the same read, the same verdict, and nothing posted either way.
  it.each([
    { code: EXIT_OK, name: "previews it in the owner's own bot DM", ownDm: PROMPT_DM_IS_OWNERS },
    {
      code: EXIT_EXPECTED_EMPTY,
      name: "HOLDS the preview in a colleague's DM configured as the owner's",
      ownDm: NOTHING_PROVEN,
    },
  ])("--dry-run $name", async ({ code, ownDm }) => {
    const rec: Recorder = { calls: [], lines: [] };
    const seam = recordingOwnDm({ answer: ownDm });
    const exit = await runPollWithDeps({
      argv: argv({
        tail: [
          "--as",
          "bot",
          "--channel",
          PROMPT_DM,
          "--form",
          pollForm({ question: "Approve the fix PR for the gateway outage?" }),
          "--home",
          home,
          "--dry-run",
        ],
      }),
      deps: postDeps({ ownDm: seam.verify, rec, voiceRules: ok(BANNED) }),
    });

    expect(exit).toBe(code);
    expect(seam.asked).toEqual([PROMPT_DM]);
    expect(rec.calls).toEqual([]);
  });

  it("REFUSES a poll into a high-stakes channel, named by its name, and posts nothing", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runPollWithDeps({
      argv: argv({
        tail: [
          "--as",
          "bot",
          "--channel",
          "defects",
          "--form",
          pollForm({ question: "do we ship this?" }),
          "--home",
          home,
        ],
      }),
      deps: postDeps({ highStakesChannels: [{ id: "C0SYN000003", name: "#defects" }], rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });

  it("judges every OPTION label too, naming the one that broke the rule by index", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const form = JSON.stringify({
      kind: "poll",
      options: ["ship it", "leverage the window"],
      question: "what now?",
      why: "the window closes on Friday",
    });
    const code = await runPollWithDeps({
      argv: argv({ tail: ["--as", "bot", "--channel", "C1", "--form", form, "--home", home] }),
      deps: postDeps({ rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(rec.calls).toEqual(["painPoint:as-bot:options[1]"]);
  });

  // Every Slack READ is recorded too, and the form pings a group, so both reads a post makes before its door
  // would show up here if the profile were read after them.
  it.each([
    { dryRun: false, name: "a post" },
    { dryRun: true, name: "a dry run" },
  ])(
    "stops $name on a CORRUPT profile before Slack is asked anything, rather than reading it as no rules",
    async ({ dryRun }) => {
      writeFileSync(join(home, "profile.json"), "{", "utf8");
      const rec: Recorder = { calls: [], lines: [] };
      const voiceRules = readExactVoiceRules({ home });
      const door = memoryDoorLedger();
      const form = JSON.stringify({
        ...JSON.parse(pollForm({ question: "do we ship this?" })),
        ping: [{ handle: "eng", kind: "group" }],
      });
      const code = await runPollWithDeps({
        argv: argv({
          tail: ["--as", "bot", "--channel", "C1", "--form", form, "--home", home, ...(dryRun ? ["--dry-run"] : [])],
        }),
        deps: {
          ...postDeps({ doorLedger: door.port, rec, voiceRules }),
          conversationSurface: async () => {
            rec.calls.push("conversationSurface");
            return "public-channel";
          },
          userGroupIds: async () => {
            rec.calls.push("userGroupIds");
            return new Map([["eng", "S0ENG"]]);
          },
        },
      });

      expect(voiceRules.isErr()).toBe(true);
      expect(code).toBe(EXIT_ERROR);
      expect(rec.calls).toEqual([]);
      expect(rec.lines).toEqual([]);
      expect(door.records()).toEqual([]);
    },
  );
});
