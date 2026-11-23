/*
 * `correctClaim` refusals: a claim the message does not make, makes twice, shows where no strike can reach, or
 * already struck, and a correction text that cannot render as written. It moved here when `claimCorrection.test.ts`
 * was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { claimCorrectedAs, correctClaim } from "../../../../../outbound/slack/claimCorrection.js";
import { CORRECTION_MAX_CHARS } from "../../../../../outbound/slack/claimCorrectionInput.js";
import { LEAD } from "./harness.js";

describe("correctClaim, refusals", () => {
  const stored = { blocks: [LEAD] };

  it("refuses a claim the message does not make", () => {
    expect(unwrapErr(correctClaim({ correction: "x.", stored, wrong: "5.0" })).code).toBe("CLAIM_NOT_FOUND");
  });

  it("refuses a claim that runs through a mention, which cannot be matched", () => {
    expect(unwrapErr(correctClaim({ correction: "x.", stored, wrong: ", — upgrade" })).code).toBe("CLAIM_NOT_FOUND");
  });

  it("refuses a claim made twice, naming the count", () => {
    const twice = unwrapErr(correctClaim({ correction: "x.", stored: { text: "a b a" }, wrong: "a" }));
    expect([twice.code, twice.message]).toEqual([
      "CLAIM_AMBIGUOUS",
      '"a" occurs 2 times in this message, so a strike could land on the wrong sentence. Pass a longer --wrong ' +
        "that occurs once. Nothing was changed.",
    ]);
  });

  it("refuses a claim a header also shows, before anything is edited", () => {
    const header = { text: { text: "4.2.0 is affected", type: "plain_text" }, type: "header" };
    const refused = unwrapErr(
      correctClaim({ correction: "x.", stored: { blocks: [header, LEAD] }, wrong: "4.2.0 is affected" }),
    );
    expect(refused.code).toBe("CLAIM_UNSTRIKEABLE");
  });

  it("refuses a claim a context line shows split across its elements, and reads one false", () => {
    const section = { text: { text: "the deploy finished", type: "mrkdwn" }, type: "section" };
    const split = ({ joint }: { joint: string }): unknown => ({
      elements: [
        { text: `the deploy${joint}`, type: "mrkdwn" },
        { text: "finished", type: "mrkdwn" },
      ],
      type: "context",
    });
    const wrong = "the deploy finished";
    const clean = unwrap(correctClaim({ correction: "It rolled back.", stored: { blocks: [section] }, wrong }));
    const refusedWith = ({ joint }: { joint: string }): string =>
      unwrapErr(correctClaim({ correction: "It rolled back.", stored: { blocks: [section, split({ joint })] }, wrong }))
        .code;
    expect([
      refusedWith({ joint: "" }),
      refusedWith({ joint: " " }),
      claimCorrectedAs({
        correction: "It rolled back.",
        stored: { blocks: [...clean.blocks!, split({ joint: "" })] },
        wrong,
      }),
    ]).toEqual(["CLAIM_UNSTRIKEABLE", "CLAIM_UNSTRIKEABLE", false]);
  });

  it("refuses a claim inside a mrkdwn code span, where a strike would show as literal tildes", () => {
    const section = ({ text }: { text: string }): unknown => ({ text: { text, type: "mrkdwn" }, type: "section" });
    const over = ({ text }: { text: string }) =>
      correctClaim({ correction: "good.", stored: { blocks: [section({ text })] }, wrong: "bad" });
    expect([
      unwrapErr(over({ text: "it is `bad` now" })).code,
      unwrap(over({ text: "`x` is bad now" })).struckIn,
    ]).toEqual(["CLAIM_UNSTRIKEABLE", "mrkdwn"]);
  });

  it("refuses a claim in a rich-text preformatted block or a code-styled run, and strikes a plain run", () => {
    const rich = ({ leafType, style }: { leafType: string; style?: Record<string, boolean> }): unknown => ({
      elements: [
        {
          elements: [{ ...(style === undefined ? {} : { style }), text: "the deploy finished", type: "text" }],
          type: leafType,
        },
      ],
      type: "rich_text",
    });
    const correctOver = ({ block }: { block: unknown }) =>
      correctClaim({ correction: "It rolled back.", stored: { blocks: [block] }, wrong: "the deploy finished" });
    const intoCode = {
      elements: [
        {
          elements: [
            { text: "the deploy ", type: "text" },
            { style: { code: true }, text: "finished", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    };
    expect([
      unwrapErr(correctOver({ block: rich({ leafType: "rich_text_preformatted" }) })).code,
      unwrapErr(correctOver({ block: rich({ leafType: "rich_text_section", style: { code: true } }) })).code,
      unwrapErr(correctOver({ block: intoCode })).code,
      unwrap(correctOver({ block: rich({ leafType: "rich_text_section", style: { bold: true } }) })).struckIn,
    ]).toEqual(["CLAIM_UNSTRIKEABLE", "CLAIM_UNSTRIKEABLE", "CLAIM_UNSTRIKEABLE", "rich-text"]);
  });

  it("reads a ``` fence holding a lone backtick as one code span, and one left open as running to the end", () => {
    const refusedOver = ({ text }: { text: string }): string =>
      unwrapErr(
        correctClaim({
          correction: "right.",
          stored: { blocks: [{ text: { text, type: "mrkdwn" }, type: "section" }] },
          wrong: "wrong",
        }),
      ).code;
    expect([
      refusedOver({ text: "```prefix ` wrong```" }),
      refusedOver({ text: "see `x and wrong" }),
      refusedOver({ text: "Status: <https://example.test/run|wrong>" }),
      refusedOver({ text: "<https://example.test/wrong|status> said so" }),
      refusedOver({ text: "See https://example.test/wrong for details" }),
      refusedOver({ text: "it was wrongly done" }),
      refusedOver({ text: "it was ~old and wrong~ then" }),
    ]).toEqual([
      "CLAIM_UNSTRIKEABLE",
      "CLAIM_UNSTRIKEABLE",
      "CLAIM_UNSTRIKEABLE",
      "CLAIM_UNSTRIKEABLE",
      "CLAIM_UNSTRIKEABLE",
      "CLAIM_UNSTRIKEABLE",
      "CLAIM_UNSTRIKEABLE",
    ]);
    const beside = correctClaim({
      correction: "right.",
      stored: { blocks: [{ text: { text: "<https://example.test|run> was wrong", type: "mrkdwn" }, type: "section" }] },
      wrong: "wrong",
    });
    expect(unwrap(beside).struckIn).toBe("mrkdwn");
  });

  it("refuses a claim a notification fallback makes twice while the blocks make it once", () => {
    const section = { text: { text: "bad", type: "mrkdwn" }, type: "section" };
    const over = (message: Parameters<typeof correctClaim>[0]["stored"]): string =>
      unwrapErr(correctClaim({ correction: "good.", stored: message, wrong: "bad" })).code;
    expect([
      over({ blocks: [section], text: "bad; bad" }),
      over({ attachments: [{ blocks: [section], fallback: "bad; bad" }] }),
    ]).toEqual(["CLAIM_UNSTRIKEABLE", "CLAIM_UNSTRIKEABLE"]);
  });

  it("refuses a claim an attachment field also shows beside its blocks, before anything is edited", () => {
    const section = { text: { text: "The deploy finished.", type: "mrkdwn" }, type: "section" };
    const fields = [{ short: true, title: "Status", value: "The deploy finished." }];
    const refused = correctClaim({
      correction: "It rolled back.",
      stored: { attachments: [{ blocks: [section], fields }] },
      wrong: "The deploy finished.",
    });
    expect(unwrapErr(refused).code).toBe("CLAIM_UNSTRIKEABLE");
  });

  it("refuses a claim a notification fallback shows inside a code span, with blocks and without", () => {
    const withBlocks = { blocks: [LEAD], text: "Alert: `4.2.0 is affected`" };
    const wrapped = { attachments: [{ blocks: [LEAD], fallback: "`4.2.0 is affected`" }] };
    expect([
      unwrapErr(correctClaim({ correction: "x.", stored: withBlocks, wrong: "4.2.0 is affected" })).code,
      unwrapErr(correctClaim({ correction: "x.", stored: wrapped, wrong: "4.2.0 is affected" })).code,
      unwrapErr(correctClaim({ correction: "x.", stored: { text: "it is `bad`" }, wrong: "bad" })).code,
      unwrap(correctClaim({ correction: "x.", stored: { text: "`x` is bad" }, wrong: "bad" })).text,
    ]).toEqual(["CLAIM_UNSTRIKEABLE", "CLAIM_UNSTRIKEABLE", "CLAIM_UNSTRIKEABLE", "`x` is ~bad~\n*Correction:* x."]);
  });

  it("refuses a fallback whose unclosed fence or token would swallow the Correction line, and reads one false", () => {
    const section = { text: { text: "bad", type: "mrkdwn" }, type: "section" };
    const correction = "bad was false.";
    const code = (message: Parameters<typeof correctClaim>[0]["stored"]): string =>
      unwrapErr(correctClaim({ correction, stored: message, wrong: "bad" })).code;
    const clean = unwrap(
      correctClaim({ correction, stored: { blocks: [section], text: "notification" }, wrong: "bad" }),
    );
    const read = ({ text }: { text: string }): boolean =>
      claimCorrectedAs({ correction, stored: { blocks: clean.blocks!, text }, wrong: "bad" });
    expect([
      code({ blocks: [section], text: "```notification" }),
      code({ attachments: [{ blocks: [section], fallback: "<notification" }] }),
      read({ text: clean.text }),
      read({ text: `\`\`\`${clean.text}` }),
    ]).toEqual(["CLAIM_UNSTRIKEABLE", "CLAIM_UNSTRIKEABLE", true, false]);
  });

  it("refuses a fallback already carrying a Correction line, and reads two in one fallback false", () => {
    const section = { text: { text: "bad", type: "mrkdwn" }, type: "section" };
    const shown = { blocks: [section], text: "notice\n*Correction:* good." };
    const clean = unwrap(
      correctClaim({ correction: "good.", stored: { blocks: [section], text: "notice" }, wrong: "bad" }),
    );
    expect([
      unwrapErr(correctClaim({ correction: "good.", stored: shown, wrong: "bad" })).code,
      claimCorrectedAs({
        correction: "good.",
        stored: { blocks: clean.blocks!, text: "notice\n*Correction:* good.\n*Correction:* good." },
        wrong: "bad",
      }),
      unwrapErr(
        correctClaim({
          correction: "good.",
          stored: { attachments: [{ fallback: "notice\n*Correction:* other." }], text: "bad" },
          wrong: "bad",
        }),
      ).code,
      claimCorrectedAs({
        correction: "good.",
        stored: { attachments: [{ fallback: "notice\n*Correction:* other." }], text: "~bad~\n*Correction:* good." },
        wrong: "bad",
      }),
      claimCorrectedAs({ correction: "good.", stored: { text: "~bad~\n*Correction:* good." }, wrong: "bad" }),
    ]).toEqual(["CLAIM_UNSTRIKEABLE", false, "CLAIM_UNSTRIKEABLE", false, true]);
  });

  it("leaves a fallback copy already struck as it is, and reads a doubled strike false", () => {
    const section = { text: { text: "bad", type: "mrkdwn" }, type: "section" };
    const corrected = unwrap(
      correctClaim({ correction: "good.", stored: { blocks: [section], text: "~bad~" }, wrong: "bad" }),
    );
    const read = ({ text }: { text: string }): boolean =>
      claimCorrectedAs({ correction: "good.", stored: { blocks: corrected.blocks!, text }, wrong: "bad" });
    const doubledBlocks = [
      { text: { text: "~~bad~~", type: "mrkdwn" }, type: "section" },
      ...corrected.blocks!.slice(1),
    ];
    expect([
      corrected.text,
      read({ text: corrected.text }),
      read({ text: "~~bad~~\n*Correction:* good." }),
      claimCorrectedAs({ correction: "good.", stored: { text: "~~bad~~\n*Correction:* good." }, wrong: "bad" }),
      claimCorrectedAs({ correction: "good.", stored: { blocks: doubledBlocks, text: corrected.text }, wrong: "bad" }),
    ]).toEqual(["~bad~\n*Correction:* good.", true, false, false, false]);
  });

  it("refuses a claim already struck, so a second run changes nothing", () => {
    const once = unwrap(correctClaim({ correction: "4.2.1 is affected.", stored, wrong: "4.2.0 is affected" }));
    const again = correctClaim({
      correction: "4.2.1 is affected.",
      stored: { blocks: once.blocks! },
      wrong: "4.2.0 is affected",
    });
    expect(unwrapErr(again).code).toBe("CLAIM_ALREADY_STRUCK");
  });

  it.each([
    ["", "x.", "--wrong is empty"],
    [" 4.2.0", "x.", "--wrong starts or ends with whitespace"],
    ["bad~oops", "x.", "--wrong carries a ~"],
    ["Deploy finished\ncleanly", "x.", "--wrong spans more than one line"],
    ["A > B", "x.", "--wrong carries &, < or >"],
    ["4.2.0", "  ", "--correction is empty"],
    ["4.2.0", " 4.2.0 ", "--correction repeats --wrong word for word"],
    ["4.2.0", "one\ntwo", "--correction spans more than one line"],
    ["bad", "`bad` was false.", "--correction carries `, ~, * or _"],
    ["bad", "it is *good*.", "--correction carries `, ~, * or _"],
    ["4.2.0", "x".repeat(CORRECTION_MAX_CHARS + 1), "over the 300"],
    ["4.2.0", "see <@U123>", "renders LITERALLY"],
  ])("refuses wrong=%j correction=%j", (wrong, correction, fragment) => {
    const refused = unwrapErr(correctClaim({ correction, stored, wrong }));
    expect(refused.code).toBe("CORRECTION_TEXT_INVALID");
    expect(refused.message).toContain(fragment);
  });
});
