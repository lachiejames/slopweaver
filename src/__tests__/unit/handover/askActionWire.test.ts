import { describe, expect, it } from "vitest";

import type { SlackAskAction } from "../../../handover/askAction.js";
import { type AskActionRead, askActionFrom, askActionSchema } from "../../../handover/askActionWire.js";

/** A well-formed action, as a verb would hand one to the schema. */
const WHOLE: SlackAskAction = {
  actor: "me",
  body: "<@U01ARI> the E2E switch-over is ready for review.",
  destinations: [
    {
      channel: "C01SDLC",
      kind: "channel",
      label: "Post it to #delivery",
      tradeoff: "the whole channel sees we are asking",
    },
  ],
  mentions: [{ label: "Ari", userId: "U01ARI" }],
  version: 1,
};

/** The same action as a plain bag, which is what a journal line really carries. */
const wire = (): Record<string, unknown> => JSON.parse(JSON.stringify(WHOLE)) as Record<string, unknown>;

/**
 * The action a read carries, throwing when it carries none — the `unwrap` shape, so no assertion below
 * needs a conditional to reach the value it is about.
 */
function actionIn({ read }: { read: AskActionRead }): SlackAskAction {
  if (read.kind !== "action") {
    throw new Error(`expected an action, read ${read.kind}`);
  }
  if (read.action.version !== 1) {
    throw new Error("expected a Slack action, read a mail one");
  }
  return read.action;
}

/** The sentence a read gives for refusing, throwing when it did not refuse. */
function whyIn({ read }: { read: AskActionRead }): string {
  if (read.kind !== "invalid") {
    throw new Error(`expected invalid, read ${read.kind}`);
  }
  return read.why;
}

describe("askActionSchema", () => {
  it("accepts a whole action", () => {
    expect(askActionSchema.safeParse(wire()).success).toBe(true);
  });

  it("refuses a field this build would not render", () => {
    expect(askActionSchema.safeParse({ ...wire(), urgency: "high" }).success).toBe(false);
  });

  it("refuses a version this build does not write", () => {
    expect(askActionSchema.safeParse({ ...wire(), version: 2 }).success).toBe(false);
  });

  it("refuses a structurally sound action that breaks its own caps", () => {
    expect(askActionSchema.safeParse({ ...wire(), mentions: [] }).success).toBe(false);
  });
});

describe("askActionFrom", () => {
  it("answers none for a line that carries no action", () => {
    expect(askActionFrom({ value: undefined })).toEqual({ kind: "none" });
    expect(askActionFrom({ value: null })).toEqual({ kind: "none" });
  });

  it("round-trips a whole action through JSON without inventing a field", () => {
    expect(askActionFrom({ value: wire() })).toEqual({ action: WHOLE, kind: "action" });
  });

  it("OMITS an absent optional rather than carrying undefined, so an append matches its read-back", () => {
    const action = actionIn({ read: askActionFrom({ value: wire() }) });
    expect(Object.keys(action.destinations[0]!)).toEqual(["channel", "kind", "label", "tradeoff"]);
  });

  it("OMITS follow-ups on a one-message action, so a line recorded before the field existed reads back unchanged", () => {
    const action = actionIn({ read: askActionFrom({ value: wire() }) });
    expect(Object.keys(action)).toEqual(["actor", "body", "destinations", "mentions", "version"]);
  });

  it("round-trips a draft sent in parts, every message in order", () => {
    const thread = {
      channel: "C01ISO",
      kind: "thread",
      label: "Reply in the ISO thread",
      threadTs: "1758900000.000100",
      tradeoff: "only the thread sees it",
    };
    const value = { ...wire(), destinations: [thread], followUps: ["a second message, on its own"] };
    expect(actionIn({ read: askActionFrom({ value }) }).followUps).toEqual(["a second message, on its own"]);
  });

  it("names a follow-up beside a channel as the rule it breaks, never dropping the second message", () => {
    const value = { ...wire(), followUps: ["a second message"] };
    expect(whyIn({ read: askActionFrom({ value }) })).toBe(
      "Post it to #delivery is a new top-level message, and follow-ups there would be several top-level posts — " +
        "offer a thread or a DM for a message that goes out in parts",
    );
  });

  it("refuses a blank follow-up at the schema", () => {
    expect(askActionSchema.safeParse({ ...wire(), followUps: [""] }).success).toBe(false);
  });

  it("keeps an optional the line really carried", () => {
    const destinations = [{ ...WHOLE.destinations[0], url: "https://acme.slack.com/archives/C01SDLC" }];
    const action = actionIn({ read: askActionFrom({ value: { ...wire(), destinations } }) });
    expect(action.destinations[0]).toEqual({
      channel: "C01SDLC",
      kind: "channel",
      label: "Post it to #delivery",
      tradeoff: "the whole channel sees we are asking",
      url: "https://acme.slack.com/archives/C01SDLC",
    });
  });

  it("reports invalid, naming the field, on a hand-edited line — never none", () => {
    expect(whyIn({ read: askActionFrom({ value: { ...wire(), actor: "bot" } }) })).toContain("actor");
  });

  it("reports invalid on an action that parses but breaks a cap, naming the first rule", () => {
    expect(askActionFrom({ value: { ...wire(), destinations: [] } })).toEqual({
      kind: "invalid",
      why: "the action offers nowhere to send it — a draft with no destination is not a decision",
    });
  });

  it("reports invalid rather than throwing on a value that is not an object at all", () => {
    expect(askActionFrom({ value: "post it" }).kind).toBe("invalid");
  });
});
