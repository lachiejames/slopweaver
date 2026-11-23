import { afterEach, describe, expect, it } from "vitest";
import { renderedCard } from "../../../../../../cli/commands/slack/cardWriteRun.js";
import type { SlackWritePlan } from "../../../../../../cli/commands/slack/core.js";
import type { DraftRecordOptions } from "../../../../../../cli/commands/slack/draftCore.js";
import { botRecordCardOptions } from "../../../../../../cli/commands/slack/draftRecordBotRun.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import type { SlackCardPayload } from "../../../../../../outbound/slack/types.js";
import { deps } from "./deps.js";
import { FORM, freshHome, MENTION_FORM, recorder, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

/** The card payload of a rendered plan, throwing on a no-fold one so a test reads it without a cast. */
function cardPayloadOf({ plan }: { plan: SlackWritePlan }): SlackCardPayload {
  if (plan.kind !== "update") throw new Error(`expected an update plan, got ${plan.kind}`);
  return plan.payload;
}

describe("a bot recording renders the card its release will send", () => {
  const RECORD: DraftRecordOptions = {
    actor: "bot",
    askedBefore: "undeclared",
    channel: "C1",
    formSource: FORM,
    home: "/unused-home",
    json: false,
    media: ["0.png"],
    mode: "record",
    receipts: { kind: "undeclared" },
    supersedes: [],
    why: "a finding for the team",
  };

  it("records top-level as a dry, approved `post`, with no thread", () => {
    const options = botRecordCardOptions({ formJson: FORM, options: RECORD });

    expect(options).toEqual({
      actor: "bot",
      allowUnresolvedOwner: false,
      approvedDraft: true,
      channel: "C1",
      dryRun: true,
      formJson: FORM,
      home: "/unused-home",
      json: false,
      media: ["0.png"],
      resendUnconfirmed: false,
      verb: "post",
    });
  });

  it("records a thread row as a `reply` under its root", () => {
    const options = botRecordCardOptions({ formJson: FORM, options: { ...RECORD, threadTs: "1727500000.000100" } });

    expect(options.verb).toBe("reply");
    expect(options.threadTs).toBe("1727500000.000100");
  });

  it("renders the admitted form into the channel it was recorded for", async () => {
    const cardOptions = botRecordCardOptions({ formJson: FORM, options: { ...RECORD, home: freshHome() } });

    const rendered = unwrap(await renderedCard({ cardOptions, deps: deps({ rec: recorder() }), formJson: FORM }));

    expect(rendered.plan.kind).toBe("update");
    expect(rendered.plan.channel).toBe("C1");
    expect(rendered.admitted.formKind).toBe("update");
    expect(cardPayloadOf({ plan: rendered.plan }).attachments[0].fallback).toContain("A short lead.");
  });

  it("refuses a form naming someone the roster cannot resolve, rendering nothing", async () => {
    const cardOptions = botRecordCardOptions({ formJson: MENTION_FORM, options: { ...RECORD, home: freshHome() } });

    const refused = unwrapErr(
      await renderedCard({ cardOptions, deps: deps({ rec: recorder() }), formJson: MENTION_FORM }),
    );

    expect(refused.join("\n")).toContain("ghost");
  });
});
