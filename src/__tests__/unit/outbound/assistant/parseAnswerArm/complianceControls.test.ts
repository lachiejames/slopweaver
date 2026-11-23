/*
 * `parseAnswerArm` under the compliance-control ruling, end to end: a bare compliance control id is linked or refused
 * by name, a linked one owes a citation in its own item, and three things shown with no picture are held
 * until `noPictureBecause` or a screenshot answers. It moved here when `parseAnswerArm.test.ts` was split by
 * behaviour.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";
import { parseAnswerArm } from "../../../../../outbound/assistant/answerForm.js";
import type { BareRefContext } from "../../../../../outbound/linkify/bareRefs.js";

describe("parseAnswerArm — the compliance-control ruling, end to end", () => {
  const HRS_52 = "https://app.vanta.com/c/acme/controls?controlId=0syn0002";
  const DCH_108 = "https://app.vanta.com/c/acme/controls?controlId=0syn0001";
  const BCD_69 = "https://app.vanta.com/c/acme/controls?controlId=0syn0003";
  const CONTROLS: BareRefContext = {
    complianceControls: [
      { id: "HRS-52", url: HRS_52 },
      { id: "DCH-108", url: DCH_108 },
      { id: "BCD-69", url: BCD_69 },
    ],
    repos: [],
  };
  const NO_URLS: BareRefContext = {
    complianceControls: [{ id: "HRS-52", url: null }],
    repos: [],
  };
  const CLEAN_ENV: Readonly<Record<string, string | undefined>> = {};

  /** One `answer` arm carrying whatever body, citations and images a case needs. */
  function controlAnswer({
    body,
    citations,
    images,
    noPictureBecause,
  }: {
    body: readonly unknown[];
    citations: readonly unknown[];
    images: readonly string[];
    noPictureBecause?: string;
  }): unknown {
    return {
      ...(noPictureBecause === undefined ? {} : { noPictureBecause }),
      body,
      citations,
      grounding: {
        evidence: {
          consultedEmpty: [],
          couldNotSee: { blindSpots: [], reason: "no live check needed" },
          premiseChecks: [],
          read: [],
        },
        kind: "conversation",
        provenance: { model: "claude-opus-5", skillsLoaded: [], verbsLoaded: [] },
        reason: "context and judgement alone were sufficient",
      },
      images,
      index: [],
      kind: "answer",
      lead: "the closest ISO controls",
    };
  }

  it("REFUSES a bare control id BY NAME when no url can be built for it", () => {
    const result = parseAnswerArm({
      context: NO_URLS,
      env: CLEAN_ENV,
      raw: controlAnswer({
        body: [{ runs: [{ text: "HRS-52 is one test away", type: "text" }], type: "paragraph" }],
        citations: [],
        images: [],
      }),
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain('"HRS-52" is a compliance control written as plain text');
  });

  it("turns a bare control id into a real link when the atlas knows where it lives", () => {
    const answer = unwrap(
      parseAnswerArm({
        context: CONTROLS,
        env: CLEAN_ENV,
        raw: controlAnswer({
          body: [
            {
              runs: [
                { text: "HRS-52 is one test away", type: "text" },
                { citationId: "c1", type: "citation" },
              ],
              type: "paragraph",
            },
          ],
          citations: [{ id: "c1", label: "[1]", url: HRS_52 }],
          images: [],
        }),
      }),
    );
    expect(answer.body).toEqual([
      {
        runs: [
          { label: "HRS-52", type: "link", url: HRS_52 },
          { text: " is one test away", type: "text" },
          { citationId: "c1", type: "citation" },
        ],
        type: "paragraph",
      },
    ]);
  });

  it("REFUSES a linked control that no citation in its own item names", () => {
    const result = parseAnswerArm({
      context: CONTROLS,
      env: CLEAN_ENV,
      raw: controlAnswer({
        body: [{ runs: [{ text: "HRS-52 is one test away", type: "text" }], type: "paragraph" }],
        citations: [],
        images: [],
      }),
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("no citation saying which control it is");
  });

  it("HOLDS three things shown with no picture on the one question, listing what it counted", () => {
    const result = parseAnswerArm({
      context: CONTROLS,
      env: CLEAN_ENV,
      raw: controlAnswer({
        body: [
          {
            runs: [
              { text: "HRS-52", type: "text" },
              { citationId: "c1", type: "citation" },
              { text: " DCH-108", type: "text" },
              { citationId: "c2", type: "citation" },
              { text: " BCD-69", type: "text" },
              { citationId: "c3", type: "citation" },
            ],
            type: "paragraph",
          },
        ],
        citations: [
          { id: "c1", label: "[1]", url: HRS_52 },
          { id: "c2", label: "[2]", url: DCH_108 },
          { id: "c3", label: "[3]", url: BCD_69 },
        ],
        images: [],
      }),
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain(
      "images: this message names 3 different things (HRS-52, DCH-108, BCD-69) and attaches no picture: which " +
        "of these would a picture show better than text?",
    );
  });

  it("admits the same answer once noPictureBecause says why none adds value, and keeps the reason", () => {
    const answer = unwrap(
      parseAnswerArm({
        context: CONTROLS,
        env: CLEAN_ENV,
        raw: controlAnswer({
          body: [
            {
              runs: [
                { text: "HRS-52", type: "text" },
                { citationId: "c1", type: "citation" },
                { text: " DCH-108", type: "text" },
                { citationId: "c2", type: "citation" },
                { text: " BCD-69", type: "text" },
                { citationId: "c3", type: "citation" },
              ],
              type: "paragraph",
            },
          ],
          citations: [
            { id: "c1", label: "[1]", url: HRS_52 },
            { id: "c2", label: "[2]", url: DCH_108 },
            { id: "c3", label: "[3]", url: BCD_69 },
          ],
          images: [],
          noPictureBecause: "  each control page shows the same empty test list the text already names  ",
        }),
      }),
    );
    expect(answer.noPictureBecause).toBe("each control page shows the same empty test list the text already names");
  });

  it("REFUSES noPictureBecause on an answer that already attaches a picture", () => {
    const errors = parseAnswerArm({
      context: CONTROLS,
      env: CLEAN_ENV,
      raw: controlAnswer({
        body: [
          {
            runs: [
              { text: "HRS-52", type: "text" },
              { citationId: "c1", type: "citation" },
              { text: " DCH-108", type: "text" },
              { citationId: "c2", type: "citation" },
              { text: " BCD-69", type: "text" },
              { citationId: "c3", type: "citation" },
            ],
            type: "paragraph",
          },
        ],
        citations: [
          { id: "c1", label: "[1]", url: HRS_52 },
          { id: "c2", label: "[2]", url: DCH_108 },
          { id: "c3", label: "[3]", url: BCD_69 },
        ],
        images: ["/tmp/controls.png"],
        noPictureBecause: "none adds value",
      }),
    })._unsafeUnwrapErr();
    expect(errors).toEqual([
      "noPictureBecause: `noPictureBecause` on the answer form answers a question this message was not " +
        "asked — it already attaches a picture — so there is nothing to record. Remove it.",
    ]);
  });

  it("accepts the same answer once a screenshot is attached", () => {
    const answer = unwrap(
      parseAnswerArm({
        context: CONTROLS,
        env: CLEAN_ENV,
        raw: controlAnswer({
          body: [
            {
              runs: [
                { text: "HRS-52", type: "text" },
                { citationId: "c1", type: "citation" },
                { text: " DCH-108", type: "text" },
                { citationId: "c2", type: "citation" },
                { text: " BCD-69", type: "text" },
                { citationId: "c3", type: "citation" },
              ],
              type: "paragraph",
            },
          ],
          citations: [
            { id: "c1", label: "[1]", url: HRS_52 },
            { id: "c2", label: "[2]", url: DCH_108 },
            { id: "c3", label: "[3]", url: BCD_69 },
          ],
          images: ["/tmp/controls.png"],
        }),
      }),
    );
    expect(answer.images).toEqual(["/tmp/controls.png"]);
  });

  it("reports both new refusals together rather than one at a time", () => {
    const errors = parseAnswerArm({
      context: CONTROLS,
      env: CLEAN_ENV,
      raw: controlAnswer({
        body: [{ runs: [{ text: "HRS-52, DCH-108 and BCD-69 are close", type: "text" }], type: "paragraph" }],
        citations: [],
        images: [],
      }),
    })._unsafeUnwrapErr();
    expect(errors.length).toBe(4);
    expect(errors.filter((line) => line.includes("slopweaver hatch open uncited-controls")).length).toBe(3);
    expect(errors.filter((line) => line.includes("which of these would a picture show better")).length).toBe(1);
  });

  it("answering the picture question leaves the citation gate biting", () => {
    const errors = parseAnswerArm({
      context: CONTROLS,
      env: CLEAN_ENV,
      raw: controlAnswer({
        body: [{ runs: [{ text: "HRS-52, DCH-108 and BCD-69 are close", type: "text" }], type: "paragraph" }],
        citations: [],
        images: [],
        noPictureBecause: "the controls have no page a browser can reach",
      }),
    })._unsafeUnwrapErr();
    expect(errors.length).toBe(3);
    expect(errors.filter((line) => line.includes("slopweaver hatch open uncited-controls")).length).toBe(3);
  });

  it("leaves an answer naming no reference at all completely untouched", () => {
    const answer = unwrap(
      parseAnswerArm({
        context: CONTROLS,
        env: CLEAN_ENV,
        raw: controlAnswer({
          body: [{ runs: [{ text: "the pool exhausted at 09:12", type: "text" }], type: "paragraph" }],
          citations: [],
          images: [],
        }),
      }),
    );
    expect(answer.body).toEqual([{ runs: [{ text: "the pool exhausted at 09:12", type: "text" }], type: "paragraph" }]);
  });
});
