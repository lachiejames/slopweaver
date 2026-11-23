/*
 * `claimCorrectedAs`: true only over the exact correction already shown, the claim struck where the message makes it
 * and this Correction line directly under it, so a journalled re-run may record it. It moved here when
 * `claimCorrection.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { claimCorrectedAs, correctClaim } from "../../../../../outbound/slack/claimCorrection.js";
import { CORRECTION_BLOCK, LEAD, LINE, METADATA } from "./harness.js";

describe("claimCorrectedAs — the exact correction already shown, which a journalled re-run may record", () => {
  const original = {
    attachments: [{ blocks: [LEAD, { type: "divider" }], color: "#7c3aed", fallback: "Only 4.2.0 is affected" }],
    metadata: METADATA,
    text: "",
  };
  const wrong = "4.2.0 is affected";
  const landed = unwrap(correctClaim({ correction: "4.2.1 is affected.", stored: original, wrong }));

  it("is true over the message the correction produced, for the same line", () => {
    expect(claimCorrectedAs({ correction: " 4.2.1 is affected. ", stored: landed, wrong })).toBe(true);
  });

  it("is false for a different line under the same strike", () => {
    expect(claimCorrectedAs({ correction: "4.2.2 is affected.", stored: landed, wrong })).toBe(false);
  });

  it("is false over the uncorrected original", () => {
    expect(claimCorrectedAs({ correction: "4.2.1 is affected.", stored: original, wrong })).toBe(false);
  });

  it("is false when the claim is struck with no Correction line under it", () => {
    const struckOnly = { attachments: [{ blocks: [landed.attachments![0]!.blocks![0], { type: "divider" }] }] };
    expect(claimCorrectedAs({ correction: "4.2.1 is affected.", stored: struckOnly, wrong })).toBe(false);
  });

  it("is false when a second, unstruck copy of the claim sits beside the struck one", () => {
    const correction = "It rolled back.";
    const blocks = [
      { text: { text: "The deploy finished. Earlier: ~The deploy finished.~", type: "mrkdwn" }, type: "section" },
      { elements: [{ ...LINE, elements: [LINE.elements[0]!, { text: correction, type: "text" }] }], type: "rich_text" },
    ];
    expect(claimCorrectedAs({ correction, stored: { blocks }, wrong: "The deploy finished." })).toBe(false);
  });

  it("never takes a struck quote inside a Correction line for the claim's own block", () => {
    const correction = "bad is false";
    const section = ({ elements }: { elements: readonly unknown[] }): unknown => ({
      elements: [{ elements, type: "rich_text_section" }],
      type: "rich_text",
    });
    const label = { style: { bold: true }, text: "Correction: ", type: "text" };
    const struckQuote = [
      label,
      { style: { strike: true }, text: "bad", type: "text" },
      { text: " is false", type: "text" },
    ];
    const blocks = [
      section({ elements: [{ text: "it is bad", type: "text" }] }),
      section({ elements: struckQuote }),
      section({ elements: [label, { text: correction, type: "text" }] }),
    ];
    expect(claimCorrectedAs({ correction, stored: { blocks }, wrong: "bad" })).toBe(false);
  });

  it("is false while a field no strike can reach still shows the claim, and a labelled link's URL is not one", () => {
    const header = { text: { text: "4.2.0 is affected", type: "plain_text" }, type: "header" };
    const image = { elements: [{ alt_text: "status: 4.2.0 is affected", type: "image" }], type: "context" };
    const inSection = (element: Record<string, unknown>): unknown => ({
      elements: [{ elements: [element], type: "rich_text_section" }],
      type: "rich_text",
    });
    const date = inSection({ fallback: "4.2.0 is affected", format: "{date}", timestamp: 1, type: "date" });
    const bareLink = inSection({ type: "link", url: "https://example.com/4.2.0 is affected" });
    const emptyLabel = inSection({ text: "", type: "link", url: "https://example.com/4.2.0 is affected" });
    const labelledLink = inSection({ text: "notes", type: "link", url: "https://example.com/4.2.0 is affected" });
    const blocks = landed.attachments![0]!.blocks!;
    const correctedWith = ({ extra }: { extra: readonly unknown[] }): boolean =>
      claimCorrectedAs({
        correction: "4.2.1 is affected.",
        stored: { blocks: [...blocks, ...extra], text: landed.text },
        wrong,
      });
    expect([
      correctedWith({ extra: [] }),
      correctedWith({ extra: [header] }),
      correctedWith({ extra: [image] }),
      correctedWith({ extra: [date] }),
      correctedWith({ extra: [bareLink] }),
      correctedWith({ extra: [emptyLabel] }),
      correctedWith({ extra: [labelledLink] }),
    ]).toEqual([true, false, false, false, false, false, true]);
  });

  it("is false while a notification fallback still shows the claim unstruck", () => {
    const reverted = { ...landed, text: "Only 4.2.0 is affected" };
    const fallbackReverted = {
      ...landed,
      attachments: [{ ...landed.attachments![0]!, fallback: "Only 4.2.0 is affected" }],
    };
    expect([
      claimCorrectedAs({ correction: "4.2.1 is affected.", stored: reverted, wrong }),
      claimCorrectedAs({ correction: "4.2.1 is affected.", stored: fallbackReverted, wrong }),
    ]).toEqual([false, false]);
  });

  it("is false while a notification fallback is struck but lacks this Correction line", () => {
    const struckOnly = "Only ~4.2.0 is affected~";
    const withText = ({ text }: { text: string }): typeof landed => ({ ...landed, text });
    const fallbackStruckOnly = {
      ...landed,
      attachments: [{ ...landed.attachments![0]!, fallback: struckOnly }],
    };
    expect([
      claimCorrectedAs({ correction: "4.2.1 is affected.", stored: withText({ text: struckOnly }), wrong }),
      claimCorrectedAs({ correction: "4.2.1 is affected.", stored: fallbackStruckOnly, wrong }),
      claimCorrectedAs({ correction: "4.2.1 is affected.", stored: withText({ text: "" }), wrong }),
      claimCorrectedAs({
        correction: "4.2.1 is affected.",
        stored: { ...landed, attachments: [{ ...landed.attachments![0]!, pretext: "Only 4.2.0 is affected" }] },
        wrong,
      }),
    ]).toEqual([false, false, false, false]);
  });

  it("on a block-less message, refuses and never reads as landed while an attachment fallback makes the claim", () => {
    const text = "It was ~10 failed~\n*Correction:* It was 20 failed.";
    const correction = "It was 20 failed.";
    const read = ({ fallback }: { fallback: string }): boolean =>
      claimCorrectedAs({ correction, stored: { attachments: [{ fallback }], text }, wrong: "10 failed" });
    const legacyText = claimCorrectedAs({
      correction,
      stored: { attachments: [{ fallback: "a file", text: "It was 10 failed" }], text },
      wrong: "10 failed",
    });
    expect([
      read({ fallback: "It was 10 failed" }),
      read({ fallback: "a file" }),
      legacyText,
      unwrapErr(
        correctClaim({
          correction,
          stored: { attachments: [{ fallback: "It was 10 failed" }], text: "It was 10 failed" },
          wrong: "10 failed",
        }),
      ).code,
    ]).toEqual([false, true, false, "CLAIM_UNSTRIKEABLE"]);
  });

  it("is false while a notification fallback shows the claim inside a code span, struck or not", () => {
    const inCode = ({ text }: { text: string }): typeof landed => ({ ...landed, text });
    expect([
      claimCorrectedAs({ correction: "4.2.1 is affected.", stored: inCode({ text: landed.text }), wrong }),
      claimCorrectedAs({ correction: "4.2.1 is affected.", stored: inCode({ text: "`~4.2.0 is affected~`" }), wrong }),
      claimCorrectedAs({ correction: "4.2.1 is affected.", stored: inCode({ text: "`4.2.0 is affected`" }), wrong }),
    ]).toEqual([true, false, false]);
  });

  it("is true when the Correction line itself quotes the claim, in the blocks and in the fallback text", () => {
    const correction = "4.2.0 is affected was wrong, 4.2.1 is.";
    const quoting = unwrap(
      correctClaim({ correction, stored: { ...original, text: "Only 4.2.0 is affected" }, wrong }),
    );
    expect([quoting.text, claimCorrectedAs({ correction, stored: quoting, wrong })]).toEqual([
      "Only ~4.2.0 is affected~\n*Correction:* 4.2.0 is affected was wrong, 4.2.1 is.",
      true,
    ]);
  });

  it("takes only the Correction line it writes, bar a block_id, never the same words in other markup", () => {
    const correction = "bad was wrong; good.";
    const rich = ({ elements }: { elements: readonly unknown[] }): Record<string, unknown> => ({
      elements: [{ elements, type: "rich_text_section" }],
      type: "rich_text",
    });
    const label = { style: { bold: true }, text: "Correction: ", type: "text" };
    const read = (line: Record<string, unknown>): boolean =>
      claimCorrectedAs({
        correction,
        stored: {
          blocks: [rich({ elements: [{ style: { strike: true }, text: "bad", type: "text" }] }), line],
          text: `Correction: ${correction}`,
        },
        wrong: "bad",
      });
    const linked = [
      label,
      { text: "bad", type: "link", url: "https://example.test/proof" },
      { text: " was wrong; good.", type: "text" },
    ];
    expect([
      read({ ...rich({ elements: [label, { text: correction, type: "text" }] }), block_id: "Xy1" }),
      read(rich({ elements: [label, { style: { italic: true }, text: correction, type: "text" }] })),
      read(rich({ elements: [label, { style: { code: true }, text: correction, type: "text" }] })),
      read(rich({ elements: linked })),
    ]).toEqual([true, false, false, false]);
  });

  it("is false when the Correction line shows twice, one of them away from the strike", () => {
    const correction = "4.2.1 is affected.";
    const blocks = landed.attachments![0]!.blocks!;
    expect([
      claimCorrectedAs({ correction, stored: { blocks, text: landed.text }, wrong }),
      claimCorrectedAs({ correction, stored: { blocks: [CORRECTION_BLOCK, ...blocks], text: landed.text }, wrong }),
    ]).toEqual([true, false]);
  });

  it("refuses, and reads false, a Correction label in other markup: a mrkdwn section or an attachment field", () => {
    const section = { text: { text: "bad", type: "mrkdwn" }, type: "section" };
    const mrkdwnLine = { text: { text: "*Correction:* good.", type: "mrkdwn" }, type: "section" };
    const field = { attachments: [{ fields: [{ title: "Correction:", value: "good." }] }] };
    const clean = unwrap(
      correctClaim({ correction: "good.", stored: { blocks: [section], text: "notice" }, wrong: "bad" }),
    );
    const refusal = (stored: Parameters<typeof correctClaim>[0]["stored"]): string =>
      unwrapErr(correctClaim({ correction: "good.", stored, wrong: "bad" })).code;
    const read = (stored: Parameters<typeof claimCorrectedAs>[0]["stored"]): boolean =>
      claimCorrectedAs({ correction: "good.", stored, wrong: "bad" });
    expect([
      refusal({ blocks: [section, mrkdwnLine], text: "notice" }),
      refusal({ ...field, blocks: [section], text: "notice" }),
      refusal({ ...field, text: "bad" }),
      read({ blocks: [...clean.blocks!, mrkdwnLine], text: clean.text }),
      read({ ...field, blocks: clean.blocks!, text: clean.text }),
      read({ ...field, text: "~bad~\n*Correction:* good." }),
    ]).toEqual(["CLAIM_UNSTRIKEABLE", "CLAIM_UNSTRIKEABLE", "CLAIM_UNSTRIKEABLE", false, false, false]);
  });

  it("reads a block-less message's text, for the same line only", () => {
    const plain = unwrap(
      correctClaim({ correction: "it is 30.", stored: { text: "it is 10 today" }, wrong: "it is 10" }),
    );
    expect([
      claimCorrectedAs({ correction: "it is 30.", stored: { text: plain.text }, wrong: "it is 10" }),
      claimCorrectedAs({ correction: "it is 40.", stored: { text: plain.text }, wrong: "it is 10" }),
      claimCorrectedAs({ correction: "good.", stored: { text: "`~bad~`\n*Correction:* good." }, wrong: "bad" }),
      claimCorrectedAs({ correction: "good.", stored: { text: "x~bad~\n*Correction:* good." }, wrong: "bad" }),
      claimCorrectedAs({ correction: "good.", stored: { text: "(~bad~)\n*Correction:* good." }, wrong: "bad" }),
    ]).toEqual([true, false, false, false, true]);
  });

  it("takes a letter outside the BMP touching the claim as part of the word, before the edit and on read-back", () => {
    const astral = { blocks: [{ text: { text: "𐐀bad", type: "mrkdwn" }, type: "section" }], text: "" };
    expect([
      unwrapErr(correctClaim({ correction: "good.", stored: astral, wrong: "bad" })).code,
      unwrapErr(correctClaim({ correction: "good.", stored: { text: "bad𐐀" }, wrong: "bad" })).code,
      claimCorrectedAs({ correction: "good.", stored: { text: "𐐀~bad~\n*Correction:* good." }, wrong: "bad" }),
    ]).toEqual(["CLAIM_UNSTRIKEABLE", "CLAIM_UNSTRIKEABLE", false]);
  });

  it("refuses a claim whose line holds a lone ~ Slack would pair with one of its edges, and reads one false", () => {
    const lone = { blocks: [{ text: { text: "~old bad", type: "mrkdwn" }, type: "section" }], text: "" };
    const plain = { text: { text: "bad", type: "mrkdwn" }, type: "section" };
    const corrected = unwrap(
      correctClaim({ correction: "good.", stored: { blocks: [plain], text: "x" }, wrong: "bad" }),
    );
    const misPaired = [
      { text: { text: "~old ~bad~", type: "mrkdwn" }, type: "section" },
      ...corrected.blocks!.slice(1),
    ];
    expect([
      unwrapErr(correctClaim({ correction: "good.", stored: lone, wrong: "bad" })).code,
      unwrapErr(correctClaim({ correction: "good.", stored: { text: "about ~5, bad" }, wrong: "bad" })).code,
      unwrap(correctClaim({ correction: "good.", stored: { text: "about ~5\nbad" }, wrong: "bad" })).text,
      claimCorrectedAs({ correction: "good.", stored: { blocks: misPaired, text: "x" }, wrong: "bad" }),
      claimCorrectedAs({ correction: "good.", stored: { text: "~old ~bad~\n*Correction:* good." }, wrong: "bad" }),
    ]).toEqual(["CLAIM_UNSTRIKEABLE", "CLAIM_UNSTRIKEABLE", "about ~5\n~bad~\n*Correction:* good.", false, false]);
  });
});
