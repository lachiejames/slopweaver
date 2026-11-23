import { describe, expect, it } from "vitest";
import { NOTHING_PARKED } from "../../../../../cli/commands/slack/draftMedia.js";
import { priorAskOfRecording } from "../../../../../cli/commands/slack/draftPriorAsk.js";
import type { SlackDraftDeps } from "../../../../../cli/commands/slack/draftRun.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { AskedBeforeDeclaration, PriorRead } from "../../../../../outbound/slack/priorAsk.js";

const PERMALINK = "https://acme.slack.com/archives/C0ISO/p1789000000000100";
const OURS = { text: "is the key spend expected?", ts: "1789000000.000100", userId: "U0SYNADAOWN" };
const ANSWER = { text: "expected, the batch job", ts: "1789000100.000100", userId: "U0JONAH" };
const PRIOR: AskedBeforeDeclaration = { changedMedia: [], kind: "prior", permalink: PERMALINK };

/**
 * The deps the hold reads, recording each read; the proof's admission and store are never reached here.
 *
 * @param read what the earlier ask reads as
 * @param calls where each read is written
 * @returns the deps
 */
function deps({
  read,
  calls,
}: {
  read: PriorRead;
  calls: string[];
}): Pick<SlackDraftDeps, "readPriorAsk" | "prepareMedia" | "storeMedia" | "doorEnv" | "nowIso"> {
  return {
    doorEnv: () => ({}),
    nowIso: () => "2026-10-05T04:00:00.000Z",
    prepareMedia: async () => {
      throw new Error("no proof is admitted in these cases");
    },
    readPriorAsk: async ({ permalink }) => {
      calls.push(`readPriorAsk:${permalink}`);
      return ok(read);
    },
    storeMedia: () => {
      throw new Error("no proof is stored in these cases");
    },
  };
}

/**
 * Run the hold over one declaration.
 *
 * @param declared what the recording declared
 * @param read what the earlier ask reads as
 * @param self the identity `auth.test` names, its `userId` absent for none
 * @param calls where each read is written
 * @returns the hold's result
 */
async function hold({
  declared,
  read = { addressedTs: OURS.ts, channelTopLevel: [], messages: [OURS, ANSWER] },
  self = { userId: "U0SYNADAOWN" },
  calls = [],
}: {
  declared: AskedBeforeDeclaration;
  read?: PriorRead;
  self?: { userId: string | undefined };
  calls?: string[];
}): ReturnType<typeof priorAskOfRecording> {
  return priorAskOfRecording({
    asked: "expected?",
    declared,
    deps: deps({ calls, read }),
    home: "/nonexistent-home",
    readSelfUserId: async () => {
      calls.push("whoAmI");
      return self.userId;
    },
    token: "xoxp-own",
  });
}

describe("priorAskOfRecording", () => {
  it("refuses a draft that asks and declared nothing, before anything is read", async () => {
    const calls: string[] = [];
    const result = await hold({ calls, declared: "undeclared" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).at(-1)).toBe(NOTHING_PARKED);
    expect(unwrapErr(result)[0]).toContain("--asked-before none");
    expect(calls).toEqual([]);
  });

  it("parks a draft declared never asked, reading nothing", async () => {
    const calls: string[] = [];
    const result = await hold({ calls, declared: { kind: "none" } });
    expect(result.isOk()).toBe(true);
    expect([unwrap(result), calls]).toEqual([{ kind: "none" }, []]);
  });

  it("refuses a prior when auth.test names no user, before the earlier ask is read", async () => {
    const calls: string[] = [];
    const result = await hold({ calls, declared: PRIOR, self: { userId: undefined } });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("auth.test named no user");
    expect(calls).toEqual(["whoAmI"]);
  });

  it("refuses an answered prior that shows no change and says no reason", async () => {
    const result = await hold({ declared: PRIOR });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).at(-1)).toBe(NOTHING_PARKED);
    expect(unwrapErr(result).join(" ")).toContain("default is to drop it");
  });

  it("parks an unanswered prior, carrying our message and no answers", async () => {
    const calls: string[] = [];
    const read = { addressedTs: OURS.ts, channelTopLevel: [], messages: [OURS] };
    const result = await hold({ calls, declared: PRIOR, read });
    expect(result.isOk()).toBe(true);
    const parked = unwrap(result)!;
    expect(parked).toEqual({
      answerCount: 0,
      answers: [],
      kind: "prior",
      ours: OURS,
      permalink: PERMALINK,
      readThroughTs: OURS.ts,
    });
    expect(calls).toEqual(["whoAmI", `readPriorAsk:${PERMALINK}`]);
  });
});
