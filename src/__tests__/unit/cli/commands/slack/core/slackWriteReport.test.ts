/*
 * `slackWriteReport` and `slackWriteJson`: the one `--json` document — the exact payload, preview, steps and
 * mentions, a round trip a consumer can parse, and the thread a reply goes under.
 */
import { describe, expect, it } from "vitest";

import { type SlackWriteOptions, slackWriteJson, slackWriteReport } from "../../../../../../cli/commands/slack/core.js";
import { parseOwnJson } from "../../../../../parseOwnJson.js";
import { MENTIONS, planFor, VALID_FORM } from "./harness.js";

describe("slackWriteReport / slackWriteJson", () => {
  const OPTIONS: SlackWriteOptions = {
    actor: "bot",
    allowUnresolvedOwner: false,
    channel: "C1",
    dryRun: true,
    formJson: VALID_FORM,
    home: "/home",
    json: true,
    media: [],
    resendUnconfirmed: false,
    verb: "post",
  };

  it("carries the EXACT payload, the preview, the steps and the mentions in one document", () => {
    const plan = planFor();
    const report = slackWriteReport({
      mediaFilenames: [],
      mentions: MENTIONS,
      options: OPTIONS,
      plan,
      refusal: null,
      sent: null,
    });

    expect(report.payload).toEqual(plan.payload);
    // `folds` is GONE rather than corrected: it was computed as `blocks > 5`, which is the refuted rule,
    // so a consumer reading it was being told something no code here can know.
    expect(report.card).toEqual({ blocks: 6, wrappers: 1 });
    expect(report.form).toBe("update");
    expect(report.mentions).toEqual([{ person: "ada-l", slackId: "U_fake_ada", via: "override" }]);
    expect(report.steps.map((step) => step.api)).toEqual(["chat.postMessage"]);
    expect(report.sent).toBe(null);
    expect(report.refusal).toBe(null);
    expect(report.threadTs).toBe(null);
  });

  it("round-trips as JSON, so a consumer can parse stdout", () => {
    const report = slackWriteReport({
      mediaFilenames: [],
      mentions: MENTIONS,
      options: OPTIONS,
      plan: planFor(),
      refusal: null,
      sent: { channel: "C1", fileIds: ["F1"], missingMedia: [], ok: true, ts: "1700000000.000100" },
    });

    const parsed = parseOwnJson<{ sent: { ts: string }; roster: { heldPeople: number } }>({
      text: slackWriteJson({ report }),
    });
    expect(parsed.sent.ts).toBe("1700000000.000100");
    expect(parsed.roster.heldPeople).toBe(3);
  });

  it("names the thread a reply goes under", () => {
    const report = slackWriteReport({
      mediaFilenames: [],
      mentions: MENTIONS,
      options: OPTIONS,
      plan: { ...planFor(), threadTs: "1700000000.000100" },
      refusal: null,
      sent: null,
    });

    expect(report.threadTs).toBe("1700000000.000100");
  });
});
