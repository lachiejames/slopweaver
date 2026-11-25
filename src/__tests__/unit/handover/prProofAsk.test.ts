/**
 * The owner's proof asks, and whether a body carries them — a fixture table each way, so the lexical rule is falsifiable.
 */
import { describe, expect, it } from "vitest";
import { PROOF_KIND_WORDS, PROOF_KINDS } from "../../../handover/proofKinds.js";
import { proofAskOf, proofCarriedBy, proofMissing } from "../../../handover/prProofAsk.js";

/** A synthetic proof ask on an acme-admin pull request, shaped as a row stores one. */
const MEASURED_ASK =
  "[Image #12] the diff on https://github.com/acme/acme-admin/pull/17564 is close, but it needs before and after proof: screenshots, plus links to the CI runs in github, and it should carry links and screenshots from datadog CI, where the Acme test logs are";

describe("proofAskOf", () => {
  it("reads a long ask as asking for an image, a run link and a Datadog link", () => {
    expect(proofAskOf({ words: MEASURED_ASK })).toEqual({ kind: "asked", kinds: ["image", "run-link", "datadog"] });
  });

  it.each([
    ["carry PROOF that the lifted logger works in both places", []],
    ["I need a screenshot of the CI run", ["image"]],
    ["can you show me the before-and-after", ["image"]],
    ["please include a run link", ["run-link"]],
    ["it should carry Datadog links for the flaky job", ["datadog"]],
  ])("reads %j as an ask", (words, kinds) => {
    expect(proofAskOf({ words })).toEqual({ kind: "asked", kinds });
  });

  it.each([
    "the proof looks good",
    "the screenshot in the body is not rendered",
    "Datadog is where CI failures are read",
    "we should not be buying Datadog when we have many other priorities",
    "On acme/app#7, I do not need screenshots",
    "no need for screenshots on this one",
    "I do not at all need screenshots",
    "i don't really want a run link here",
    "it should hold the acme recordings but the vendor hasn't shared the videos",
    "That would give me a lot of confidence",
    "I want it merged. The screenshot is fine",
    "[Image #47] need to do a pass over all open acme PRs to merge the mergable [Image #48]",
    '<pasted_content id="f7d9"> I need a screenshot of the console </pasted_content id="f7d9"> perfect, send',
    "",
  ])("reads %j as no ask", (words) => {
    expect(proofAskOf({ words })).toEqual({ kind: "none" });
  });

  it("does not let a request reach an evidence noun past its reach", () => {
    const words = `I want ${"and then some more words ".repeat(5)}screenshots`;
    expect(proofAskOf({ words })).toEqual({ kind: "none" });
  });
});

describe("proofCarriedBy", () => {
  it("finds an embedded image, an Actions run link and a Datadog link", () => {
    const body = [
      "![before](https://github.com/user-attachments/assets/abc)",
      "https://github.com/acme/acme-admin/actions/runs/123456789",
      "https://app.datadoghq.com/ci/test-runs?query=x",
    ].join("\n");
    expect(proofCarriedBy({ body })).toEqual(["image", "run-link", "datadog"]);
  });

  it("reads an HTML img as an image, its src quoted or not", () => {
    expect(proofCarriedBy({ body: '<img width="600" src="https://github.com/user-attachments/assets/x" />' })).toEqual([
      "image",
    ]);
    expect(proofCarriedBy({ body: "<img src=https://github.com/user-attachments/assets/abc>" })).toEqual(["image"]);
    expect(proofCarriedBy({ body: '<img src = "https://github.com/user-attachments/assets/abc">' })).toEqual(["image"]);
    expect(proofCarriedBy({ body: "<img src=https://img.shields.io/badge/proof-gold-green>" })).toEqual([]);
  });

  it("reads a reference-style image through its definition, and an attachment URL alone on its line", () => {
    const bodies = [
      "![before][proof]\n\n[proof]: https://github.com/user-attachments/assets/abc",
      "![after][]\n\n[After]: <https://github.com/user-attachments/assets/def>",
      "![shot]\n\n[shot]: https://example.com/shot.png",
      "Before:\n  https://github.com/user-attachments/assets/1f2e3d4c-aaaa-bbbb-cccc-000000000000  \nAfter:",
    ];
    expect(bodies.map((body) => proofCarriedBy({ body }))).toEqual([["image"], ["image"], ["image"], ["image"]]);
  });

  it("carries no image for a reference with no definition, a badge definition, or an attachment URL inside prose", () => {
    const bodies = [
      "![before][missing]",
      "![proof][badge]\n\n[badge]: https://img.shields.io/badge/proof-gold-green",
      "the recording is at https://github.com/user-attachments/assets/abc if you want it",
    ];
    expect(bodies.map((body) => proofCarriedBy({ body }))).toEqual([[], [], []]);
  });

  it("carries nothing for a badge, the word Datadog and a link to the pull request itself", () => {
    const body = [
      "![proof: bronze](https://img.shields.io/badge/proof-bronze-orange)",
      "Read the failures in Datadog.",
      "https://github.com/acme/acme-admin/pull/17564",
    ].join("\n");
    expect(proofCarriedBy({ body })).toEqual([]);
  });
});

describe("proofMissing", () => {
  it("names each asked kind the body lacks", () => {
    expect(proofMissing({ asked: ["image", "run-link", "datadog"], carried: ["image"] })).toEqual([
      "run-link",
      "datadog",
    ]);
  });

  it("meets a kindless ask with any one kind", () => {
    expect(proofMissing({ asked: [], carried: ["run-link"] })).toEqual([]);
  });

  it("misses every kind on a kindless ask over a body carrying none", () => {
    expect(proofMissing({ asked: [], carried: [] })).toEqual(["image", "run-link", "datadog"]);
  });

  it("names every kind it can miss, in the order a gap names them", () => {
    expect(PROOF_KINDS.map((kind) => PROOF_KIND_WORDS[kind])).toEqual([
      "screenshot",
      "Actions run link",
      "Datadog link",
    ]);
  });
});
