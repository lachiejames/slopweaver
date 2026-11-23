/**
 * `admitScheduledPostTarget` / `postTargetRefusedLine` — the tick's side of where a scheduled post may land.
 *
 * `runDue/alertSummary.test.ts` and `runDue/datadogAlertDigest.test.ts` prove the rail through whole ticks. These
 * cases ask the leg directly, because the two
 * arms it answers are what every kind branches on, and the line it prints is the only thing an operator
 * ever sees when a row is refused.
 *
 * Pure: a row literal, a channel and a string.
 */
import { describe, expect, it } from "vitest";

import {
  admitScheduledPostTarget,
  postTargetRefusedLine,
} from "../../../../../cli/commands/automation/postTargetLeg.js";
import {
  RECIPE_DEFINITION_SCHEMA_VERSION,
  type RecipeChannelApproval,
  type RecipeDefinition,
} from "../../../../../live/automation/definition.js";
import { ScheduledPostTargetErrors } from "../../../../../live/automation/postTarget.js";

const DM = "D0BOT";
const TEAM = "C0TEAM";

/** An `alert-summary` row, overridable field by field. */
function row(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "0 9 * * *",
    destination: { kind: "slack" },
    effect: "read-write",
    enabled: true,
    kind: "alert-summary",
    onMissed: "skip",
    params: { channel: TEAM },
    recipeId: "iso-daily",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/** The owner's recorded approval for one conversation, resolvable to one message in their DM. */
function approval(over: Partial<RecipeChannelApproval> = {}): RecipeChannelApproval {
  return {
    atIso: "2026-09-21T03:01:00.000Z",
    channel: TEAM,
    dmChannel: DM,
    ts: "1789964259.684859",
    ...over,
  };
}

describe("admitScheduledPostTarget", () => {
  it("sends a row that named nowhere to the owner's DM, which is the default that replaced a channel post", () => {
    const admitted = admitScheduledPostTarget({
      definition: row(),
      dmChannel: DM,
      requested: undefined,
      where: "params.postTo",
    });
    expect(admitted).toEqual({ channel: DM });
  });

  it("refuses a channel the row carries no approval for, and posts nothing", () => {
    const admitted = admitScheduledPostTarget({
      definition: row(),
      dmChannel: DM,
      requested: TEAM,
      where: "params.postTo",
    });
    expect("refusal" in admitted).toBe(true);
    expect(JSON.stringify(admitted)).toContain("nothing was posted");
    expect(JSON.stringify(admitted)).toContain("params.postTo");
  });

  it("admits the channel once the owner's approval for it is recorded on the row", () => {
    const admitted = admitScheduledPostTarget({
      definition: row({ channelApprovals: [approval()] }),
      dmChannel: DM,
      requested: TEAM,
      where: "params.postTo",
    });
    expect(admitted).toEqual({ channel: TEAM });
  });

  it("does not let an approval for ONE channel admit another", () => {
    const admitted = admitScheduledPostTarget({
      definition: row({ channelApprovals: [approval({ channel: "C0OTHER" })] }),
      dmChannel: DM,
      requested: TEAM,
      where: "params.postTo",
    });
    expect("refusal" in admitted).toBe(true);
  });

  it("refuses everything on an install that has configured no private conversation", () => {
    const admitted = admitScheduledPostTarget({
      definition: row(),
      dmChannel: undefined,
      requested: undefined,
      where: "params.postTo",
    });
    expect("refusal" in admitted).toBe(true);
    expect(JSON.stringify(admitted)).toContain("slackBot.promptChannel");
  });
});

describe("postTargetRefusedLine", () => {
  it("names the row, carries the refusal's own text, and says nothing was posted", () => {
    const line = postTargetRefusedLine({
      error: ScheduledPostTargetErrors.dmUnconfigured({ recipeId: "iso-daily" }),
      recipeId: "iso-daily",
    });
    expect(line.startsWith("recipe iso-daily · REFUSED · ")).toBe(true);
    expect(line.endsWith(" · nothing was posted")).toBe(true);
  });
});
