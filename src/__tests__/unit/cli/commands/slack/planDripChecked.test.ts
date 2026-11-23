/**
 * The preparation seam: `planDripChecked` runs every refusal the as-me lane can decide without the ability
 * to post, and `sendOnlyDripRefusals` (`cli/commands/slack/dripSendPlan.ts`) is the only half holding one.
 *
 * The compiler already proves half of it — `DripReadDeps` has no `proveRender` field, so a caller holding
 * one cannot reach the function that posts. What a type cannot prove is that the CHECKS still run, and a
 * seam that quietly skipped them would look identical to one that works. So every case here asserts on a
 * refusal or a plan that could only come from the gate it names, and the reads are recorded so "it never
 * posted" rests on a list a dropped call would shorten rather than on the absence of an error.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { SlackDripOptions } from "../../../../../cli/commands/slack/core.js";
import { type DripReadDeps, planDripChecked } from "../../../../../cli/commands/slack/wallCheck.js";
import type { DripConfig } from "../../../../../cli/commands/slack/wiring.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { DripArtifact } from "../../../../../outbound/artifact/types.js";
import type { MentionResolution } from "../../../../../outbound/slack/mentionIndex.js";
import type { ConversationSurface } from "../../../../../outbound/slack/types.js";
import { grantedEnv, grantSessionEnv } from "../../../../hatchGrantFixture.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp state home, removed after the test. */
function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "plan-drip-checked-"));
  fixtureDirs.push(dir);
  return dir;
}

const CONFIG: DripConfig = {
  cardVisibleMax: 1000,
  exactVoiceRules: [],
  intervalMs: 0,
  maxBullets: 10,
  maxLines: 8,
  maxMessages: 8,
  messageVisibleMax: 300,
  paragraphSpacing: false,
  soleMessageVisibleMax: 1000,
};

const RESOLUTION: MentionResolution = {
  groupAddresses: new Map(),
  heldRequested: [],
  memberLookups: new Map(),
  resolved: new Map(),
  roster: { addressableKeys: 3, collisions: [], derivedPeople: 2, freshness: { kind: "fresh" }, heldPeople: 0 },
};

function artifact({ texts }: { texts: readonly string[] }): DripArtifact {
  return { kind: "drip", messages: texts.map((text) => ({ runs: [{ text, type: "text" as const }] })) };
}

function options({
  texts,
  shape = "top-level",
}: {
  texts: readonly string[];
  shape?: "top-level" | "thread";
}): SlackDripOptions {
  return {
    actor: "me",
    channel: "C1",
    dryRun: false,
    home: "/home",
    json: false,
    media: [],
    resendUnconfirmed: false,
    shape,
    source: { json: JSON.stringify(artifact({ texts })), kind: "form" },
    verb: "post",
  };
}

/**
 * A recording read-only world. `reads` is the falsifiable half: a gate this seam stopped calling drops its
 * own entry, so an assertion on the list reddens where an assertion on "no error" would stay green.
 */
function readDeps({
  reads,
  surface,
  highStakesChannels = [],
}: {
  reads: string[];
  /**
   * Required rather than defaulted, because `undefined` is a MEANING here — the read failed and Slack
   * would not say what the channel is. A default would swallow the case the fail-closed test passes.
   */
  surface: ConversationSurface | undefined;
  /** The install's high-stakes channels; none by default, so the gate never fires on a fixture about something else. */
  highStakesChannels?: readonly { readonly id: string; readonly name: string }[];
}): DripReadDeps {
  return {
    conversationSurface: async () => {
      reads.push("conversationSurface");
      return surface;
    },
    fleetHistory: async () => {
      reads.push("fleetHistory");
      return { kind: "read", priors: [] };
    },
    highStakes: () =>
      ok({ channels: highStakesChannels, fleetGap: undefined, fleetUserIds: ["U0OWNER"], listGap: undefined }),
    threadAnchor: async () => ({ kind: "present" as const }),
    channelClaim: () => ({ kind: "free" as const }),
    releaseChannelClaim: () => undefined,
    wallRun: async () => {
      reads.push("wallRun");
      return ok({ length: 0 });
    },
  };
}

describe("planDripChecked — the high-stakes channel gate", () => {
  const BUGS = { id: "C1", name: "#defects" };

  it("REFUSES a top-level as-me post to a high-stakes channel before reading anything live", async () => {
    const reads: string[] = [];
    const result = await planDripChecked({
      artifact: artifact({ texts: ["Found a bug."] }),
      config: CONFIG,
      deps: readDeps({ highStakesChannels: [BUGS], reads, surface: "public-channel" }),
      env: {},
      options: options({ texts: ["Found a bug."] }),
      resolution: RESOLUTION,
      token: "xoxp-test",
    });
    expect(unwrapErr(result).join(" ")).toContain("this is an as-me post to #defects");
    expect(unwrapErr(result).join(" ")).toContain("slopweaver hatch open high-stakes-undefended");
    expect(reads).toEqual([]);
  });

  it("lets a REPLY in a high-stakes channel's thread through, because the gate reads top-level posts only", async () => {
    const reads: string[] = [];
    const threaded: SlackDripOptions = {
      ...options({ shape: "thread", texts: ["Adding a data point."] }),
      threadTs: "1790000000.000100",
    };
    const result = await planDripChecked({
      artifact: artifact({ texts: ["Adding a data point."] }),
      config: CONFIG,
      deps: readDeps({ highStakesChannels: [BUGS], reads, surface: "public-channel" }),
      env: {},
      options: threaded,
      resolution: RESOLUTION,
      token: "xoxp-test",
    });
    expect(unwrap(result).channel).toBe("C1");
    expect(reads).toEqual([]);
  });

  it("REFUSES a top-level drip of three into a private high-stakes channel, counting each post, not the send", async () => {
    const reads: string[] = [];
    const texts = ["Found a bug.", "It is on staging.", "Repro attached."];
    const home = freshHome();
    const result = await planDripChecked({
      artifact: artifact({ texts }),
      config: CONFIG,
      deps: readDeps({ highStakesChannels: [BUGS], reads, surface: "private-channel" }),
      env: grantedEnv({ hatchIds: ["high-stakes-undefended"], home }),
      options: { ...options({ texts }), home },
      resolution: RESOLUTION,
      token: "xoxp-test",
    });
    expect(unwrapErr(result).join(" ")).toContain("this one send would put 3 top-level posts in #defects");
    expect(reads).toEqual([]);
  });

  it("does not take the retired undefended variable for a grant, so the as-me post is refused first", async () => {
    const reads: string[] = [];
    const texts = ["Found a bug.", "It is on staging.", "Repro attached."];
    const home = freshHome();
    const result = await planDripChecked({
      artifact: artifact({ texts }),
      config: CONFIG,
      deps: readDeps({ highStakesChannels: [BUGS], reads, surface: "private-channel" }),
      env: { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_HIGH_STAKES_UNDEFENDED: "1" },
      options: { ...options({ texts }), home },
      resolution: RESOLUTION,
      token: "xoxp-test",
    });
    expect(unwrapErr(result).join(" ")).toContain("this is an as-me post to #defects");
    expect(reads).toEqual([]);
  });
});

describe("planDripChecked — the preparation seam", () => {
  it("returns the built plan, and reaches the public-surface gate but never the wall read", async () => {
    const reads: string[] = [];
    const result = await planDripChecked({
      artifact: artifact({ texts: ["One line.", "And a second."] }),
      config: CONFIG,
      deps: readDeps({ reads, surface: "private-channel" }),
      env: {},
      options: options({ texts: ["One line.", "And a second."] }),
      resolution: RESOLUTION,
      token: "xoxp-test",
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).messages.length).toBe(2);
    expect(unwrap(result).channel).toBe("C1");
    // The surface read is this seam's one live call; the wall read belongs to `sendOnlyDripRefusals`, which a
    // preparation pass does not run.
    expect(reads).toEqual(["conversationSurface"]);
  });

  it("still REFUSES a multi-message top-level drip into a channel the whole org can read", async () => {
    const reads: string[] = [];
    const result = await planDripChecked({
      artifact: artifact({ texts: ["One line.", "And a second."] }),
      config: CONFIG,
      deps: readDeps({ reads, surface: "public-channel" }),
      env: {},
      options: options({ texts: ["One line.", "And a second."] }),
      resolution: RESOLUTION,
      token: "xoxp-test",
    });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result).join(" ")).toContain("one-card");
    expect(reads).toEqual(["conversationSurface"]);
  });

  it("fails CLOSED when the surface read itself fails, rather than preparing a draft nothing checked", async () => {
    const reads: string[] = [];
    const deps = readDeps({ reads, surface: undefined });
    const result = await planDripChecked({
      artifact: artifact({ texts: ["One line.", "And a second."] }),
      config: CONFIG,
      deps,
      env: {},
      options: options({ texts: ["One line.", "And a second."] }),
      resolution: RESOLUTION,
      token: "xoxp-test",
    });
    // The refusal names the UNREADABLE case in its own words rather than claiming the channel is public,
    // and still refuses: an answer Slack would not give is not a clearance.
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result).join(" ")).toContain("Slack could not say whether that channel is public or private");
    expect(unwrapErr(result).join(" ")).toContain("post it as ONE top-level message instead");
    expect(reads).toEqual(["conversationSurface"]);
  });
});

describe("planDripChecked — the review-ask shape gate", () => {
  const ASK: DripArtifact = {
    kind: "drip",
    messages: [
      {
        runs: [
          { text: "hey, could I grab a review on ", type: "text" },
          { label: "#17945", type: "link", url: "https://github.com/acme/acme-admin/pull/17945" },
          { text: " when you get a sec? no rush", type: "text" },
        ],
      },
    ],
  };
  const DM: SlackDripOptions = {
    ...options({ texts: [] }),
    channel: "U0SYN000008",
    source: { json: JSON.stringify(ASK), kind: "form" },
  };

  it("REFUSES a DM review ask a recording never declared the reviewer for, before reading anything live", async () => {
    const reads: string[] = [];
    const result = await planDripChecked({
      artifact: ASK,
      config: CONFIG,
      deps: readDeps({ reads, surface: "direct-message" }),
      env: {},
      options: { ...DM, reviewer: "undeclared" },
      resolution: RESOLUTION,
      token: "xoxp-test",
    });
    expect(unwrapErr(result).join(" ")).toContain("`--reviewer in-thread` or `--reviewer new`");
    expect(reads).toEqual([]);
  });

  it("REFUSES the same ask opening on the ask to a reviewer declared new, and passes it for one in the thread", async () => {
    const run = async ({ reviewer }: { reviewer: "new" | "in-thread" }): ReturnType<typeof planDripChecked> =>
      planDripChecked({
        artifact: ASK,
        config: CONFIG,
        deps: readDeps({ reads: [], surface: "direct-message" }),
        env: {},
        options: { ...DM, reviewer },
        resolution: RESOLUTION,
        token: "xoxp-test",
      });
    expect(unwrapErr(await run({ reviewer: "new" })).join(" ")).toContain("opens on the ask");
    expect(unwrap(await run({ reviewer: "in-thread" })).channel).toBe("U0SYN000008");
  });
});
