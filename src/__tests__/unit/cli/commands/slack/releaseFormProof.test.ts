/**
 * `releaseHeldRow.ts`'s `releaseFormProofRefusal`: a `--form` typed at release is outside the digest, so the form the
 * release will send is held to the finding proof bar, not only the stored one.
 */
import { describe, expect, it } from "vitest";

import { releaseFormProofRefusal } from "../../../../../cli/commands/slack/releaseHeldRow.js";
import { type ParkedSlackDraft, parkedDraftDigest } from "../../../../../outbound/slack/draftRegister.js";

describe("releaseFormProofRefusal", () => {
  const NONE = '{"kind":"one-card","problem":{"kind":"none"}}';
  const POSSIBLE = '{"kind":"one-card","problem":{"kind":"possible","affects":"many"}}';
  const unproved = {
    advisory: [],
    authorId: "U0SYNADAOWN",
    channel: "C0POOL",
    form: NONE,
    id: "sd-33333333",
    kind: "message" as const,
    mentions: [],
    payload: {
      form: "plain" as const,
      text: "many customers cannot check out.",
      unfurl_links: false,
      unfurl_media: false,
    },
    shape: "top-level" as const,
    tsIso: "2026-10-19T00:00:00.000Z",
    why: "the pool",
  };
  const draft: ParkedSlackDraft = { ...unproved, digest: parkedDraftDigest({ draft: unproved }) };

  it("refuses a release-time form declaring a possible problem the stored row never proved", () => {
    const refusal = releaseFormProofRefusal({ draft, formJson: POSSIBLE })!;
    expect(refusal.code).toBe("DRAFT_NOT_FOUND");
    expect(refusal.message).toContain("sd-33333333");
    expect(refusal.message).toContain("screenshot");
  });

  it("refuses a bot finding form given at release over a row stamped message, its blast radius unmeasured", () => {
    const finding = JSON.stringify({
      blastRadius: { proxy: "120 failed calls", unmeasuredBecause: "no user id" },
      kind: "finding",
    });
    const bot: ParkedSlackDraft = { ...draft, actor: "bot", kind: "message" };
    const refusal = releaseFormProofRefusal({ draft: bot, formJson: finding })!;
    expect(refusal.message).toContain("sd-33333333 raises a finding and is missing screenshot");
    expect(refusal.message).toContain("impact");
  });

  it("lets the same row go under its own form, which raises no finding", () => {
    expect(releaseFormProofRefusal({ draft, formJson: NONE })).toBeUndefined();
  });
});
