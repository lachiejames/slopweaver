/**
 * `candidateFindingProof.ts`: Codex's draft beside a held row owes the finding proof a pick would carry onto the row,
 * and a ready one that lacks it lists as refused, so the Queue never offers it.
 */
import { describe, expect, it } from "vitest";

import { candidateFindingProofMissing, listedComparison } from "../../../../outbound/slack/candidateFindingProof.js";
import type { SlackDraftComparison } from "../../../../outbound/slack/draftComparison.js";
import type { SlackDraftItem } from "../../../../outbound/slack/draftRegister.js";
import type { SlackDripMessagePayload } from "../../../../outbound/slack/types.js";
import { draftItem } from "../../supervisor/draftItemFixture.js";

const ID = "sd-5e6f7a8b";
const POSSIBLE = '{"kind":"one-card","problem":{"kind":"possible","affects":"many"}}';
const NONE = '{"kind":"one-card","problem":{"kind":"none"}}';
const PAYLOAD: SlackDripMessagePayload = {
  form: "plain",
  text: "12 users cannot check out <https://example.test/evidence|evidence>",
  unfurl_links: false,
  unfurl_media: false,
};
const ORIGINAL = { ...draftItem({ id: ID, tsIso: "2026-10-19T00:00:00.000Z" }).draft, kind: "message" as const };
const PROVED = { ...ORIGINAL, impact: "12 users cannot check out", media: [{ bytes: 1, name: "a.png", sha256: "d" }] };

/** A ready comparison whose Codex draft carries `form`. */
function readyWith({ form }: { form: string }): SlackDraftComparison {
  return {
    atIso: "2026-10-19T00:01:00.000Z",
    candidate: { advisory: [], digest: "d", form, mentions: [], payload: PAYLOAD },
    elapsedMs: 1,
    requestedModel: "gpt-test",
    state: "ready",
  };
}

/** A held row carrying `comparison` over `draft`. */
function held({ comparison, draft }: { comparison: SlackDraftComparison; draft: typeof ORIGINAL }): SlackDraftItem {
  return { ...draftItem({ id: ID, tsIso: "2026-10-19T00:00:00.000Z" }), comparison, draft };
}

describe("candidateFindingProofMissing", () => {
  it("owes the proof only when the candidate's form raises a finding the row cannot prove", () => {
    expect([
      candidateFindingProofMissing({ candidate: { form: POSSIBLE, payload: PAYLOAD }, draft: ORIGINAL }),
      candidateFindingProofMissing({ candidate: { form: POSSIBLE, payload: PAYLOAD }, draft: PROVED }),
      candidateFindingProofMissing({ candidate: { form: NONE, payload: PAYLOAD }, draft: ORIGINAL }),
    ]).toEqual([["screenshot", "impact"], [], []]);
  });
});

describe("listedComparison", () => {
  it("lists an unproved ready Codex finding as refused at admission, and leaves a proved one ready", () => {
    const unproved = listedComparison({ item: held({ comparison: readyWith({ form: POSSIBLE }), draft: ORIGINAL }) })!;
    const proved = listedComparison({ item: held({ comparison: readyWith({ form: POSSIBLE }), draft: PROVED }) })!;
    expect([unproved.state, proved.state]).toEqual(["refused", "ready"]);
    expect(unproved).toMatchObject({ atIso: "2026-10-19T00:01:00.000Z", stage: "admission" });
  });

  it("leaves a row already picked as it is: the pick's own words are judged as the row", () => {
    const picked = {
      ...held({ comparison: readyWith({ form: POSSIBLE }), draft: ORIGINAL }),
      pick: { atIso: "2026-10-19T00:02:00.000Z", model: "gpt-test", variant: "codex" as const },
    };
    expect(listedComparison({ item: picked })!.state).toBe("ready");
  });
});
