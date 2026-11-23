/**
 * `slopweaver turn settle-reaction` — the by-hand path that converges a message an EARLIER turn left
 * wearing two contradictory lifecycle reactions.
 *
 * The three measured messages this verb exists for are all already TERMINAL, so no automatic path will ever
 * run over them again. That is what these tests have to hold: the refusal rail (a message the bot never
 * captured is never stamped), the mapping from an ending to its emoji, and the convergence itself driven
 * over a fake message whose reactions are a real set — so "both are still standing" is a state an assertion
 * can see, which a call log alone could not prove.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  judgedEndingContradicted,
  parseTurnSettleReactionArgs,
  runTurnSettleReaction,
  SETTLE_REACTION_ENDINGS,
  terminalReactionFrom,
} from "../../../../../cli/commands/turn/settleReaction.js";
import { TURN_SETTLE_REACTION_USAGE } from "../../../../../cli/commands/turn/usage.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { AskIdentity } from "../../../../../live/ask/identity.js";
import type { AskLifecycleEvent } from "../../../../../live/ask/lifecycleEvents.js";
import { appendAskLifecycleEvent } from "../../../../../live/ask/store.js";
import {
  lifecycleReactionEmojis,
  reactionsToRetire,
  terminalReactionEmoji,
} from "../../../../../live/turn/lifecycleReactions.js";
import { settleLifecycleReaction } from "../../../../../live/turn/poster.js";
import { workspaceShapeRefusals } from "../../../../slackWorkspaceShapeFake.js";

/** The profile-less defaults every emoji resolver falls back to, so a temp home needs no `profile.json`. */
const COMPLETION = "white_check_mark";
const STOPPED = "warning";
const ACKNOWLEDGED = "ack";
const FOR_A_HUMAN = "for-a-human";
const CAPTURE = "eyes";
const QUEUED = "hourglass_flowing_sand";

/** The owner's own whitelist ask, measured wearing STOPPED and COMPLETION at once. */
const ASK: AskIdentity = {
  channel: "C_SETTLE",
  messageTs: "1787540563.699759",
  threadTs: "1787539401.542749",
};

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-settle-reaction-"));
  fixtureDirs.push(dir);
  return dir;
}

/**
 * A fake Slack message whose reactions are a REAL set. `removeReaction` answers true for a name that was
 * never there, exactly as `reactions.remove`'s absorbed `no_reaction` does on the wire; every other method
 * throws, so a stray call fails loudly instead of passing by coincidence.
 */
function reactingTransport({ standing }: { standing: Set<string> }): SlackWriteTransport {
  const unused =
    ({ method }: { method: string }) =>
    async (): Promise<never> => {
      throw new Error(`${method} is not part of a lifecycle-reaction transition`);
    };
  return {
    ...workspaceShapeRefusals({ path: "the turn settle-reaction path" }),
    addReaction: async ({ name }) => {
      standing.add(name);
      return true;
    },
    appendStream: unused({ method: "appendStream" }),
    attachAssistantMedia: unused({ method: "attachAssistantMedia" }),
    attachMedia: unused({ method: "attachMedia" }),
    attachRecipeResponseMedia: unused({ method: "attachRecipeResponseMedia" }),
    conversationInfo: async () => ({ name: undefined, surface: "public-channel" as const }),
    deleteMessage: unused({ method: "deleteMessage" }),
    deleteMessageOnce: unused({ method: "deleteMessageOnce" }),
    postAssistantMessage: unused({ method: "postAssistantMessage" }),
    postCard: unused({ method: "postCard" }),
    postDripMessage: unused({ method: "postDripMessage" }),
    postNoFold: unused({ method: "postNoFold" }),
    postPoll: unused({ method: "postPoll" }),
    postRecipeResponse: unused({ method: "postRecipeResponse" }),
    postTurn: unused({ method: "postTurn" }),
    readBackFileCount: unused({ method: "readBackFileCount" }),
    readMessage: unused({ method: "readMessage" }),
    readReactions: unused({ method: "readReactions" }),
    removeReaction: async ({ name }) => {
      standing.delete(name);
      return true;
    },
    setAssistantStatus: unused({ method: "setAssistantStatus" }),
    setThreadTitle: unused({ method: "setThreadTitle" }),
    startStream: unused({ method: "startStream" }),
    stopStream: unused({ method: "stopStream" }),
    updateCard: unused({ method: "updateCard" }),
    correctMessage: unused({ method: "correctMessage" }),
    updateDripMessage: unused({ method: "updateDripMessage" }),
    updateTurn: unused({ method: "updateTurn" }),
    uploadPrivately: unused({ method: "uploadPrivately" }),
    userGroupIds: unused({ method: "userGroupIds" }),
    whoAmI: unused({ method: "whoAmI" }),
  };
}

describe("turn settle-reaction — reading the ending", () => {
  it("reads completion", () => {
    expect(terminalReactionFrom({ value: "completion" })).toBe("completion");
  });

  it("reads stopped", () => {
    expect(terminalReactionFrom({ value: "stopped" })).toBe("stopped");
  });

  it("reads acknowledged — the ending added because the other two both misreport a judged ask", () => {
    expect(terminalReactionFrom({ value: "acknowledged" })).toBe("acknowledged");
  });

  it("reads for-a-human — the ending for an ask the bot judged and left for a person to answer", () => {
    expect(terminalReactionFrom({ value: "for-a-human" })).toBe("for-a-human");
  });

  it("refuses a name that is none of them, rather than defaulting to one", () => {
    expect(terminalReactionFrom({ value: "eyes" })).toBeUndefined();
  });

  it("refuses an omitted flag", () => {
    expect(terminalReactionFrom({ value: undefined })).toBeUndefined();
  });
});

describe("turn settle-reaction — argument parsing", () => {
  it("accepts every flag the spec declares", () => {
    const parsed = unwrap(
      parseTurnSettleReactionArgs({
        rest: ["--channel", "C123", "--message-ts", "1712345678.000100", "--to", "completion", "--home", "/tmp/h"],
      }),
    );

    expect(parsed.values["channel"]).toBe("C123");
    expect(parsed.values["message-ts"]).toBe("1712345678.000100");
    expect(parsed.values["to"]).toBe("completion");
    expect(parsed.values["home"]).toBe("/tmp/h");
  });

  it("rejects a flag the spec does not declare", () => {
    const parsed = parseTurnSettleReactionArgs({ rest: ["--channel", "C123", "--emoji", "tada"] });

    expect(unwrapErr(parsed)).toEqual(["unknown flag: --emoji", "unexpected argument: tada"]);
  });
});

describe("turn settle-reaction — the ending's emoji", () => {
  it("maps completion to the profile default", () => {
    expect(terminalReactionEmoji({ home: tempHome(), reaction: "completion" })).toBe(COMPLETION);
  });

  it("maps stopped to the profile default", () => {
    expect(terminalReactionEmoji({ home: tempHome(), reaction: "stopped" })).toBe(STOPPED);
  });

  it("maps acknowledged to the profile default", () => {
    expect(terminalReactionEmoji({ home: tempHome(), reaction: "acknowledged" })).toBe(ACKNOWLEDGED);
  });

  it("maps for-a-human to its own profile default, never to acknowledged's", () => {
    expect(terminalReactionEmoji({ home: tempHome(), reaction: "for-a-human" })).toBe(FOR_A_HUMAN);
  });

  it("names every ending the usage line advertises, so help and parser cannot drift apart", () => {
    expect(SETTLE_REACTION_ENDINGS).toEqual(["completion", "stopped", "acknowledged", "for-a-human"]);
    expect(TURN_SETTLE_REACTION_USAGE).toContain("--to completion|stopped|acknowledged|for-a-human");
  });

  it("puts every ending in the retired set, so settling to one takes the others off", () => {
    const home = tempHome();

    const emojis = lifecycleReactionEmojis({ home });

    expect(reactionsToRetire({ emojis, standing: ACKNOWLEDGED })).toEqual([
      "hourglass_flowing_sand",
      "eyes",
      COMPLETION,
      STOPPED,
      FOR_A_HUMAN,
    ]);
    expect(reactionsToRetire({ emojis, standing: FOR_A_HUMAN })).toEqual([
      "hourglass_flowing_sand",
      "eyes",
      COMPLETION,
      STOPPED,
      ACKNOWLEDGED,
    ]);
  });
});

describe("turn settle-reaction — the convergence", () => {
  it("retires a stale terminal so the measured warning+completion pair becomes completion alone", async () => {
    const standing = new Set<string>([STOPPED, COMPLETION]);

    const outcome = await settleLifecycleReaction({
      askIdentity: ASK,
      home: tempHome(),
      reaction: "completion",
      transport: reactingTransport({ standing }),
    });

    expect(outcome).toEqual(ok(undefined));
    expect([...standing]).toEqual([COMPLETION]);
  });

  it("retires a stale queued reaction so the measured hourglass+completion pair becomes completion alone", async () => {
    const standing = new Set<string>([QUEUED, COMPLETION]);

    await settleLifecycleReaction({
      askIdentity: ASK,
      home: tempHome(),
      reaction: "completion",
      transport: reactingTransport({ standing }),
    });

    expect([...standing]).toEqual([COMPLETION]);
  });

  it("converges to stopped just as unconditionally, retiring the capture reaction", async () => {
    const standing = new Set<string>([CAPTURE]);

    await settleLifecycleReaction({
      askIdentity: ASK,
      home: tempHome(),
      reaction: "stopped",
      transport: reactingTransport({ standing }),
    });

    expect([...standing]).toEqual([STOPPED]);
  });

  it("leaves a human's own reaction alone — convergence is scoped to the lifecycle set", async () => {
    const standing = new Set<string>([STOPPED, "tada"]);

    await settleLifecycleReaction({
      askIdentity: ASK,
      home: tempHome(),
      reaction: "completion",
      transport: reactingTransport({ standing }),
    });

    expect([...standing]).toEqual(["tada", COMPLETION]);
  });

  it("is a no-op when the message already wears exactly the ending being settled", async () => {
    const standing = new Set<string>([COMPLETION]);

    const outcome = await settleLifecycleReaction({
      askIdentity: ASK,
      home: tempHome(),
      reaction: "completion",
      transport: reactingTransport({ standing }),
    });

    expect(outcome).toEqual(ok(undefined));
    expect([...standing]).toEqual([COMPLETION]);
  });
});

describe("turn settle-reaction — the verb's own rails", () => {
  it("prints usage and succeeds on --help", async () => {
    expect(await runTurnSettleReaction(["node", "cli", "turn", "settle-reaction", "--help"])).toBe(EXIT_OK);
  });

  it("refuses an invocation missing --to", async () => {
    const code = await runTurnSettleReaction([
      "node",
      "cli",
      "turn",
      "settle-reaction",
      "--channel",
      ASK.channel,
      "--message-ts",
      ASK.messageTs,
      "--home",
      tempHome(),
    ]);

    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses an ending that names neither terminal", async () => {
    const code = await runTurnSettleReaction([
      "node",
      "cli",
      "turn",
      "settle-reaction",
      "--channel",
      ASK.channel,
      "--message-ts",
      ASK.messageTs,
      "--to",
      "eyes",
      "--home",
      tempHome(),
    ]);

    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses a message the listener never captured, rather than stamping a signal onto it", async () => {
    const code = await runTurnSettleReaction([
      "node",
      "cli",
      "turn",
      "settle-reaction",
      "--channel",
      ASK.channel,
      "--message-ts",
      ASK.messageTs,
      "--to",
      "completion",
      "--home",
      tempHome(),
    ]);

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("gets PAST the capture rail for an ask that was captured, and stops on the absent token", async () => {
    // The succeeding half of the rail, which the refusal test alone cannot prove: with a real captured ask
    // on disk the verb reaches the NEXT prerequisite instead of the same refusal. Both exit 3, so the log
    // line differs while the code does not — the on-disk fold is what separates them.
    // "Absent" has to hold for the ENVIRONMENT too, not just the temp home: the resolver reads
    // SLACK_BOT_TOKEN before the home's secret file, so on a machine with the bot token exported the verb
    // would reach Slack and this test would fail for a reason that has nothing to do with the rail.
    const exportedToken = process.env["SLACK_BOT_TOKEN"];
    delete process.env["SLACK_BOT_TOKEN"];
    const home = tempHome();
    appendAskLifecycleEvent({
      event: { ...ASK, kind: "captured", surface: "channel", tsIso: "2026-08-24T03:02:44.389Z", userId: "U_OWNER" },
      home,
    });

    const code = await runTurnSettleReaction([
      "node",
      "cli",
      "turn",
      "settle-reaction",
      "--channel",
      ASK.channel,
      "--message-ts",
      ASK.messageTs,
      "--to",
      "completion",
      "--home",
      home,
    ]);
    if (exportedToken !== undefined) {
      process.env["SLACK_BOT_TOKEN"] = exportedToken;
    }

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });
});

const CAPTURED_EVENT: AskLifecycleEvent = {
  ...ASK,
  kind: "captured",
  surface: "channel",
  tsIso: "2026-10-13T06:00:00.000Z",
  userId: "U_OWNER",
};

/** One ask's history: captured, then judged to `terminal`. */
function judgedHistory({
  terminal,
}: {
  terminal: "triaged-no-response" | "left-for-a-human";
}): readonly AskLifecycleEvent[] {
  return [CAPTURED_EVENT, { ...ASK, kind: terminal, reason: "judged", tsIso: "2026-10-13T06:01:00.000Z" }];
}

describe("turn settle-reaction — never swaps one judged ending for the other", () => {
  it("names the judged ending a swap would contradict, in both directions", () => {
    expect(
      judgedEndingContradicted({
        askIdentity: ASK,
        events: judgedHistory({ terminal: "left-for-a-human" }),
        reaction: "acknowledged",
      }),
    ).toBe("for-a-human");
    expect(
      judgedEndingContradicted({
        askIdentity: ASK,
        events: judgedHistory({ terminal: "triaged-no-response" }),
        reaction: "for-a-human",
      }),
    ).toBe("acknowledged");
  });

  it("still refuses the swap after a later re-capture reopened the fold — the judgement is history", () => {
    const events = [...judgedHistory({ terminal: "left-for-a-human" }), CAPTURED_EVENT];
    expect(judgedEndingContradicted({ askIdentity: ASK, events, reaction: "acknowledged" })).toBe("for-a-human");
  });

  it("refuses the swap on a stalled cleanup intent too", () => {
    const events: readonly AskLifecycleEvent[] = [
      CAPTURED_EVENT,
      { ...ASK, kind: "handover-cleanup-intended", reason: "judged", tsIso: "2026-10-13T06:01:00.000Z" },
    ];
    expect(judgedEndingContradicted({ askIdentity: ASK, events, reaction: "acknowledged" })).toBe("for-a-human");
  });

  it("passes a re-assertion of the judged ending, a completion or stopped correction, and an unjudged ask", () => {
    const left = judgedHistory({ terminal: "left-for-a-human" });
    const reactions = ["for-a-human", "completion", "stopped"] as const;
    expect(reactions.map((reaction) => judgedEndingContradicted({ askIdentity: ASK, events: left, reaction }))).toEqual(
      [undefined, undefined, undefined],
    );
    expect(
      judgedEndingContradicted({ askIdentity: ASK, events: [CAPTURED_EVENT], reaction: "acknowledged" }),
    ).toBeUndefined();
  });

  it("refuses `--to acknowledged` on an ask left for a person before reaching Slack", async () => {
    const home = tempHome();
    appendAskLifecycleEvent({
      event: { ...ASK, kind: "captured", surface: "channel", tsIso: "2026-10-13T06:00:00.000Z", userId: "U_OWNER" },
      home,
    });
    appendAskLifecycleEvent({
      event: { ...ASK, kind: "left-for-a-human", reason: "judged", tsIso: "2026-10-13T06:01:00.000Z" },
      home,
    });

    const code = await runTurnSettleReaction([
      "node",
      "cli",
      "turn",
      "settle-reaction",
      "--channel",
      ASK.channel,
      "--message-ts",
      ASK.messageTs,
      "--to",
      "acknowledged",
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_ERROR);
  });
});
