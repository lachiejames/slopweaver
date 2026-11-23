import { describe, expect, it } from "vitest";
import { SlackLifecycleErrors } from "../../../../../../cli/commands/slack/lifecycleErrors.js";
import { rowMovedBeforeSend } from "../../../../../../cli/commands/slack/releaseRow.js";
import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  slackDraftEventLine,
} from "../../../../../../outbound/slack/draftRegister.js";
import type { SlackDripMessagePayload } from "../../../../../../outbound/slack/types.js";
import { FORM, heldRow, logOf } from "./fixtures.js";

describe("rowMovedBeforeSend", () => {
  const owing: ParkedSlackDraft = { ...heldRow(), comparison: { state: "pending" } };
  /** Its first pass found no seat, so A was releasable when the release resolved it, and a retry may still land. */
  const capped = slackDraftEventLine({
    event: {
      id: owing.id,
      kind: "compared",
      outcome: { reason: "capped", state: "unavailable" },
      tsIso: "2026-09-23T12:00:30.000Z",
    },
  });
  const resolved = (): readonly string[] => [...logOf({ row: owing }), capped];
  const payload: SlackDripMessagePayload = {
    blocks: [{ elements: [{ elements: [{ text: "B", type: "text" }], type: "rich_text_section" }], type: "rich_text" }],
    form: "rich",
    text: "B",
    unfurl_links: true,
    unfurl_media: true,
  };
  // The digest B's own words mint under the row's identity: the fold refuses a candidate carrying any other.
  const { authorId, channel, priorAsk, threadTs } = owing;
  const digest = parkedDraftDigest({ draft: { authorId, channel, mentions: [], payload, priorAsk, threadTs } });
  const candidate = { advisory: [], digest, form: FORM, mentions: [], payload };
  const at = "2026-09-23T12:01:00.000Z";
  const compared = slackDraftEventLine({
    event: {
      id: owing.id,
      kind: "compared",
      outcome: { candidate, elapsedMs: 1, requestedModel: "gpt-test", state: "ready" },
      tsIso: at,
    },
  });
  const pickedCodex = slackDraftEventLine({ event: { id: owing.id, kind: "picked", tsIso: at, variant: "codex" } });
  const home = "/h";

  it("lets the send go when the row still says what the owner's yes named", () => {
    const deps = { doorEnv: () => ({}), readDraftLog: resolved };
    expect(rowMovedBeforeSend({ deps, draft: owing, home })).toBeUndefined();
  });

  it("refuses when Codex's draft landed during the gates and is still unpicked", () => {
    const deps = { doorEnv: () => ({}), readDraftLog: () => [...resolved(), compared] };
    expect(rowMovedBeforeSend({ deps, draft: owing, home })!.code).toBe("DRAFT_PICK_OWED");
  });

  it("refuses when the owner picked Codex's draft during the gates, so A is never sent under a row that says B", () => {
    const deps = { doorEnv: () => ({}), readDraftLog: () => [...resolved(), compared, pickedCodex] };
    expect(rowMovedBeforeSend({ deps, draft: owing, home })).toEqual(
      SlackLifecycleErrors.draftApprovalMismatch({
        approve: owing.digest,
        digest: candidate.digest,
        draftId: owing.id,
      }),
    );
  });
});
