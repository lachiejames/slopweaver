import { describe, expect, it } from "vitest";

import {
  dirtyProofRefusal,
  needsRenderProof,
  unconfiguredProofRefusal,
  unprovableRefusal,
} from "../../../../outbound/slack/renderProof.js";

const HATCH_OPEN = 'slopweaver hatch open unproven-render --reason "<why this one is a legitimate exception>"';

const RAW_PUBLIC = {
  allowUnproven: false,
  proofChannel: "D0PROOF",
  rawBody: true,
  shape: "top-level",
  surface: "public-channel",
} as const;

describe("needsRenderProof", () => {
  it("is true for a raw body posted top-level into a public channel — the lane with no other control", () => {
    expect(needsRenderProof(RAW_PUBLIC)).toBe(true);
  });

  it("treats an unestablished surface as public, matching the one-card gate's own fail-closed choice", () => {
    expect(needsRenderProof({ ...RAW_PUBLIC, surface: undefined })).toBe(true);
  });

  it("is false for a FORM send, which is already checked before the wire from its own blocks", () => {
    expect(needsRenderProof({ ...RAW_PUBLIC, rawBody: false })).toBe(false);
  });

  it("is false in a thread, which is not the public top-level shape the ruling is about", () => {
    expect(needsRenderProof({ ...RAW_PUBLIC, shape: "thread" })).toBe(false);
  });

  it("is false in a DM and in a private channel, neither being a very public place", () => {
    expect(needsRenderProof({ ...RAW_PUBLIC, surface: "direct-message" })).toBe(false);
    expect(needsRenderProof({ ...RAW_PUBLIC, surface: "private-channel" })).toBe(false);
  });

  it("is false under the named override, which is the whole point of having one", () => {
    expect(needsRenderProof({ ...RAW_PUBLIC, allowUnproven: true })).toBe(false);
  });

  it("is TRUE with no proof channel configured, so the absence refuses rather than skipping", () => {
    expect(needsRenderProof({ ...RAW_PUBLIC, proofChannel: undefined })).toBe(true);
  });
});

describe("the three refusals all carry a key", () => {
  it("names both remedies when nothing is configured — the field, and the single-run override", () => {
    const refusal = unconfiguredProofRefusal()[0]!;

    expect(refusal).toContain("slackMe.renderProofChannel");
    expect(refusal).toContain(HATCH_OPEN);
  });

  it("carries the real cause forward when the round trip could not complete", () => {
    const refusal = unprovableRefusal({ reason: "not_in_channel" })[0]!;

    expect(refusal).toContain("not_in_channel");
    expect(refusal).toContain("Nothing was posted to the target channel");
    expect(refusal).toContain(HATCH_OPEN);
  });

  it("reports every issue a dirty proof found, then the key, on its own line", () => {
    const refusals = dirtyProofRefusal({ issues: ["first thing wrong", "second thing wrong"] });

    expect(refusals.length).toBe(3);
    expect(refusals[0]!).toContain("first thing wrong");
    expect(refusals[1]!).toContain("second thing wrong");
    expect(refusals[2]!).toContain(HATCH_OPEN);
    expect(refusals[2]!).not.toContain("SLOPWEAVER_ALLOW_UNPROVEN_RENDER");
  });

  it("says a dirty proof was caught BEFORE anything went public, which is the value being claimed", () => {
    expect(dirtyProofRefusal({ issues: ["x"] })[0]!).toContain("before anything went public");
  });
});
