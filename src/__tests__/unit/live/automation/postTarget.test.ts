/**
 * `live/automation/postTarget.ts` — the planner-side rail: a scheduled row's card lands in the owner's bot DM,
 * and a channel is refused unless the row carries the owner's own recorded approval for it.
 *
 * Pure: every case is a row literal and a configured DM.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  RECIPE_DEFINITION_SCHEMA_VERSION,
  type RecipeChannelApproval,
  type RecipeDefinition,
} from "../../../../live/automation/definition.js";
import {
  approvalFor,
  refuseVerbRunPostTargets,
  resolveScheduledPostTarget,
  verbRunPostTargets,
} from "../../../../live/automation/postTarget.js";

/** The owner's configured private conversation, as `slackBot.promptChannel` resolves it. */
const DM = "D0SYNOWNERDM";

/** One recorded approval, overridable field by field. */
function approval(over: Partial<RecipeChannelApproval> = {}): RecipeChannelApproval {
  return {
    atIso: "2026-09-21T04:00:00.000Z",
    channel: "C0TEAM",
    dmChannel: DM,
    ts: "1758424800.000100",
    ...over,
  };
}

/** A `verb-run` row, overridable field by field. */
function row(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "0 9 * * *",
    destination: { kind: "slack" },
    effect: "read-write",
    enabled: true,
    kind: "verb-run",
    onMissed: "skip",
    params: { argv: ["notice", "publish", "--channel", "C0TEAM", "--post"] },
    recipeId: "scheduled-notice-daily",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

describe("resolveScheduledPostTarget", () => {
  it("sends a row that asked for nowhere to the owner's DM — the DEFAULT is the whole fix", () => {
    const resolved = resolveScheduledPostTarget({
      approvals: undefined,
      dmChannel: DM,
      recipeId: "team-alerts-daily-alerts-access",
      requested: undefined,
      where: "params.postTo",
    });
    expect(resolved.isOk()).toBe(true);
    expect(unwrap(resolved)).toBe(DM);
  });

  it("admits the DM when the row named it outright", () => {
    const resolved = resolveScheduledPostTarget({
      approvals: undefined,
      dmChannel: DM,
      recipeId: "team-alerts-daily-alerts-access",
      requested: DM,
      where: "params.postTo",
    });
    expect(unwrap(resolved)).toBe(DM);
  });

  it("REFUSES a channel the row carries no approval for, naming the channel and the field", () => {
    const resolved = resolveScheduledPostTarget({
      approvals: undefined,
      dmChannel: DM,
      recipeId: "team-alerts-daily-alerts-access",
      requested: "C0TEAM",
      where: "params.postTo",
    });
    expect(resolved.isErr()).toBe(true);
    expect(resolved._unsafeUnwrapErr().code).toBe("POST_TARGET_NOT_APPROVED");
    expect(resolved._unsafeUnwrapErr().message).toContain("aims its card at C0TEAM (from params.postTo)");
  });

  it("says out loud that the refusal has no escape hatch, so nobody hunts for one", () => {
    const resolved = resolveScheduledPostTarget({
      approvals: undefined,
      dmChannel: DM,
      recipeId: "team-alerts-daily-alerts-access",
      requested: "C0TEAM",
      where: "params.postTo",
    });
    expect(resolved._unsafeUnwrapErr().message).toContain("deliberately NO escape hatch");
    expect(resolved._unsafeUnwrapErr().message).toContain("channelApprovals");
  });

  it("admits the channel once the owner's approval for it is recorded on the row", () => {
    const resolved = resolveScheduledPostTarget({
      approvals: [approval()],
      dmChannel: DM,
      recipeId: "team-alerts-daily-alerts-access",
      requested: "C0TEAM",
      where: "params.postTo",
    });
    expect(unwrap(resolved)).toBe("C0TEAM");
  });

  it("does not let an approval for ONE channel admit another", () => {
    const resolved = resolveScheduledPostTarget({
      approvals: [approval({ channel: "C0OTHER" })],
      dmChannel: DM,
      recipeId: "team-alerts-daily-alerts-access",
      requested: "C0TEAM",
      where: "params.postTo",
    });
    expect(resolved._unsafeUnwrapErr().code).toBe("POST_TARGET_NOT_APPROVED");
  });

  it("REFUSES an install that has configured no private conversation, rather than inventing one", () => {
    const resolved = resolveScheduledPostTarget({
      approvals: [approval()],
      dmChannel: undefined,
      recipeId: "team-alerts-daily-alerts-access",
      requested: "C0TEAM",
      where: "params.postTo",
    });
    expect(resolved._unsafeUnwrapErr().code).toBe("DM_UNCONFIGURED");
    expect(resolved._unsafeUnwrapErr().message).toContain("slackBot.promptChannel");
  });
});

describe("verbRunPostTargets — the argv tripwire", () => {
  it("finds the channel a scheduled posting row names, and names the argv words that spelled it", () => {
    expect(verbRunPostTargets({ definition: row() })).toEqual([
      { channel: "C0TEAM", where: "params.argv `--channel C0TEAM`" },
    ]);
  });

  it("finds every channel flag a row carries, in argv order", () => {
    const two = row({ params: { argv: ["x", "y", "--channel", "C0A", "--post-to", "C0B"] } });
    expect(verbRunPostTargets({ definition: two }).map((target) => target.channel)).toEqual(["C0A", "C0B"]);
  });

  it("names none for a row declaring `read`, whose verb may not write at all", () => {
    expect(verbRunPostTargets({ definition: row({ effect: "read" }) })).toEqual([]);
  });

  it("names none for a flag with no value after it", () => {
    expect(verbRunPostTargets({ definition: row({ params: { argv: ["vanta", "x", "--channel"] } }) })).toEqual([]);
  });

  it("names none for params that carry no argv at all", () => {
    expect(verbRunPostTargets({ definition: row({ params: {} }) })).toEqual([]);
  });
});

describe("refuseVerbRunPostTargets", () => {
  it("refuses a scheduled posting row whose channel carries no approval", () => {
    const refused = refuseVerbRunPostTargets({ definition: row(), dmChannel: DM });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("POST_TARGET_NOT_APPROVED");
    expect(refused._unsafeUnwrapErr().message).toContain("params.argv `--channel C0TEAM`");
  });

  it("admits the same row once the owner's approval for that channel is recorded on it", () => {
    const refused = refuseVerbRunPostTargets({
      definition: row({ channelApprovals: [approval()] }),
      dmChannel: DM,
    });
    expect(unwrap(refused).map((target) => target.channel)).toEqual(["C0TEAM"]);
  });

  it("admits a row that already posts into the owner's DM", () => {
    const toDm = row({ params: { argv: ["notice", "publish", "--channel", DM, "--post"] } });
    expect(unwrap(refuseVerbRunPostTargets({ definition: toDm, dmChannel: DM })).length).toBe(1);
  });

  it("leaves a row naming no channel alone even on an install with no DM configured", () => {
    const noChannel = row({ params: { argv: ["worktree", "prune"] } });
    expect(unwrap(refuseVerbRunPostTargets({ definition: noChannel, dmChannel: undefined }))).toEqual([]);
  });

  it("refuses a row that names a channel on an install with no DM configured", () => {
    const refused = refuseVerbRunPostTargets({ definition: row(), dmChannel: undefined });
    expect(refused._unsafeUnwrapErr().code).toBe("DM_UNCONFIGURED");
  });
});

describe("approvalFor", () => {
  it("matches a channel EXACTLY, so a prefix of an approved one is not approved", () => {
    expect(approvalFor({ approvals: [approval()], channel: "C0TEAMX" })).toBe(undefined);
    expect(approvalFor({ approvals: [approval()], channel: "C0TEAM" })).toEqual(approval());
  });

  it("answers undefined for a row that records no approvals at all", () => {
    expect(approvalFor({ approvals: undefined, channel: "C0TEAM" })).toBe(undefined);
  });
});
